import type { DetectedObject } from "@gitframes/core";
import {
	type InputTransform,
	imageToTensor,
	preprocessSpec,
} from "../decode/preprocess.js";
import { decodeRtmdetIns } from "../decode/rtmdet-ins.js";
import { decodeRtmo } from "../decode/rtmo.js";
import { decodeSelfie } from "../decode/selfie.js";
import {
	type ModelDownloadStatus,
	VisionModelStore,
} from "../model/model-store.js";
import {
	COCO_CLASSES,
	modelKeyFor,
	VISION_MODELS,
	type VisionModelKey,
	type VisionTask,
	type VisionVariant,
} from "../model/registry.js";
import {
	createDefaultSessionProvider,
	type SessionProvider,
	type VisionSession,
	type VisionTensor,
	type VisionTensorOutputs,
} from "../runtime/session-provider.js";
import type {
	PersonMatte,
	PoseResult,
	SegmentationResult,
	VisionImageInput,
} from "../types.js";

export interface VisionRunnerOptions {
	/** Model size for detect/segment/pose. Default "s". */
	readonly variant?: VisionVariant;
	/** Minimum detection / person score, 0..1. Default 0.3. */
	readonly confidence?: number;
	/** COCO class-name filter for detect/segment (all classes when omitted). */
	readonly classes?: readonly string[];
	readonly maskThreshold?: number;
	readonly featherRadius?: number;
	readonly modelsDir?: string;
	/** Mirror origin for model downloads (see VisionModelStore). */
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	/** Session backend. Default: onnxruntime-node (CPU). Browser: `createWebGPUProvider()`. */
	readonly provider?: SessionProvider;
	/** Inject a model store (tests, shared caches). Overrides modelsDir/baseUrl/timeoutMs. */
	readonly store?: VisionModelStore;
	readonly onProgress?: (
		key: VisionModelKey,
		bytesLoaded: number,
		totalBytes: number,
	) => void;
}

/**
 * Lazy vision runner.
 *
 * `create()` performs ZERO I/O: no downloads, no sessions. Each inference method downloads
 * its model and warms its session on FIRST USE ONLY, then reuses them for the process
 * lifetime. `detect()` and `segment()` share one RTMDet-Ins forward pass per frame.
 * Call `close()` to release sessions.
 */
export class VisionRunner {
	public readonly variant: VisionVariant;
	public readonly confidence: number;
	public readonly classes?: readonly string[];
	public readonly maskThreshold: number;
	public readonly featherRadius?: number;

	private readonly _store: VisionModelStore;
	private readonly _provider: SessionProvider;
	private readonly _sessions = new Map<
		VisionModelKey,
		Promise<VisionSession>
	>();
	private readonly _tensorScratch = new Map<VisionModelKey, Float32Array>();
	/** One RTMDet-Ins pass per frame buffer, shared by detect() and segment(). */
	private _instancePass?: {
		readonly frame: VisionImageInput["data"];
		readonly result: Promise<InstancePass>;
	};

	private constructor(options: VisionRunnerOptions) {
		this.variant = options.variant ?? "s";
		this.confidence = options.confidence ?? 0.3;
		this.classes = options.classes;
		this.maskThreshold = options.maskThreshold ?? 0.5;
		this.featherRadius = options.featherRadius;
		this._store =
			options.store ??
			new VisionModelStore({
				modelsDir: options.modelsDir,
				baseUrl: options.baseUrl,
				timeoutMs: options.timeoutMs,
				onProgress: options.onProgress,
			});
		this._provider = options.provider ?? createDefaultSessionProvider();
	}

	/** Cheap: no downloads, no sessions, no side effects. */
	public static create(options: VisionRunnerOptions = {}): VisionRunner {
		return new VisionRunner(options);
	}

	public get modelsDir(): string {
		return this._store.modelsDir;
	}

	/** Every registry model keyed to its current download state (downloaded → "ready"). */
	public get downloadStatus(): ReadonlyMap<
		VisionModelKey,
		ModelDownloadStatus
	> {
		const statuses = new Map<VisionModelKey, ModelDownloadStatus>();
		for (const key of Object.keys(VISION_MODELS) as VisionModelKey[]) {
			statuses.set(key, "pending");
		}
		for (const [key, status] of this._store.statuses()) {
			statuses.set(key, status);
		}
		return statuses;
	}

	/** The model serving `task` (matte depends on frame aspect; defaults to square). */
	public modelKeyFor(task: VisionTask, aspect = 1): VisionModelKey {
		return modelKeyFor(task, this.variant, aspect);
	}

	/**
	 * Explicit warm-up: downloads + sessions for the given tasks, ahead of first use.
	 * `matte` warms both aspect variants (the frame aspect is unknown until inference).
	 */
	public async preload(
		tasks: readonly VisionTask[] = ["detect"],
	): Promise<void> {
		const keys = new Set<VisionModelKey>();
		for (const task of tasks) {
			if (task === "matte") {
				keys.add("selfie-square");
				keys.add("selfie-landscape");
			} else {
				keys.add(this.modelKeyFor(task));
			}
		}
		await this._store.preload([...keys]);
		await Promise.all([...keys].map((key) => this.session(key)));
	}

	/** COCO-80 boxes (sorted by score, source pixels). Masks are not decoded. */
	public async detect(
		image: VisionImageInput,
	): Promise<readonly DetectedObject[]> {
		const pass = await this.instancePass(image);
		return decodeRtmdetIns(
			{ ...pass.outputs, masks: undefined },
			this.instanceDecodeOptions(image, pass.transform),
		).detections;
	}

	/** COCO-80 boxes plus a frame-aligned soft mask per instance. */
	public async segment(image: VisionImageInput): Promise<SegmentationResult> {
		const pass = await this.instancePass(image);
		return decodeRtmdetIns(
			pass.outputs,
			this.instanceDecodeOptions(image, pass.transform),
		);
	}

	/** COCO-17 keypoints per person (source pixels), highest score first. */
	public async pose(image: VisionImageInput): Promise<PoseResult> {
		const key = this.modelKeyFor("pose");
		const { outputs, transform } = await this.infer(key, image);
		const dets = output(outputs, "dets", key);
		const keypoints = output(outputs, "keypoints", key);
		return decodeRtmo(
			{
				dets: dets.data as Float32Array,
				keypoints: keypoints.data as Float32Array,
				count: dets.dims[1] ?? 0,
				keypointStride: keypoints.dims[3] ?? 3,
			},
			{
				confidence: this.confidence,
				transform,
				sourceWidth: image.width,
				sourceHeight: image.height,
			},
		);
	}

	/** Person-vs-background alpha for the whole frame (Selfie Segmenter). */
	public async matte(image: VisionImageInput): Promise<PersonMatte> {
		const key = this.modelKeyFor("matte", image.width / image.height);
		const [w, h] = VISION_MODELS[key].input;
		const { outputs } = await this.infer(key, image);
		const alphas = output(outputs, "alphas", key);
		return decodeSelfie(alphas.data as Float32Array, w, h, {
			sourceWidth: image.width,
			sourceHeight: image.height,
			maskThreshold: this.maskThreshold,
			...(this.featherRadius !== undefined
				? { featherRadius: this.featherRadius }
				: {}),
		});
	}

	public close(): void {
		for (const promise of this._sessions.values()) {
			void promise.then((session) => session.release()).catch(() => undefined);
		}
		this._sessions.clear();
		this._instancePass = undefined;
		this._store.clearMemoryCache();
	}

	// ── internals ──────────────────────────────────────────────────────────

	private instancePass(image: VisionImageInput): Promise<InstancePass> {
		if (this._instancePass?.frame === image.data) {
			return this._instancePass.result;
		}
		const key = this.modelKeyFor("segment");
		const result = this.infer(key, image).then(
			({ outputs, transform }) => {
				const dets = output(outputs, "dets", key);
				const masks = output(outputs, "masks", key);
				return {
					transform,
					outputs: {
						dets: dets.data as Float32Array,
						labels: output(outputs, "labels", key).data,
						masks: masks.data as Float32Array,
						count: dets.dims[1] ?? 0,
						maskHeight: masks.dims[masks.dims.length - 2] ?? 0,
						maskWidth: masks.dims[masks.dims.length - 1] ?? 0,
					},
				};
			},
		);
		this._instancePass = { frame: image.data, result };
		result.catch(() => {
			if (this._instancePass?.result === result) this._instancePass = undefined;
		});
		return result;
	}

	private instanceDecodeOptions(
		image: VisionImageInput,
		transform: InputTransform,
	) {
		return {
			confidence: this.confidence,
			classes: this.classes,
			classNames: COCO_CLASSES,
			transform,
			sourceWidth: image.width,
			sourceHeight: image.height,
			maskThreshold: this.maskThreshold,
			...(this.featherRadius !== undefined
				? { featherRadius: this.featherRadius }
				: {}),
		};
	}

	private async infer(
		key: VisionModelKey,
		image: VisionImageInput,
	): Promise<{ outputs: VisionTensorOutputs; transform: InputTransform }> {
		const session = await this.session(key);
		const desc = VISION_MODELS[key];
		const spec = preprocessSpec(desc.family, desc.input);
		const size = 3 * spec.width * spec.height;
		let scratch = this._tensorScratch.get(key);
		if (!scratch || scratch.length < size) {
			scratch = new Float32Array(size);
			this._tensorScratch.set(key, scratch);
		}
		const { tensor, transform } = imageToTensor(image, spec, scratch);
		const outputs = await session.run({
			name: "input",
			data: tensor,
			dims: [1, 3, spec.height, spec.width],
		});
		return { outputs, transform };
	}

	private session(key: VisionModelKey): Promise<VisionSession> {
		let promise = this._sessions.get(key);
		if (!promise) {
			promise = this._store
				.ensure(key)
				.then((bytes) => this._provider.createSession(bytes))
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
}

interface InstancePass {
	readonly transform: InputTransform;
	readonly outputs: {
		readonly dets: Float32Array;
		readonly labels: VisionTensor["data"];
		readonly masks: Float32Array;
		readonly count: number;
		readonly maskWidth: number;
		readonly maskHeight: number;
	};
}

function output(
	outputs: VisionTensorOutputs,
	name: string,
	key: VisionModelKey,
): VisionTensor {
	const tensor = outputs[name];
	if (!tensor) {
		throw new Error(
			`Vision model '${key}' returned no '${name}' output (got: ${Object.keys(outputs).join(", ") || "none"}). ` +
				`Expected the ${VISION_MODELS[key].source}.`,
		);
	}
	return tensor;
}
