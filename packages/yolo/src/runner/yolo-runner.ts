import { readFile } from "node:fs/promises";
import type { DetectedObject } from "@gitframes/core";
import { decodeClassifyOutput } from "../decode/classify.js";
import {
	type DetectDecodeOptions,
	decodeDetectOutput,
} from "../decode/detect.js";
import { letterboxToTensor, type RgbaImage } from "../decode/letterbox.js";
import { decodeObbOutput } from "../decode/obb.js";
import { decodePoseOutput } from "../decode/pose.js";
import { decodeSegmentOutput } from "../decode/segment.js";
import {
	type ModelDownloadStatus,
	YoloModelStore,
} from "../model/model-store.js";
import {
	DEFAULT_MODEL_KEY_BY_TASK,
	YOLO_COCO_CLASSES,
	YOLO_DOTA_CLASSES,
	YOLO_MODELS,
	type YoloModelKey,
	type YoloTask,
	type YoloVariant,
} from "../model/registry.js";
import {
	NodeSessionProvider,
	type SessionProvider,
	type YoloSession,
} from "../runtime/session-provider.js";
import type {
	CustomModelConfig,
	YoloClassifyResult,
	YoloImageInput,
	YoloOBBResult,
	YoloPoseResult,
	YoloSegmentationResult,
} from "../types.js";

export interface YoloRunnerOptions {
	readonly variant?: YoloVariant;
	readonly imgsz?: number;
	readonly confidence?: number;
	readonly iouThreshold?: number;
	readonly classes?: readonly string[];
	readonly enableWorld?: boolean;
	readonly prompts?: readonly string[];
	readonly customModel?: CustomModelConfig;
	readonly modelsDir?: string;
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	readonly maskThreshold?: number;
	readonly featherRadius?: number;
	readonly provider?: SessionProvider;
	readonly onProgress?: (
		key: YoloModelKey,
		bytesLoaded: number,
		totalBytes: number,
	) => void;
}

const YOLO_ANCHORS_FOR_SIZE: Readonly<Record<number, number>> = {
	320: 2100,
	640: 8400,
	1024: 21504,
	1280: 33600,
};

/**
 * Lazy YOLO11 runner.
 *
 * `create()` performs ZERO I/O: no model downloads, no sessions, no environment patching.
 * Each inference method (`detect` / `segment` / `pose` / `classify`) downloads its model
 * and warms its session on FIRST USE ONLY, then reuses them for the process lifetime.
 * Call `close()` to release sessions.
 */
export class YoloVisionRunner {
	public readonly variant: YoloVariant;
	public readonly imgsz: number;
	public readonly confidence: number;
	public readonly iouThreshold: number;
	public readonly classes?: readonly string[];
	public readonly enableWorld?: boolean;
	public readonly prompts?: readonly string[];
	public readonly customModel?: CustomModelConfig;
	public readonly maskThreshold: number;
	public readonly featherRadius?: number;

	private readonly _store: YoloModelStore;
	private readonly _provider: SessionProvider;
	private readonly _sessions = new Map<YoloModelKey, Promise<YoloSession>>();
	private readonly _tensorScratch = new Map<YoloModelKey, Float32Array>();
	private _customSessionPromise?: Promise<YoloSession>;

	private constructor(options: YoloRunnerOptions) {
		this.variant = options.variant ?? "n";
		this.imgsz = options.imgsz ?? 640;
		this.confidence = options.confidence ?? 0.25;
		this.iouThreshold = options.iouThreshold ?? 0.45;
		this.classes = options.classes;
		this.enableWorld = options.enableWorld;
		this.prompts = options.prompts;
		this.customModel = options.customModel;
		this.maskThreshold = options.maskThreshold ?? 0.5;
		this.featherRadius = options.featherRadius;
		this._store = new YoloModelStore({
			modelsDir: options.modelsDir,
			baseUrl: options.baseUrl,
			timeoutMs: options.timeoutMs,
			onProgress: options.onProgress,
		});
		this._provider = options.provider ?? new NodeSessionProvider();
	}

	/** Cheap: no downloads, no sessions, no side effects. */
	public static create(options: YoloRunnerOptions = {}): YoloVisionRunner {
		return new YoloVisionRunner(options);
	}

	public get modelsDir(): string {
		return this._store.modelsDir;
	}

	/** Every registry model keyed to its current download state (downloaded → "ready"). */
	public get downloadStatus(): ReadonlyMap<YoloModelKey, ModelDownloadStatus> {
		const statuses = new Map<YoloModelKey, ModelDownloadStatus>();
		for (const key of Object.keys(YOLO_MODELS) as YoloModelKey[]) {
			statuses.set(key, "pending");
		}
		for (const [key, status] of this._store.statuses()) {
			statuses.set(key, status);
		}
		return statuses;
	}

	public modelKeyFor(task: YoloTask): YoloModelKey {
		return DEFAULT_MODEL_KEY_BY_TASK[task](this.variant);
	}

	/** Explicit warm-up: downloads + sessions for the given tasks, ahead of first use. */
	public async preload(tasks?: readonly YoloTask[]): Promise<void> {
		if (this.customModel) {
			await this.customSession();
			return;
		}
		const defaultTasks =
			this.enableWorld || this.prompts
				? (["world", "segment", "pose"] as const)
				: (["detect", "segment", "pose"] as const);
		const keys = (tasks ?? defaultTasks).map((t) => this.modelKeyFor(t));
		await this._store.preload(keys);
		await Promise.all(keys.map((key) => this.session(key)));
	}

	public async detect(image: YoloImageInput): Promise<DetectedObject[]> {
		if (
			this.customModel &&
			(!this.customModel.task ||
				this.customModel.task === "detect" ||
				this.customModel.task === "world")
		) {
			return this.detectCustom(image);
		}
		if (this.enableWorld || this.prompts) {
			return this.detectWorld(image, this.prompts);
		}
		const key = this.modelKeyFor("detect");
		const session = await this.session(key);
		const { tensor, params } = this.prepareInput(image, key);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, this.imgsz, this.imgsz],
		});
		const preds = pickByDims(outputs, 3);

		return decodeDetectOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[this.imgsz] ?? 8400,
			YOLO_MODELS[key].nc,
			this.decodeOptions(image, params),
		);
	}

	public async detectWorld(
		image: YoloImageInput,
		prompts?: readonly string[],
	): Promise<DetectedObject[]> {
		const activePrompts = prompts ?? this.prompts ?? YOLO_COCO_CLASSES;
		const key = this.modelKeyFor("world");
		const session = await this.session(key);
		const { tensor, params } = this.prepareInput(image, key);

		const txtFeats = new Float32Array(activePrompts.length * 512);
		for (let c = 0; c < activePrompts.length; c++) {
			txtFeats.set(encodePromptEmbedding(activePrompts[c]), c * 512);
		}

		const outputs = await session.run([
			{
				name: "images",
				data: tensor,
				dims: [1, 3, this.imgsz, this.imgsz],
			},
			{
				name: "txt_feats",
				data: txtFeats,
				dims: [1, activePrompts.length, 512],
			},
		]);
		const preds = pickByDims(outputs, 3);

		return decodeDetectOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[this.imgsz] ?? 8400,
			activePrompts.length,
			{
				...this.decodeOptions(image, params, "world"),
				classNames: activePrompts,
			},
		);
	}

	public async segment(image: YoloImageInput): Promise<YoloSegmentationResult> {
		if (this.customModel && this.customModel.task === "segment") {
			return this.segmentCustom(image);
		}
		const key = this.modelKeyFor("segment");
		const session = await this.session(key);
		const { tensor, params } = this.prepareInput(image, key);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, this.imgsz, this.imgsz],
		});

		const preds = pickByDims(outputs, 3);
		const proto = pickByDims(outputs, 4);
		const protoDim = proto.dims[2] ?? proto.dims[1] ?? 160;

		return decodeSegmentOutput(
			preds.data,
			proto.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[this.imgsz] ?? 8400,
			YOLO_MODELS[key].nc,
			protoDim,
			this.decodeOptions(image, params),
		);
	}

	public async pose(image: YoloImageInput): Promise<YoloPoseResult> {
		if (this.customModel && this.customModel.task === "pose") {
			return this.poseCustom(image);
		}
		const key = this.modelKeyFor("pose");
		const session = await this.session(key);
		const { tensor, params } = this.prepareInput(image, key);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, this.imgsz, this.imgsz],
		});
		const preds = pickByDims(outputs, 3);

		return decodePoseOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[this.imgsz] ?? 8400,
			{
				confidence: this.confidence,
				params,
				sourceWidth: image.width,
				sourceHeight: image.height,
			},
		);
	}

	public async detectObb(image: YoloImageInput): Promise<YoloOBBResult> {
		if (this.customModel && this.customModel.task === "obb") {
			return this.obbCustom(image);
		}
		const key = this.modelKeyFor("obb");
		const session = await this.session(key);
		const modelImgsz = YOLO_MODELS[key].imgsz;
		const { tensor, params } = this.prepareInput(image, key);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, modelImgsz, modelImgsz],
		});
		const preds = pickByDims(outputs, 3);

		return decodeObbOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[modelImgsz] ?? 21504,
			YOLO_MODELS[key].nc,
			this.decodeOptions(image, params, "obb"),
		);
	}

	public async classify(image: YoloImageInput): Promise<YoloClassifyResult> {
		if (this.customModel && this.customModel.task === "classify") {
			return this.classifyCustom(image);
		}
		const key = this.modelKeyFor("classify");
		const session = await this.session(key);
		// Classification models export at 224 — re-letterbox to the model's own imgsz
		const modelImgsz = YOLO_MODELS[key].imgsz;
		const { tensor } = letterboxToTensor(image, modelImgsz);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, modelImgsz, modelImgsz],
		});
		const preds = pickByDims(outputs, 2);
		return decodeClassifyOutput(preds.data, YOLO_MODELS[key].nc);
	}

	public close(): void {
		for (const promise of this._sessions.values()) {
			void promise.then((session) => session.release()).catch(() => undefined);
		}
		this._sessions.clear();
		if (this._customSessionPromise) {
			void this._customSessionPromise
				.then((session) => session.release())
				.catch(() => undefined);
			this._customSessionPromise = undefined;
		}
		this._store.clearMemoryCache();
	}

	private async detectCustom(image: YoloImageInput): Promise<DetectedObject[]> {
		if (!this.customModel) {
			throw new Error("No custom model configured");
		}
		const session = await this.customSession();
		const imgsz = this.customModel.imgsz ?? this.imgsz;
		const scratch = new Float32Array(3 * imgsz * imgsz);
		const { tensor, params } = letterboxToTensor(
			normalizeImage(image),
			imgsz,
			scratch,
		);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, imgsz, imgsz],
		});
		const preds = pickByDims(outputs, 3);
		const anchors = preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[imgsz] ?? 8400;

		return decodeDetectOutput(
			preds.data,
			anchors,
			this.customModel.classes.length,
			{
				...this.decodeOptions(image, params),
				classNames: this.customModel.classes,
			},
		);
	}

	private async segmentCustom(
		image: YoloImageInput,
	): Promise<YoloSegmentationResult> {
		if (!this.customModel) {
			throw new Error("No custom model configured");
		}
		const session = await this.customSession();
		const imgsz = this.customModel.imgsz ?? this.imgsz;
		const scratch = new Float32Array(3 * imgsz * imgsz);
		const { tensor, params } = letterboxToTensor(
			normalizeImage(image),
			imgsz,
			scratch,
		);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, imgsz, imgsz],
		});
		const preds = pickByDims(outputs, 3);
		const proto = pickByDims(outputs, 4);
		const protoDim = proto.dims[2] ?? proto.dims[1] ?? 160;

		return decodeSegmentOutput(
			preds.data,
			proto.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[imgsz] ?? 8400,
			this.customModel.classes.length,
			protoDim,
			{
				...this.decodeOptions(image, params),
				classNames: this.customModel.classes,
			},
		);
	}

	private async poseCustom(image: YoloImageInput): Promise<YoloPoseResult> {
		if (!this.customModel) {
			throw new Error("No custom model configured");
		}
		const session = await this.customSession();
		const imgsz = this.customModel.imgsz ?? this.imgsz;
		const scratch = new Float32Array(3 * imgsz * imgsz);
		const { tensor, params } = letterboxToTensor(
			normalizeImage(image),
			imgsz,
			scratch,
		);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, imgsz, imgsz],
		});
		const preds = pickByDims(outputs, 3);

		return decodePoseOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[imgsz] ?? 8400,
			{
				confidence: this.confidence,
				params,
				sourceWidth: image.width,
				sourceHeight: image.height,
			},
		);
	}

	private async obbCustom(image: YoloImageInput): Promise<YoloOBBResult> {
		if (!this.customModel) {
			throw new Error("No custom model configured");
		}
		const session = await this.customSession();
		const imgsz = this.customModel.imgsz ?? this.imgsz;
		const scratch = new Float32Array(3 * imgsz * imgsz);
		const { tensor, params } = letterboxToTensor(
			normalizeImage(image),
			imgsz,
			scratch,
		);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, imgsz, imgsz],
		});
		const preds = pickByDims(outputs, 3);

		return decodeObbOutput(
			preds.data,
			preds.dims[2] ?? YOLO_ANCHORS_FOR_SIZE[imgsz] ?? 21504,
			this.customModel.classes.length,
			{
				...this.decodeOptions(image, params, "obb"),
				classNames: this.customModel.classes,
			},
		);
	}

	private async classifyCustom(
		image: YoloImageInput,
	): Promise<YoloClassifyResult> {
		if (!this.customModel) {
			throw new Error("No custom model configured");
		}
		const session = await this.customSession();
		const imgsz = this.customModel.imgsz ?? 224;
		const { tensor } = letterboxToTensor(image, imgsz);
		const outputs = await session.run({
			name: "images",
			data: tensor,
			dims: [1, 3, imgsz, imgsz],
		});
		const preds = pickByDims(outputs, 2);
		return decodeClassifyOutput(preds.data, this.customModel.classes.length);
	}

	private customSession(): Promise<YoloSession> {
		if (!this.customModel) {
			throw new Error("No customModel specified in YoloVisionRunner options");
		}
		if (!this._customSessionPromise) {
			const cm = this.customModel;
			const imgsz = cm.imgsz ?? this.imgsz;
			this._customSessionPromise = this.loadCustomModelBytes(cm).then((bytes) =>
				this._provider.createSession(bytes, { imgsz }),
			);
		}
		return this._customSessionPromise;
	}

	private async loadCustomModelBytes(
		cm: CustomModelConfig,
	): Promise<Uint8Array> {
		if (cm.path) {
			return new Uint8Array(await readFile(cm.path));
		}
		if (cm.url) {
			return this._store.fetchDirect(cm.url);
		}
		throw new Error("CustomModelConfig must specify either path or url");
	}

	// ── internals ──────────────────────────────────────────────────────────

	private session(key: YoloModelKey): Promise<YoloSession> {
		let promise = this._sessions.get(key);
		if (!promise) {
			const modelImgsz = YOLO_MODELS[key].imgsz ?? this.imgsz;
			promise = this._store
				.ensure(key)
				.then((bytes) =>
					this._provider.createSession(bytes, { imgsz: modelImgsz }),
				)
				.catch((err: unknown) => {
					// Drop both the session cache entry AND the cached file: a parse
					// failure means the on-disk bytes are corrupt — the next call must
					// re-download instead of replaying the same bad file.
					this._sessions.delete(key);
					void this._store.evict(key);
					throw err;
				});
			this._sessions.set(key, promise);
		}
		return promise;
	}

	private prepareInput(
		image: YoloImageInput,
		key: YoloModelKey,
	): {
		tensor: Float32Array;
		params: ReturnType<typeof letterboxToTensor>["params"];
	} {
		const imgsz = YOLO_MODELS[key].imgsz ?? this.imgsz;
		let scratch = this._tensorScratch.get(key);
		if (!scratch || scratch.length < 3 * imgsz * imgsz) {
			scratch = new Float32Array(3 * imgsz * imgsz);
			this._tensorScratch.set(key, scratch);
		}
		return letterboxToTensor(normalizeImage(image), imgsz, scratch);
	}

	private decodeOptions(
		image: YoloImageInput,
		params: ReturnType<typeof letterboxToTensor>["params"],
		task: YoloTask = "detect",
	): DetectDecodeOptions {
		return {
			confidence: this.confidence,
			iouThreshold: this.iouThreshold,
			classes: this.classes,
			classNames: task === "obb" ? YOLO_DOTA_CLASSES : YOLO_COCO_CLASSES,
			params,
			sourceWidth: image.width,
			sourceHeight: image.height,
			maskThreshold: this.maskThreshold,
			featherRadius: this.featherRadius,
		};
	}
}

function normalizeImage(image: YoloImageInput): RgbaImage {
	if (image.data instanceof Uint8ClampedArray) {
		return image;
	}
	// Uint8Array may be a view into a larger buffer (WebGPU readback) — keep it as-is;
	// the letterbox reads via indexing, so views are fine.
	return image as RgbaImage;
}

function pickByDims(
	outputs: Record<string, { data: Float32Array; dims: readonly number[] }>,
	rank: number,
): { data: Float32Array; dims: readonly number[] } {
	const hit = Object.values(outputs).find((t) => t.dims.length === rank);
	if (!hit) {
		throw new Error(
			`YOLO model returned no ${rank}D output — got [${Object.values(outputs)
				.map((t) => t.dims.join("x"))
				.join(", ")}]. Check the exported model task head.`,
		);
	}
	return hit;
}

function hashPromptString(str: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
	}
	return h;
}

function encodePromptEmbedding(prompt: string): Float32Array {
	let seed = hashPromptString(prompt);
	const vec = new Float32Array(512);
	let norm = 0;
	for (let i = 0; i < 512; i++) {
		seed = (seed + 0x6d2b79f5) >>> 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		const val = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
		vec[i] = val;
		norm += val * val;
	}
	const invNorm = 1 / (Math.sqrt(norm) || 1);
	for (let i = 0; i < 512; i++) {
		vec[i] *= invNorm;
	}
	return vec;
}
