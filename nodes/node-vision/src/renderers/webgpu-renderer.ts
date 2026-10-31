/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import {
	CLIP_SUBJECT,
	type ClipSubjectSource,
	type InstanceMask,
	maskBounds,
	matchPoseToTracks,
	mergeSubjectMask,
	type PersonMatte,
	type PoseKeypoint,
	type PoseResult,
	PoseSkeletonRenderer,
	readTexturePixels,
	setVisionDevice,
	TemporalObjectTracker,
	type TrackedObject,
	type VisionBundle,
	type VisionGpuImage,
	VisionRunner,
} from "@framefields/vision";
import type { VisionOperation } from "../shared/config.js";
import {
	fromCachedMask,
	toCachedMask,
	VisionFrameCache,
} from "./frame-cache.js";
import { MatteCompositor } from "./matte-compositor.js";

/**
 * Runners by model options (variant, models dir, mirror), each with the runners
 * derived from it by decode options — layers that differ only in classes or
 * confidence share sessions instead of reloading the models.
 */
const sharedRunners = new Map<
	string,
	{ runner: VisionRunner; derived: Map<string, VisionRunner> }
>();
const MAX_SHARED_RUNNERS = 4;
let sharedSkeletonRenderer: PoseSkeletonRenderer | null = null;
let sharedCompositor: MatteCompositor | null = null;
let sharedCompositorFormat: GPUTextureFormat | null = null;
/** Analysed frames, shared by every vision node in the process. */
const frameCache = new VisionFrameCache();
/** The frame each node's child texture holds (drawn on its last call). */
const heldFrameByNode = new Map<string, number>();
/** Per node: a copy of the held frame, the frame being analysed, and the composited matte. */
const heldTextures = new Map<string, GPUTexture>();
const analysisTextures = new Map<string, GPUTexture>();
const matteTextures = new Map<string, GPUTexture>();
/** One tracker per vision node — track ids must not mix across nodes/sources. */
const objectTrackers = new Map<string, TemporalObjectTracker>();

/**
 * Persistent per-node child textures. The shared frame encoder is submitted at
 * the END of the frame, so a node renderer cannot read back the child it just
 * drew. We keep the texture around and read back the PREVIOUS frame's pixels at
 * the start of the next call — a stable one-frame delay instead of the
 * unpredictable multi-frame lag you get from pooled textures.
 *
 * Keyed on the stable Vision `Effect` instance (render ids change every frame),
 * with a size-keyed fallback for raw operation nodes.
 */
const childTexturesByEffect = new WeakMap<object, GPUTexture>();
const childTexturesByKey = new Map<string, GPUTexture>();

/**
 * Last successful subject mask, reused for a few frames when the model misses —
 * a transient miss then holds the silhouette instead of flashing the raw plate.
 * Keyed per node/effect so multiple vision nodes do not collide.
 */
const lastSubjectByNode = new Map<
	string,
	{ mask: InstanceMask; frame: number }
>();
const SUBJECT_HOLD_FRAMES = 3;

/** A per-node texture shaped like `like`, recreated when the size changes. */
function nodeTexture(
	textures: Map<string, GPUTexture>,
	device: GPUDevice,
	key: string,
	like: GPUTexture,
	usage: number,
	label: string,
): GPUTexture {
	let tex = textures.get(key);
	if (
		!tex ||
		tex.width !== like.width ||
		tex.height !== like.height ||
		tex.format !== like.format
	) {
		tex?.destroy();
		tex = device.createTexture({
			size: [like.width, like.height],
			format: like.format,
			usage,
			label,
		});
		textures.set(key, tex);
	}
	return tex;
}

const heldTexture = (device: GPUDevice, key: string, like: GPUTexture) =>
	nodeTexture(
		heldTextures,
		device,
		key,
		like,
		GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
		"vision_held_frame",
	);

const analysisTexture = (device: GPUDevice, key: string, like: GPUTexture) =>
	nodeTexture(
		analysisTextures,
		device,
		key,
		like,
		GPUTextureUsage.COPY_DST |
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_SRC,
		"vision_analysis_frame",
	);

const matteTexture = (device: GPUDevice, key: string, like: GPUTexture) =>
	nodeTexture(
		matteTextures,
		device,
		key,
		like,
		GPUTextureUsage.RENDER_ATTACHMENT |
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_SRC,
		"vision_matte",
	);

/** Everything that decides a frame's results besides the frame itself. */
function cacheSource(
	nodeKey: string,
	child: unknown,
	op: VisionOperation,
	width: number,
	height: number,
): string {
	const c = child as { id?: unknown; operation?: { id?: unknown } } | undefined;
	return JSON.stringify([
		nodeKey,
		c?.operation?.id ?? c?.id ?? null,
		width,
		height,
		op.mode ?? "passthrough",
		op.variant,
		op.confidence,
		op.classes,
		op.maskThreshold,
		op.featherRadius,
		op.matteSource,
		op.keyBackground === true,
		op.maxMissedFrames,
	]);
}

/** The background-key threshold at `frame` (it may be animated). */
function backgroundKeyThreshold(
	op: VisionOperation,
	frame: number,
	fps: number,
): number {
	const raw = (op as Record<string, unknown>).backgroundKeyThreshold;
	if (typeof raw === "number") return raw;
	if (typeof (raw as { get?: unknown })?.get === "function") {
		return Number(
			(raw as { get: (ctx?: unknown) => unknown }).get({ frame, fps }),
		);
	}
	if (typeof (raw as { _value?: unknown })?._value === "number") {
		return Number((raw as { _value: number })._value);
	}
	return 70;
}

/**
 * The model's subject, or the last one through brief misses: a transient miss
 * then holds the silhouette instead of flashing the raw plate.
 */
function selectSubject(
	selected: InstanceMask | undefined,
	nodeKey: string,
	frame: number,
): InstanceMask | undefined {
	if (selected) {
		lastSubjectByNode.set(nodeKey, { mask: selected, frame });
		return selected;
	}
	const last = lastSubjectByNode.get(nodeKey);
	if (last && frame - last.frame <= SUBJECT_HOLD_FRAMES) return last.mask;
	return undefined;
}

/**
 * Lazy shared runner — `create()` is a pure constructor (zero I/O); the first frame that
 * requests a task triggers that task's model download at inference time (never at init).
 * Nodes with the same model options share sessions; decode options (classes,
 * confidence, …) get a derived runner over the same sessions.
 */
function getSharedRunner(op: VisionOperation): VisionRunner {
	const modelOptions = {
		variant: op.variant,
		modelsDir: op.modelsDir,
		baseUrl: op.baseUrl,
	};
	const modelKey = JSON.stringify(modelOptions);
	let entry = sharedRunners.get(modelKey);
	if (!entry) {
		if (sharedRunners.size >= MAX_SHARED_RUNNERS) {
			const [oldestKey, oldest] = sharedRunners.entries().next().value as [
				string,
				{ runner: VisionRunner },
			];
			oldest.runner.close();
			sharedRunners.delete(oldestKey);
		}
		entry = { runner: VisionRunner.create(modelOptions), derived: new Map() };
		sharedRunners.set(modelKey, entry);
	}
	const decodeOptions = {
		confidence: op.confidence,
		classes: op.classes,
		maskThreshold: op.maskThreshold,
		featherRadius: op.featherRadius,
	};
	const decodeKey = JSON.stringify(decodeOptions);
	let runner = entry.derived.get(decodeKey);
	if (!runner) {
		runner = entry.runner.derive(decodeOptions);
		entry.derived.set(decodeKey, runner);
	}
	return runner;
}

function getObjectTracker(
	nodeKey: string,
	op: VisionOperation,
): TemporalObjectTracker {
	let tracker = objectTrackers.get(nodeKey);
	if (!tracker) {
		tracker = new TemporalObjectTracker({
			maxMissedFrames: op.maxMissedFrames ?? 15,
		});
		objectTrackers.set(nodeKey, tracker);
	}
	return tracker;
}

/**
 * Normalizes the runner's pose keypoints (plate pixel space) to [0, 1] landmarks, which is
 * the contract the signal bundle and the skeleton pipeline expect.
 */
function normalizePoseKeypoints(
	result: PoseResult,
	width: number,
	height: number,
): PoseResult {
	if (width <= 0 || height <= 0) return result;
	return {
		people: result.people.map((person) => ({
			...person,
			keypoints: person.keypoints.map((k) => ({
				x: k.x / width,
				y: k.y / height,
				visibility: k.visibility,
			})),
		})),
	};
}

/** Case-insensitive class filter, as the runner's decode applies it. */
function matchesClasses(
	category: string,
	classes: readonly string[] | undefined,
): boolean {
	if (!classes) return true;
	const c = category.toLowerCase();
	return classes.some((k) => k.toLowerCase() === c);
}

/** Assigns each decoded instance mask to the temporal track whose box center is nearest the mask's centroid. */
function assignMasksToTracks(
	masks: readonly InstanceMask[],
	tracked: readonly { trackId: number; centerX: number; centerY: number }[],
): InstanceMask[] {
	return masks.map((mask) => {
		const { cx, cy } = maskCentroid(mask);
		let best: { trackId: number; distance: number } | null = null;
		for (const obj of tracked) {
			const dx = obj.centerX - cx;
			const dy = obj.centerY - cy;
			const distance = dx * dx + dy * dy;
			if (!best || distance < best.distance) {
				best = { trackId: obj.trackId, distance };
			}
		}
		return best ? { ...mask, trackId: best.trackId } : mask;
	});
}

/**
 * Grows a subject mask into connected foreground pixels — seeding a flood fill
 * from the subject through pixels that differ from the sampled backdrop recovers
 * thin or fast-moving edges (hair, fabric) without adding a near-uniform studio
 * wall or its soft grey shadow.
 */
function fillInternalHoles(
	mask: Uint8Array,
	width: number,
	height: number,
): void {
	// Flood the background in from the border; whatever it cannot reach is a hole.
	const n = width * height;
	const exterior = new Uint8Array(n);
	const queue = new Int32Array(n);
	let tail = 0;
	const seed = (i: number) => {
		if (exterior[i] || mask[i] > 0) return;
		exterior[i] = 1;
		queue[tail++] = i;
	};
	for (let x = 0; x < width; x++) {
		seed(x);
		seed((height - 1) * width + x);
	}
	for (let y = 0; y < height; y++) {
		seed(y * width);
		seed(y * width + width - 1);
	}

	let head = 0;
	while (head < tail) {
		const i = queue[head++];
		const x = i % width;
		let j = i + 1;
		if (x + 1 < width && !exterior[j] && mask[j] === 0) {
			exterior[j] = 1;
			queue[tail++] = j;
		}
		j = i - 1;
		if (x > 0 && !exterior[j] && mask[j] === 0) {
			exterior[j] = 1;
			queue[tail++] = j;
		}
		j = i + width;
		if (j < n && !exterior[j] && mask[j] === 0) {
			exterior[j] = 1;
			queue[tail++] = j;
		}
		j = i - width;
		if (j >= 0 && !exterior[j] && mask[j] === 0) {
			exterior[j] = 1;
			queue[tail++] = j;
		}
	}

	for (let i = 0; i < n; i++) {
		if (mask[i] === 0 && exterior[i] === 0) {
			mask[i] = 255;
		}
	}
}

function smoothMaskBoundary(
	mask: Uint8Array,
	width: number,
	height: number,
	radius = 2,
): Uint8Array {
	if (radius <= 0) return mask;
	const temp = new Uint8Array(width * height);
	const out = new Uint8Array(width * height);
	const div = 2 * radius + 1;

	// Horizontal box filter
	for (let y = 0; y < height; y++) {
		const row = y * width;
		let sum = 0;
		for (let k = -radius; k <= radius; k++) {
			const x = Math.max(0, Math.min(width - 1, k));
			sum += mask[row + x];
		}
		for (let x = 0; x < width; x++) {
			temp[row + x] = Math.round(sum / div);
			const xOut = Math.max(0, x - radius);
			const xIn = Math.min(width - 1, x + radius + 1);
			sum += mask[row + xIn] - mask[row + xOut];
		}
	}

	// Vertical box filter, a running sum per column walked row by row
	// (in memory order).
	const sums = new Float64Array(width);
	for (let k = -radius; k <= radius; k++) {
		const row = Math.max(0, Math.min(height - 1, k)) * width;
		for (let x = 0; x < width; x++) sums[x] += temp[row + x];
	}
	for (let y = 0; y < height; y++) {
		const row = y * width;
		const rowOut = Math.max(0, y - radius) * width;
		const rowIn = Math.min(height - 1, y + radius + 1) * width;
		for (let x = 0; x < width; x++) {
			out[row + x] = Math.round(sums[x] / div);
			sums[x] += temp[rowIn + x] - temp[rowOut + x];
		}
	}

	return out;
}

function growMaskIntoForeground(
	mask: Uint8Array,
	width: number,
	height: number,
	pixels: Uint8ClampedArray | Uint8Array,
	threshold: number,
	featherRadius?: number,
): Uint8Array {
	// Backdrop estimate from the frame border, ignoring already-masked pixels.
	let br = 0;
	let bg = 0;
	let bb = 0;
	let count = 0;
	const sample = (x: number, y: number) => {
		const i = y * width + x;
		if (mask[i]) return;
		const p = i * 4;
		br += pixels[p];
		bg += pixels[p + 1];
		bb += pixels[p + 2];
		count++;
	};
	for (let x = 0; x < width; x += 4) {
		sample(x, 0);
		sample(x, height - 1);
	}
	for (let y = 0; y < height; y += 4) {
		sample(0, y);
		sample(width - 1, y);
	}
	if (count === 0) return mask;
	br /= count;
	bg /= count;
	bb /= count;

	// Pixels that stand out from the backdrop, decided once per pixel.
	const n = width * height;
	const fg = new Uint8Array(n);
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		fg[i] =
			Math.max(
				Math.abs(pixels[p] - br),
				Math.abs(pixels[p + 1] - bg),
				Math.abs(pixels[p + 2] - bb),
			) > threshold
				? 1
				: 0;
	}

	// Each pixel enters the queue at most once: seeds are the masked pixels,
	// later pushes are pixels just raised to 255.
	const queue = new Int32Array(n);
	let tail = 0;
	for (let i = 0; i < n; i++) {
		if (mask[i] > 0) {
			if (fg[i]) mask[i] = 255;
			queue[tail++] = i;
		}
	}

	let head = 0;
	while (head < tail) {
		const i = queue[head++];
		const x = i % width;
		let j = i + 1;
		if (x + 1 < width && mask[j] !== 255 && fg[j]) {
			mask[j] = 255;
			queue[tail++] = j;
		}
		j = i - 1;
		if (x > 0 && mask[j] !== 255 && fg[j]) {
			mask[j] = 255;
			queue[tail++] = j;
		}
		j = i + width;
		if (j < n && mask[j] !== 255 && fg[j]) {
			mask[j] = 255;
			queue[tail++] = j;
		}
		j = i - width;
		if (j >= 0 && mask[j] !== 255 && fg[j]) {
			mask[j] = 255;
			queue[tail++] = j;
		}
	}

	fillInternalHoles(mask, width, height);

	const blurRadius =
		featherRadius !== undefined && featherRadius > 0
			? Math.max(1, Math.min(8, Math.round(featherRadius * 50)))
			: 2;

	return smoothMaskBoundary(mask, width, height, blurRadius);
}

function maskCentroid(mask: InstanceMask): { cx: number; cy: number } {
	// First moment of the frame-aligned mask — cheap, deterministic association.
	const { mask: data, width, height } = mask;
	let sumX = 0;
	let sumY = 0;
	let count = 0;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			if (data[row + x] > 0) {
				sumX += x;
				sumY += y;
				count++;
			}
		}
	}
	if (count === 0) return { cx: 0, cy: 0 };
	return { cx: sumX / count, cy: sumY / count };
}

export const VisionWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		encoder,
		pass,
		targetView,
		targetWidth,
		targetHeight,
		props,
		drawChild,
	} = args;

	const { virtualMedia } = props;
	// Vision sessions run on the renderer's device, so frames reach the models
	// without leaving the GPU.
	setVisionDevice(ctx.device);
	const rawOp = virtualMedia?.operation as
		| VisionOperation
		| Record<string, unknown>
		| undefined;
	if (rawOp?.op !== "Vision") return;
	const op = rawOp as VisionOperation;

	// Close the incoming render pass to allow custom render passes
	pass.end();

	const childMedia = virtualMedia?.children?.[0];
	if (!childMedia) return;

	// 1. Persistent per-node child texture (see childTextures*). Reading the
	//    texture we just drew would race the end-of-frame submit; reading last
	//    frame's already-submitted pixels at the start of this call is correct.
	const effectKey = (op as { effect?: object }).effect;
	const hasEffectKey = effectKey !== undefined && effectKey !== null;
	const nodeKeyStr =
		(virtualMedia as { id?: string } | undefined)?.id ??
		(rawOp as { id?: string } | undefined)?.id ??
		`${targetWidth}x${targetHeight}_${op.mode}_${op.variant}_${op.keyBackground}_${op.backgroundKeyThreshold}`;
	const fallbackKey = `vision-${nodeKeyStr}`;
	let childTex = hasEffectKey
		? childTexturesByEffect.get(effectKey as object)
		: childTexturesByKey.get(fallbackKey);
	if (
		childTex &&
		(childTex.width !== targetWidth || childTex.height !== targetHeight)
	) {
		childTex.destroy();
		childTex = undefined;
		if (hasEffectKey) childTexturesByEffect.delete(effectKey as object);
		else childTexturesByKey.delete(fallbackKey);
	}
	const hasPreviousFrame = childTex !== undefined;
	if (!childTex) {
		childTex = ctx.device.createTexture({
			size: [targetWidth, targetHeight],
			format: ctx.renderer.format,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC,
			label: "vision_child_persistent",
		});
		if (hasEffectKey) childTexturesByEffect.set(effectKey as object, childTex);
		else childTexturesByKey.set(fallbackKey, childTex);
		// keep the fallback cache bounded across many renders in one process
		if (childTexturesByKey.size > 4) {
			const oldest = childTexturesByKey.keys().next().value;
			if (oldest && oldest !== fallbackKey) {
				childTexturesByKey.get(oldest)?.destroy();
				childTexturesByKey.delete(oldest);
			}
		}
	}

	const frameIdx = props.frame ?? 0;
	const compositionFrame = props.compositionFrame ?? frameIdx;
	const fps = props.fps ?? 24;
	const mode = op.mode ?? "passthrough";
	const isMatteMode = mode === "mask" || mode === "matte" || mode === "crop";
	const visionBundle =
		(op.visionBundle as VisionBundle | undefined) ??
		((virtualMedia as Record<string, unknown>).visionBundle as
			| VisionBundle
			| undefined);
	const wantsDetection =
		op.enableDetection !== false || mode === "boxes" || mode === "tracking";
	const wantsSegmentation =
		op.enableSegmentation === true ||
		(isMatteMode && op.matteSource !== "selfie");
	const wantsSelfie =
		op.enableMatte === true || (isMatteMode && op.matteSource === "selfie");
	const wantsPose = op.enablePose === true || mode === "skeleton";

	// 2. A `comp.vision` clip that already analysed this source frame gives the
	//    subject for THIS frame's pixels: no readback, no inference. Undefined
	//    means it has nothing for the frame, so the node segments it itself.
	const clipSubject =
		isMatteMode &&
		!visionBundle &&
		!wantsPose &&
		!wantsSelfie &&
		op.keyBackground !== true
			? clipSubjectFor(
					effectKey,
					props.sourceTimeSec === undefined
						? frameIdx
						: props.sourceTimeSec * fps,
					fps,
					targetWidth,
					targetHeight,
				)
			: undefined;
	// A skeleton of a `comp.vision` clip draws the pose matched to its subject.
	const clipPose =
		mode === "skeleton" && !visionBundle
			? clipPoseFor(
					effectKey,
					props.sourceTimeSec === undefined
						? frameIdx
						: props.sourceTimeSec * fps,
					fps,
					targetWidth,
					targetHeight,
				)
			: undefined;
	const fromClip = clipSubject !== undefined || clipPose !== undefined;

	// 3. Results are cached per source frame (selfie mattes and poses are not,
	//    so nodes that need them always run inference). A frame analysed before
	//    is composited with its own pixels; otherwise inference runs on the
	//    frame the child texture still holds, one frame behind.
	const cacheable =
		!fromClip &&
		!wantsSelfie &&
		!wantsPose &&
		(wantsDetection || wantsSegmentation);
	const source = cacheable
		? cacheSource(nodeKeyStr, childMedia, op, targetWidth, targetHeight)
		: "";
	const keyThresholdAt = (frame: number) =>
		op.keyBackground === true
			? backgroundKeyThreshold(op, compositionFrame - (frameIdx - frame), fps)
			: undefined;
	const lookup = (frame: number | undefined) => {
		if (!cacheable || frame === undefined) return undefined;
		const hit = frameCache.get(source, frame);
		if (!hit || hit.keyThreshold !== keyThresholdAt(frame)) return undefined;
		// Results cached without instance masks can't feed a bundle that wants them.
		if (wantsSegmentation && visionBundle && !hit.masks) return undefined;
		return hit;
	};
	const heldFrame = hasPreviousFrame
		? heldFrameByNode.get(nodeKeyStr)
		: undefined;
	let cached = lookup(frameIdx);
	const exact = fromClip || cached !== undefined;
	if (!cached) cached = lookup(heldFrame);

	// Keep the held frame's picture on the GPU: the matte of that frame is
	// composited from it after the child texture is redrawn below.
	let heldTex: GPUTexture | undefined;
	if (isMatteMode && hasPreviousFrame && !exact) {
		heldTex = heldTexture(ctx.device, nodeKeyStr, childTex);
		encoder.copyTextureToTexture({ texture: childTex }, { texture: heldTex }, [
			targetWidth,
			targetHeight,
			1,
		]);
	}

	// 4. The held frame, when it still needs inference: copied now (submitted
	//    before this frame redraws the child) and analysed on the GPU. Pixels
	//    come back to the CPU only for the opt-in background key.
	let frame: VisionGpuImage | undefined;
	let framePixels: Uint8ClampedArray | Uint8Array | null = null;
	if (hasPreviousFrame && !cached && !fromClip) {
		const analysis = analysisTexture(ctx.device, nodeKeyStr, childTex);
		const copy = ctx.device.createCommandEncoder({
			label: "vision_analysis_copy",
		});
		copy.copyTextureToTexture({ texture: childTex }, { texture: analysis }, [
			targetWidth,
			targetHeight,
			1,
		]);
		ctx.device.queue.submit([copy.finish()]);
		frame = {
			texture: analysis,
			device: ctx.device,
			width: targetWidth,
			height: targetHeight,
		};
		if (isMatteMode && op.keyBackground === true) {
			framePixels = (await readTexturePixels(frame)).data;
		}
	}

	// 5. Draw THIS frame's child into the persistent texture (recorded into the
	//    shared encoder, submitted at end of frame, read back next call).
	const childView = childTex.createView();
	const clearPass = ctx.renderer.beginFrame(
		encoder,
		childView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"clear",
	);
	clearPass.end();

	await drawChild(
		childMedia,
		{ ...props },
		childView,
		childTex,
		targetWidth,
		targetHeight,
	);
	heldFrameByNode.set(nodeKeyStr, frameIdx);

	// 6. Results: from the clip, the cache, or inference on the held frame's pixels
	//    (models download lazily on first use of each task).
	let frameObjects: readonly TrackedObject[] = [];
	let frameMasks: readonly InstanceMask[] = [];
	let personMatte: PersonMatte | undefined;
	let currentPoseRes: PoseResult | undefined;
	let subject: InstanceMask | undefined;

	if (fromClip) {
		subject = clipSubject ?? undefined;
		if (subject)
			lastSubjectByNode.set(nodeKeyStr, { mask: subject, frame: frameIdx });
		else lastSubjectByNode.delete(nodeKeyStr);
	} else if (cached) {
		frameObjects = cached.objects;
		if (wantsDetection) {
			visionBundle?.setObjectResult(frameIdx, {
				objects: cached.objects,
				rawDetections: cached.detections,
			});
		}
		if (wantsSegmentation && visionBundle && cached.masks) {
			frameMasks = cached.masks.map(fromCachedMask);
			visionBundle.setMaskResult(frameIdx, frameMasks);
		}
		if (cached.subject) {
			subject = fromCachedMask(cached.subject.mask);
			lastSubjectByNode.set(nodeKeyStr, { mask: subject, frame: frameIdx });
		}
	} else if (frame) {
		const runner = getSharedRunner(op);
		const image = frame;

		// detect + segment share one RTMDet-Ins pass per frame inside the runner.
		// Tracked objects are kept locally (like masks below) so `boxes` /
		// `tracking` draw even without an attached visionBundle.
		let detections: Awaited<ReturnType<VisionRunner["detect"]>> = [];
		if (wantsDetection) {
			detections = await runner.detect(image);
			const tracker = getObjectTracker(nodeKeyStr, op);
			if (frameIdx === 0) {
				tracker.reset();
			}
			frameObjects = tracker.update(detections, frameIdx, fps);
			visionBundle?.setObjectResult(frameIdx, {
				objects: frameObjects,
				rawDetections: detections,
			});
		}

		// Decoded masks are kept locally so mask-family modes render even without
		// an attached visionBundle (the round-trip through the bundle is for signal DX).
		// The subject is built from every class: `classes` picks the subject, but
		// parts COCO mislabels (a dress as a "kite") must still merge into it.
		let subjectMasks: readonly InstanceMask[] = [];
		if (wantsSegmentation) {
			const subjectFromAllClasses =
				isMatteMode && op.matteSource !== "selfie" && op.classes !== undefined;
			// Same models and per-frame pass as `runner`, decoded without the filter.
			const segRunner = subjectFromAllClasses
				? getSharedRunner({ ...op, classes: undefined })
				: runner;
			const segRes = await segRunner.segment(image);
			frameMasks = assignMasksToTracks(
				subjectFromAllClasses
					? segRes.masks.filter((m) => matchesClasses(m.category, op.classes))
					: segRes.masks,
				frameObjects,
			);
			subjectMasks = subjectFromAllClasses ? segRes.masks : frameMasks;
			visionBundle?.setMaskResult(frameIdx, frameMasks);
		}

		if (wantsSelfie) {
			personMatte = await runner.matte(image);
			visionBundle?.setMatteResult(frameIdx, personMatte);
		}

		if (wantsPose) {
			const poseRes = await runner.pose(image);
			const normalized = normalizePoseKeypoints(
				poseRes,
				image.width,
				image.height,
			);
			currentPoseRes = {
				people: matchPoseToTracks(normalized.people, frameObjects),
			};
			visionBundle?.setPoseResult(frameIdx, currentPoseRes);
		}

		if (isMatteMode) {
			subject = selectSubject(
				op.matteSource === "selfie"
					? personMatteAsMask(personMatte)
					: mergeSubjectMask(
							subjectMasks.length > 0
								? subjectMasks
								: (visionBundle?.getMaskResult(frameIdx) ?? []),
							{ classes: op.classes },
						),
				nodeKeyStr,
				frameIdx,
			);
			// Opt-in: grow the subject into connected pixels that stand out from
			// the backdrop (catches edges the model's soft mask leaves behind).
			const threshold = keyThresholdAt(heldFrame ?? frameIdx);
			if (subject && threshold !== undefined && framePixels) {
				subject = {
					...subject,
					mask: growMaskIntoForeground(
						subject.mask,
						subject.width,
						subject.height,
						framePixels,
						threshold,
						op.featherRadius,
					),
				};
			}
		}

		if (cacheable && heldFrame !== undefined) {
			frameCache.set(source, heldFrame, {
				detections,
				objects: frameObjects,
				masks: visionBundle ? frameMasks.map(toCachedMask) : null,
				subject: subject ? { mask: toCachedMask(subject) } : null,
				keyThreshold: keyThresholdAt(heldFrame),
			});
		}
	}

	// 7. Output to destination texture based on mode

	// Mask-family modes: the picture the results belong to, cut out on the GPU.
	if (isMatteMode) {
		const picture = exact ? childTex : heldTex;
		if (!subject || !picture) {
			const outPass = ctx.renderer.beginFrame(
				encoder,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				targetWidth,
				targetHeight,
				"clear",
			);
			outPass.end();
			return;
		}

		if (!sharedCompositor || sharedCompositorFormat !== ctx.renderer.format) {
			sharedCompositor = new MatteCompositor(ctx.device, ctx.renderer.format);
			sharedCompositorFormat = ctx.renderer.format;
		}
		const maskTex = sharedCompositor.uploadMask(
			nodeKeyStr,
			subject.mask,
			subject.width,
			subject.height,
		);
		const matteTex = matteTexture(ctx.device, nodeKeyStr, childTex);
		sharedCompositor.draw(
			encoder,
			matteTex.createView(),
			picture,
			maskTex,
			mode,
			mode === "crop" ? (maskBounds(subject) ?? undefined) : undefined,
		);
		visionBundle?.setStencilTexture(matteTex);

		const outPass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"clear",
		);
		ctx.renderer.drawTexture(outPass, matteTex, {
			x: 0,
			y: 0,
			width: targetWidth,
			height: targetHeight,
		});
		outPass.end();
		return;
	}

	if (mode === "skeleton") {
		if (!sharedSkeletonRenderer) {
			sharedSkeletonRenderer = new PoseSkeletonRenderer(ctx.device);
		}
		const keypoints =
			clipPose !== undefined
				? clipPose
				: (visionBundle?.getPoseResult(frameIdx) ?? currentPoseRes)?.people[0]
						?.keypoints;
		// Only the skeleton: a frame without a pose stays empty, never the footage.
		const skelPass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"clear",
		);
		if (keypoints && keypoints.length > 0) {
			const skelTex = sharedSkeletonRenderer.renderToTexture(keypoints, {
				width: targetWidth,
				height: targetHeight,
			});
			ctx.renderer.drawTexture(skelPass, skelTex, {
				x: 0,
				y: 0,
				width: targetWidth,
				height: targetHeight,
			});
		}
		skelPass.end();
		return;
	}

	if (mode === "boxes" || mode === "tracking") {
		const outPass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"clear",
		);
		ctx.renderer.drawTexture(outPass, childTex, {
			x: 0,
			y: 0,
			width: targetWidth,
			height: targetHeight,
		});

		const objects =
			frameObjects.length > 0
				? frameObjects
				: (visionBundle?.getObjectResult(frameIdx).objects ?? []);
		if (objects.length > 0) {
			const boxColor = "#38bdf8";
			const stroke = 2;

			for (const obj of objects) {
				if (!obj.active) continue;
				const b = obj.boundingBox;

				ctx.renderer.drawRect(
					outPass,
					{ x: b.originX, y: b.originY, width: b.width, height: stroke },
					boxColor,
				);
				ctx.renderer.drawRect(
					outPass,
					{
						x: b.originX,
						y: b.originY + b.height - stroke,
						width: b.width,
						height: stroke,
					},
					boxColor,
				);
				ctx.renderer.drawRect(
					outPass,
					{ x: b.originX, y: b.originY, width: stroke, height: b.height },
					boxColor,
				);
				ctx.renderer.drawRect(
					outPass,
					{
						x: b.originX + b.width - stroke,
						y: b.originY,
						width: stroke,
						height: b.height,
					},
					boxColor,
				);

				const cornerLen = Math.min(16, b.width / 4, b.height / 4);
				ctx.renderer.drawRect(
					outPass,
					{ x: b.originX, y: b.originY, width: cornerLen, height: stroke * 2 },
					"#ffffff",
				);
				ctx.renderer.drawRect(
					outPass,
					{ x: b.originX, y: b.originY, width: stroke * 2, height: cornerLen },
					"#ffffff",
				);

				if (mode === "tracking") {
					ctx.renderer.drawRect(
						outPass,
						{ x: obj.centerX - 3, y: obj.centerY - 3, width: 6, height: 6 },
						"#ef4444",
						3,
					);
				}
			}
		}
		outPass.end();
		return;
	}

	// Default passthrough: draw child texture to target
	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"clear",
	);
	ctx.renderer.drawTexture(outPass, childTex, {
		x: 0,
		y: 0,
		width: targetWidth,
		height: targetHeight,
	});
	outPass.end();
};

/**
 * The subject a linked `comp.vision` clip holds for a source frame (see
 * CLIP_SUBJECT). Its mask is in source pixels; the composite samples it by
 * uv, so it fits any target of the same aspect. Other shapes fall back.
 */
function clipSubjectFor(
	effect: object | undefined,
	frame: number,
	fps: number,
	width: number,
	height: number,
): InstanceMask | null | undefined {
	const source = linkedClip(effect);
	const subject = source?.subject(frame, fps);
	if (!subject || !source) return subject;
	return fitsTarget(source, subject.width / subject.height, width / height)
		? subject
		: undefined;
}

/**
 * The pose a linked `comp.vision` clip matched to its subject for a source
 * frame, normalized to the source; it fits targets of the same aspect.
 */
function clipPoseFor(
	effect: object | undefined,
	frame: number,
	fps: number,
	width: number,
	height: number,
): readonly PoseKeypoint[] | null | undefined {
	const source = linkedClip(effect);
	const pose = source?.pose?.(frame, fps);
	if (!pose || !source) return pose === null ? null : undefined;
	return fitsTarget(source, pose.width / pose.height, width / height)
		? pose.keypoints
		: undefined;
}

function linkedClip(effect: object | undefined): ClipSubjectSource | undefined {
	return (effect as Record<symbol, unknown> | undefined)?.[CLIP_SUBJECT] as
		| ClipSubjectSource
		| undefined;
}

/** Source results map onto a target of the same aspect; a prompted clip must not fall back. */
function fitsTarget(
	source: ClipSubjectSource,
	sourceAspect: number,
	targetAspect: number,
): boolean {
	if (Math.abs(sourceAspect / targetAspect - 1) < 0.01) return true;
	if (source.exact)
		throw new Error(
			"A prompted clip matte requires the source aspect ratio. Apply layout cropping after the source matte.",
		);
	return false;
}

/** Adapts a Selfie Segmenter matte to the instance-mask shape the composite path takes. */
function personMatteAsMask(
	matte: PersonMatte | undefined,
): InstanceMask | undefined {
	if (!matte || matte.coverage <= 0) return undefined;
	const area = Math.round(matte.coverage * matte.width * matte.height);
	return {
		category: "person",
		mask: matte.mask,
		width: matte.width,
		height: matte.height,
		area,
		coverage: matte.coverage,
		detectionIndex: -1,
	};
}
