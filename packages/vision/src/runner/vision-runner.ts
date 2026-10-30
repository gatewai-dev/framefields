import type { DetectedObject } from "@framefields/core";
import {
	type InputTransform,
	imageToTensor,
	isPreprocessFamily,
	preprocessSpec,
} from "../decode/preprocess.js";
import {
	decodeRtmdetIns,
	type RtmdetInsOutputs,
} from "../decode/rtmdet-ins.js";
import {
	maskLogits,
	RTMDET_INS_HEAD,
	type RtmdetInsHeadOutputs,
	selectInstances,
} from "../decode/rtmdet-ins-head.js";
import { decodeRtmo } from "../decode/rtmo.js";
import { decodeSelfie } from "../decode/selfie.js";
import { FrameTensorPipeline, readTexturePixels } from "../gpu/frame-tensor.js";
import {
	type ModelDownloadStatus,
	VisionModelStore,
} from "../model/model-store.js";
import { extractSubgraph } from "../model/onnx-subgraph.js";
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
import {
	isGpuImage,
	type PersonMatte,
	type PoseResult,
	type SegmentationResult,
	type VisionFrame,
	type VisionImageInput,
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
	/** Session backend. Default: WebGPU when possible, else onnxruntime-node (CPU); see `AutoSessionProvider`. Browser: `createWebGPUProvider()`. */
	readonly provider?: SessionProvider;
	/** Inject a model store (tests, shared caches). Overrides modelsDir/baseUrl/timeoutMs. */
	readonly store?: VisionModelStore;
	readonly onProgress?: (
		key: VisionModelKey,
		bytesLoaded: number,
		totalBytes: number,
	) => void;
}

/** Options that only change how outputs are decoded — not which model runs. */
export type VisionDecodeOptions = Pick<
	VisionRunnerOptions,
	"confidence" | "classes" | "maskThreshold" | "featherRadius"
>;

/**
 * Model-side state: sessions, buffers and the per-frame RTMDet-Ins pass. Shared
 * by a runner and every runner `derive()`d from it.
 */
interface RunnerCore {
	readonly store: VisionModelStore;
	readonly provider: SessionProvider;
	readonly sessions: Map<VisionModelKey, Promise<VisionSession>>;
	readonly tensorScratch: Map<VisionModelKey, Float32Array>;
	/** Tail of each model's run queue: one inference per session at a time. */
	readonly runQueue: Map<VisionModelKey, Promise<unknown>>;
	/** Each model's input on the GPU (GPU frames); runs are queued, so one each. */
	readonly gpuInputs: Map<
		VisionModelKey,
		{ readonly device: GPUDevice; readonly buffer: GPUBuffer }
	>;
	/**
	 * Recent RTMDet-Ins passes, newest last, shared by detect() and segment()
	 * and matched by content — layers showing the same pixels share one pass.
	 */
	readonly instancePasses: {
		readonly content: string;
		readonly result: Promise<InstancePass>;
	}[];
}

const MAX_INSTANCE_PASSES = 4;

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

	private readonly _core: RunnerCore;
	/** False for derived runners: their sessions belong to the runner they came from. */
	private readonly _ownsCore: boolean;

	private constructor(options: VisionRunnerOptions, core?: RunnerCore) {
		this.variant = options.variant ?? "s";
		this.confidence = options.confidence ?? 0.3;
		this.classes = options.classes;
		this.maskThreshold = options.maskThreshold ?? 0.5;
		this.featherRadius = options.featherRadius;
		this._ownsCore = core === undefined;
		this._core = core ?? {
			store:
				options.store ??
				new VisionModelStore({
					modelsDir: options.modelsDir,
					baseUrl: options.baseUrl,
					timeoutMs: options.timeoutMs,
					onProgress: options.onProgress,
				}),
			provider: options.provider ?? createDefaultSessionProvider(),
			sessions: new Map(),
			tensorScratch: new Map(),
			runQueue: new Map(),
			gpuInputs: new Map(),
			instancePasses: [],
		};
	}

	/** Cheap: no downloads, no sessions, no side effects. */
	public static create(options: VisionRunnerOptions = {}): VisionRunner {
		return new VisionRunner(options);
	}

	/**
	 * A runner with other decode options (confidence, classes, mask threshold,
	 * feather) that shares this runner's models, sessions and per-frame RTMDet-Ins
	 * pass — e.g. one per layer, without loading a model twice. Its `close()` is a
	 * no-op; closing this runner releases the shared sessions.
	 */
	public derive(options: VisionDecodeOptions): VisionRunner {
		return new VisionRunner(
			{
				variant: this.variant,
				confidence: options.confidence ?? this.confidence,
				classes: "classes" in options ? options.classes : this.classes,
				maskThreshold: options.maskThreshold ?? this.maskThreshold,
				featherRadius:
					"featherRadius" in options
						? options.featherRadius
						: this.featherRadius,
			},
			this._core,
		);
	}

	public get modelsDir(): string {
		return this._core.store.modelsDir;
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
		for (const [key, status] of this._core.store.statuses()) {
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
		await this._core.store.preload([...keys]);
		await Promise.all([...keys].map((key) => this.session(key)));
	}

	/** COCO-80 boxes (sorted by score, source pixels). Masks are not decoded. */
	public async detect(image: VisionFrame): Promise<readonly DetectedObject[]> {
		const pass = await this.instancePass(image);
		return decodeRtmdetIns(
			{ ...pass.outputs, masks: undefined, maskPlane: undefined },
			this.instanceDecodeOptions(image, pass.transform),
		).detections;
	}

	/** COCO-80 boxes plus a frame-aligned soft mask per instance. */
	public async segment(image: VisionFrame): Promise<SegmentationResult> {
		const pass = await this.instancePass(image);
		return decodeRtmdetIns(
			pass.outputs,
			this.instanceDecodeOptions(image, pass.transform),
		);
	}

	/** COCO-17 keypoints per person (source pixels), highest score first. */
	public async pose(image: VisionFrame): Promise<PoseResult> {
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
	public async matte(image: VisionFrame): Promise<PersonMatte> {
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
		if (!this._ownsCore) return;
		const core = this._core;
		for (const promise of core.sessions.values()) {
			void promise.then((session) => session.release()).catch(() => undefined);
		}
		core.sessions.clear();
		core.runQueue.clear();
		for (const { buffer } of core.gpuInputs.values()) buffer.destroy();
		core.gpuInputs.clear();
		core.instancePasses.length = 0;
		core.store.clearMemoryCache();
	}

	// ── internals ──────────────────────────────────────────────────────────

	private async instancePass(image: VisionFrame): Promise<InstancePass> {
		const passes = this._core.instancePasses;
		const content = isGpuImage(image)
			? await FrameTensorPipeline.for(image.device).contentKey(image)
			: contentKey(image);
		// Checked after the await: a caller that hashed the same frame meanwhile
		// has registered its pass by now.
		const byContent = passes.find((pass) => pass.content === content);
		if (byContent) return byContent.result;
		const key = this.modelKeyFor("segment");
		const result = this.infer(key, image).then(({ outputs, transform }) => ({
			transform,
			outputs:
				RTMDET_INS_HEAD.scores in outputs
					? headPassOutputs(outputs, key, transform)
					: end2endPassOutputs(outputs, key),
		}));
		const pass = { content, result };
		passes.push(pass);
		if (passes.length > MAX_INSTANCE_PASSES) passes.shift();
		result.catch(() => {
			const index = passes.indexOf(pass);
			if (index >= 0) passes.splice(index, 1);
		});
		return result;
	}

	private instanceDecodeOptions(image: VisionFrame, transform: InputTransform) {
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

	/**
	 * Runs one model on one image. Runs of the same model are queued: they share
	 * the input scratch buffer, and one run already uses the session's threads.
	 */
	private infer(
		key: VisionModelKey,
		image: VisionFrame,
	): Promise<{ outputs: VisionTensorOutputs; transform: InputTransform }> {
		const queue = this._core.runQueue;
		const previous = queue.get(key) ?? Promise.resolve();
		const run = previous.then(
			() => this.inferNow(key, image),
			() => this.inferNow(key, image),
		);
		const tail = run.catch(() => undefined);
		queue.set(key, tail);
		void tail.then(() => {
			if (queue.get(key) === tail) queue.delete(key);
		});
		return run;
	}

	private async inferNow(
		key: VisionModelKey,
		frame: VisionFrame,
	): Promise<{ outputs: VisionTensorOutputs; transform: InputTransform }> {
		const session = await this.session(key);
		const desc = VISION_MODELS[key];
		if (!isPreprocessFamily(desc.family))
			throw new Error(
				`VisionRunner cannot run '${desc.family}' models; use the family's own tracker (e.g. Sam2Tracker or Sam3Tracker from @framefields/vision-sam).`,
			);
		const spec = preprocessSpec(desc.family, desc.input);
		const dims = [1, 3, spec.height, spec.width];
		let image: VisionImageInput;
		if (isGpuImage(frame)) {
			if (this._core.provider.device === frame.device) {
				// Same device as the sessions: preprocess on the GPU, no readback.
				const buffer = this.gpuInput(key, frame.device, spec);
				const transform = FrameTensorPipeline.for(frame.device).toTensor(
					frame,
					spec,
					buffer,
				);
				const outputs = await session.run({
					name: "input",
					data: EMPTY_TENSOR,
					gpuBuffer: buffer,
					dims,
				});
				return { outputs, transform };
			}
			image = await readTexturePixels(frame);
		} else {
			image = frame;
		}
		const size = 3 * spec.width * spec.height;
		const scratchByKey = this._core.tensorScratch;
		let scratch = scratchByKey.get(key);
		if (!scratch || scratch.length < size) {
			scratch = new Float32Array(size);
			scratchByKey.set(key, scratch);
		}
		const { tensor, transform } = imageToTensor(image, spec, scratch);
		const outputs = await session.run({ name: "input", data: tensor, dims });
		return { outputs, transform };
	}

	private gpuInput(
		key: VisionModelKey,
		device: GPUDevice,
		spec: ReturnType<typeof preprocessSpec>,
	): GPUBuffer {
		const inputs = this._core.gpuInputs;
		const size = FrameTensorPipeline.tensorBytes(spec);
		const current = inputs.get(key);
		if (current?.device === device && current.buffer.size >= size) {
			return current.buffer;
		}
		current?.buffer.destroy();
		const buffer = device.createBuffer({
			label: `vision_input_${key}`,
			size,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		});
		inputs.set(key, { device, buffer });
		return buffer;
	}

	private session(key: VisionModelKey): Promise<VisionSession> {
		const { sessions, store, provider } = this._core;
		let promise = sessions.get(key);
		if (!promise) {
			promise = store
				.ensure(key)
				.then((bytes) =>
					provider.createSession(
						VISION_MODELS[key].family === "rtmdet-ins"
							? rtmdetInsBody(bytes)
							: bytes,
					),
				)
				.catch((err: unknown) => {
					// Drop both the session cache entry AND the cached file: a parse
					// failure means the on-disk bytes are corrupt — the next call must
					// re-download instead of replaying the same bad file.
					sessions.delete(key);
					void store.evict(key);
					throw err;
				});
			sessions.set(key, promise);
		}
		return promise;
	}
}

const EMPTY_TENSOR = new Float32Array(0);

interface InstancePass {
	readonly transform: InputTransform;
	readonly outputs: RtmdetInsOutputs;
}

/**
 * The RTMDet-Ins graph up to its head (see `RTMDET_INS_HEAD`): no NMS or
 * full-size masks in the graph, so the GPU part has fixed shapes and only
 * ~9 MB comes back. Models without those tensors run end to end.
 */
function rtmdetInsBody(bytes: Uint8Array): Uint8Array {
	try {
		return extractSubgraph(bytes, Object.values(RTMDET_INS_HEAD));
	} catch {
		return bytes;
	}
}

/** Outputs of the end2end graph: NMS done, one input-sized mask per detection. */
function end2endPassOutputs(
	outputs: VisionTensorOutputs,
	key: VisionModelKey,
): RtmdetInsOutputs {
	const dets = output(outputs, "dets", key);
	const masks = output(outputs, "masks", key);
	return {
		dets: dets.data as Float32Array,
		labels: output(outputs, "labels", key).data,
		masks: masks.data as Float32Array,
		count: dets.dims[1] ?? 0,
		maskHeight: masks.dims[masks.dims.length - 2] ?? 0,
		maskWidth: masks.dims[masks.dims.length - 1] ?? 0,
	};
}

/** Outputs of the head: selection here, mask logits only for detections asked for. */
function headPassOutputs(
	outputs: VisionTensorOutputs,
	key: VisionModelKey,
	transform: InputTransform,
): RtmdetInsOutputs {
	const scores = output(outputs, RTMDET_INS_HEAD.scores, key);
	const features = output(outputs, RTMDET_INS_HEAD.maskFeatures, key);
	const head: RtmdetInsHeadOutputs = {
		scores: scores.data as Float32Array,
		boxes: output(outputs, RTMDET_INS_HEAD.boxes, key).data as Float32Array,
		kernels: output(outputs, RTMDET_INS_HEAD.kernels, key).data as Float32Array,
		maskFeatures: features.data as Float32Array,
		anchors: scores.dims[1] ?? 0,
		classes: scores.dims[2] ?? 0,
		maskHeight: features.dims[2] ?? 0,
		maskWidth: features.dims[3] ?? 0,
		inputWidth: transform.inputWidth,
		inputHeight: transform.inputHeight,
	};
	const picked = selectInstances(head);
	const dets = new Float32Array(picked.length * 5);
	const labels = new Int32Array(picked.length);
	picked.forEach(({ anchor, classIndex, score }, i) => {
		dets.set(head.boxes.subarray(anchor * 4, anchor * 4 + 4), i * 5);
		dets[i * 5 + 4] = score;
		labels[i] = classIndex;
	});
	// Shared by every layer that reads this pass: each plane is computed once.
	const planes = new Map<number, Float32Array>();
	return {
		dets,
		labels,
		count: picked.length,
		maskWidth: head.maskWidth,
		maskHeight: head.maskHeight,
		maskLogits: true,
		maskPlane: (index) => {
			let plane = planes.get(index);
			if (!plane) {
				plane = maskLogits(head, (picked[index] as { anchor: number }).anchor);
				planes.set(index, plane);
			}
			return plane;
		},
	};
}

/** Size plus a 64-bit hash of the pixels: equal keys mean the same picture. */
function contentKey(image: VisionImageInput): string {
	const { data } = image;
	const words = data.byteOffset % 4 === 0 ? data.byteLength >>> 2 : 0;
	const view = new Uint32Array(data.buffer, data.byteOffset, words);
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193 ^ data.byteLength;
	for (let i = 0; i < words; i++) {
		const v = view[i] as number;
		h1 = Math.imul(h1 ^ v, 0x9e3779b1);
		h2 = Math.imul(h2 ^ v, 0x85ebca77) ^ (h1 >>> 15);
	}
	for (let i = words * 4; i < data.length; i++) {
		h1 = Math.imul(h1 ^ (data[i] as number), 0x9e3779b1);
	}
	return `${image.width}x${image.height}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
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
