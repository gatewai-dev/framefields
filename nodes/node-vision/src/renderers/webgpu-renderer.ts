/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import {
	type InstanceMask,
	type MaskBounds,
	maskBounds,
	matchPoseToTracks,
	mergeSubjectMask,
	type PersonMatte,
	type PoseResult,
	PoseSkeletonRenderer,
	SegmentationTexturePool,
	TemporalObjectTracker,
	type TrackedObject,
	type VisionBundle,
	VisionRunner,
} from "@gitframes/vision";
import type { VisionOperation } from "../shared/config.js";

let sharedRunner: { key: string; runner: VisionRunner } | null = null;
let sharedSkeletonRenderer: PoseSkeletonRenderer | null = null;
let sharedTexturePool: SegmentationTexturePool | null = null;
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

/**
 * Lazy shared runner — `create()` is a pure constructor (zero I/O); the first frame that
 * requests a task triggers that task's model download at inference time (never at init).
 * Recreated only when an option that changes inference changes.
 */
function getSharedRunner(op: VisionOperation): VisionRunner {
	const options = {
		variant: op.variant,
		confidence: op.confidence,
		classes: op.classes,
		maskThreshold: op.maskThreshold,
		featherRadius: op.featherRadius,
		modelsDir: op.modelsDir,
		baseUrl: op.baseUrl,
	};
	const key = JSON.stringify(options);
	if (sharedRunner?.key !== key) {
		sharedRunner?.runner.close();
		sharedRunner = { key, runner: VisionRunner.create(options) };
	}
	return sharedRunner.runner;
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
	const exterior = new Uint8Array(width * height);
	const queue: number[] = [];

	const tryPushBg = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= width || y >= height) return;
		const idx = y * width + x;
		if (exterior[idx] || mask[idx] > 0) return;
		exterior[idx] = 1;
		queue.push(idx);
	};

	for (let x = 0; x < width; x++) {
		tryPushBg(x, 0);
		tryPushBg(x, height - 1);
	}
	for (let y = 0; y < height; y++) {
		tryPushBg(0, y);
		tryPushBg(width - 1, y);
	}

	let head = 0;
	while (head < queue.length) {
		const idx = queue[head++];
		const x = idx % width;
		const y = (idx / width) | 0;
		tryPushBg(x + 1, y);
		tryPushBg(x - 1, y);
		tryPushBg(x, y + 1);
		tryPushBg(x, y - 1);
	}

	for (let i = 0; i < mask.length; i++) {
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

	// Vertical box filter
	for (let x = 0; x < width; x++) {
		let sum = 0;
		for (let k = -radius; k <= radius; k++) {
			const y = Math.max(0, Math.min(height - 1, k));
			sum += temp[y * width + x];
		}
		for (let y = 0; y < height; y++) {
			out[y * width + x] = Math.round(sum / div);
			const yOut = Math.max(0, y - radius);
			const yIn = Math.min(height - 1, y + radius + 1);
			sum += temp[yIn * width + x] - temp[yOut * width + x];
		}
	}

	return out;
}

function growMaskIntoForeground(
	mask: Uint8Array,
	width: number,
	height: number,
	pixels: Uint8ClampedArray,
	threshold: number,
	featherRadius?: number,
): Uint8Array {
	// Backdrop estimate from the frame border, ignoring already-masked pixels.
	let br = 0;
	let bg = 0;
	let bb = 0;
	let n = 0;
	const sample = (x: number, y: number) => {
		const i = y * width + x;
		if (mask[i]) return;
		const p = i * 4;
		br += pixels[p];
		bg += pixels[p + 1];
		bb += pixels[p + 2];
		n++;
	};
	for (let x = 0; x < width; x += 4) {
		sample(x, 0);
		sample(x, height - 1);
	}
	for (let y = 0; y < height; y += 4) {
		sample(0, y);
		sample(width - 1, y);
	}
	if (n === 0) return mask;
	br /= n;
	bg /= n;
	bb /= n;

	const isForeground = (i: number): boolean => {
		const p = i * 4;
		return (
			Math.max(
				Math.abs(pixels[p] - br),
				Math.abs(pixels[p + 1] - bg),
				Math.abs(pixels[p + 2] - bb),
			) > threshold
		);
	};

	const queue: number[] = [];
	for (let i = 0; i < mask.length; i++) {
		if (mask[i] > 0) {
			if (isForeground(i)) {
				mask[i] = 255;
			}
			queue.push(i);
		}
	}

	let head = 0;
	while (head < queue.length) {
		const i = queue[head++];
		const x = i % width;
		const y = (i / width) | 0;
		const tryPush = (nx: number, ny: number) => {
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
			const ni = ny * width + nx;
			if (mask[ni] === 255 || !isForeground(ni)) return;
			mask[ni] = 255;
			queue.push(ni);
		};
		tryPush(x + 1, y);
		tryPush(x - 1, y);
		tryPush(x, y + 1);
		tryPush(x, y - 1);
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
		(virtualMedia as any)?.id ??
		(rawOp as any)?.id ??
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

	// 2. Read back the PREVIOUS frame's child pixels for inference.
	let framePixels: Uint8ClampedArray | null = null;
	if (hasPreviousFrame) {
		const bytesPerPixel = 4;
		const unalignedBytesPerRow = targetWidth * bytesPerPixel;
		const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
		const bufferSize = bytesPerRow * targetHeight;

		const stagingBuffer = ctx.device.createBuffer({
			size: bufferSize,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			label: "vision_frame_staging",
		});

		const readbackEncoder = ctx.device.createCommandEncoder({
			label: "vision_readback_encoder",
		});
		readbackEncoder.copyTextureToBuffer(
			{ texture: childTex },
			{ buffer: stagingBuffer, bytesPerRow, rowsPerImage: targetHeight },
			[targetWidth, targetHeight, 1],
		);
		ctx.device.queue.submit([readbackEncoder.finish()]);

		await stagingBuffer.mapAsync(GPUMapMode.READ);
		const mappedBytes = new Uint8Array(stagingBuffer.getMappedRange());
		framePixels = new Uint8ClampedArray(targetWidth * targetHeight * 4);
		if (bytesPerRow === unalignedBytesPerRow) {
			framePixels.set(mappedBytes.subarray(0, framePixels.length));
		} else {
			for (let y = 0; y < targetHeight; y++) {
				framePixels.set(
					mappedBytes.subarray(
						y * bytesPerRow,
						y * bytesPerRow + unalignedBytesPerRow,
					),
					y * unalignedBytesPerRow,
				);
			}
		}
		stagingBuffer.unmap();
		stagingBuffer.destroy();
	}

	// 3. Draw THIS frame's child into the persistent texture (recorded into the
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

	// 4. Inference on the previous frame's pixels (models download lazily on first
	//    use of each task). Results are therefore one frame behind the plate.
	const frameIdx = props.frame ?? 0;
	const fps = props.fps ?? 24;
	const mode = op.mode ?? "passthrough";
	const isMatteMode = mode === "mask" || mode === "matte" || mode === "crop";
	const visionBundle =
		(op.visionBundle as VisionBundle | undefined) ??
		((virtualMedia as Record<string, unknown>).visionBundle as
			| VisionBundle
			| undefined);
	const runner = getSharedRunner(op);
	const image = framePixels
		? { data: framePixels, width: targetWidth, height: targetHeight }
		: null;

	// detect + segment share one RTMDet-Ins pass per frame inside the runner.
	// Tracked objects are kept locally (like masks below) so `boxes` / `tracking`
	// draw even without an attached visionBundle.
	let frameObjects: readonly TrackedObject[] = [];
	if (
		image &&
		(op.enableDetection !== false || mode === "boxes" || mode === "tracking")
	) {
		const detections = await runner.detect(image);
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

	// Decoded masks are kept locally so mask-family modes render even without an
	// attached visionBundle (the round-trip through the bundle is for signal DX).
	let frameMasks: readonly InstanceMask[] = [];
	if (
		image &&
		(op.enableSegmentation === true ||
			(isMatteMode && op.matteSource !== "selfie"))
	) {
		const segRes = await runner.segment(image);
		frameMasks = assignMasksToTracks(segRes.masks, frameObjects);
		visionBundle?.setMaskResult(frameIdx, frameMasks);
	}

	let personMatte: PersonMatte | undefined;
	if (
		image &&
		(op.enableMatte === true || (isMatteMode && op.matteSource === "selfie"))
	) {
		personMatte = await runner.matte(image);
		visionBundle?.setMatteResult(frameIdx, personMatte);
	}

	let currentPoseRes: PoseResult | undefined;
	if (image && (op.enablePose === true || mode === "skeleton")) {
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

	// 5. Output to destination texture based on mode

	// Mask-family modes composite from CPU pixels we already hold (frame + masks)
	if (isMatteMode) {
		if (!sharedTexturePool) {
			sharedTexturePool = new SegmentationTexturePool(ctx.device);
		}
		const selected =
			op.matteSource === "selfie"
				? personMatteAsMask(personMatte)
				: mergeSubjectMask(
						frameMasks.length > 0
							? frameMasks
							: (visionBundle?.getMaskResult(frameIdx) ?? []),
					);
		let subject: InstanceMask | undefined;
		const lastSubjectEntry = lastSubjectByNode.get(nodeKeyStr);
		const lastSubjectMask = lastSubjectEntry?.mask ?? null;
		const lastSubjectFrame =
			lastSubjectEntry?.frame ?? Number.NEGATIVE_INFINITY;

		if (selected) {
			subject = selected;
			lastSubjectByNode.set(nodeKeyStr, { mask: selected, frame: frameIdx });
		} else if (
			lastSubjectMask &&
			frameIdx - lastSubjectFrame <= SUBJECT_HOLD_FRAMES
		) {
			// Hold the last silhouette through brief model misses; otherwise stay
			// transparent rather than flashing the raw plate over the smoke.
			subject = lastSubjectMask;
		}
		if (!subject || !framePixels) {
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

		// Opt-in: grow the subject into connected pixels that stand out from the
		// backdrop (catches edges the model's soft mask leaves behind).
		if (op.keyBackground === true) {
			const rawThreshold = (op as Record<string, unknown>)
				.backgroundKeyThreshold;
			const threshold =
				typeof rawThreshold === "number"
					? rawThreshold
					: typeof (rawThreshold as { get?: unknown })?.get === "function"
						? Number(
								(rawThreshold as { get: (ctx?: unknown) => unknown }).get({
									frame: frameIdx,
									fps: props.fps ?? 30,
								}),
							)
						: typeof (rawThreshold as { _value?: unknown })?._value === "number"
							? Number((rawThreshold as { _value: number })._value)
							: 70;
			const grownMask = growMaskIntoForeground(
				subject.mask,
				subject.width,
				subject.height,
				framePixels,
				threshold,
				op.featherRadius,
			);
			subject = {
				...subject,
				mask: grownMask,
			};
		}

		const maskTex = uploadComposite(
			sharedTexturePool,
			mode,
			subject,
			framePixels,
			targetWidth,
			targetHeight,
			frameIdx,
			nodeKeyStr,
		);
		visionBundle?.setStencilTexture(maskTex);

		const outPass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"clear",
		);
		ctx.renderer.drawTexture(outPass, maskTex, {
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
		const poseRes = visionBundle?.getPoseResult(frameIdx) ?? currentPoseRes;
		const person = poseRes?.people[0];
		if (person && person.keypoints.length > 0) {
			const skelTex = sharedSkeletonRenderer.renderToTexture(person.keypoints, {
				width: targetWidth,
				height: targetHeight,
			});
			const skelPass = ctx.renderer.beginFrame(
				encoder,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				targetWidth,
				targetHeight,
				"clear",
			);
			ctx.renderer.drawTexture(skelPass, skelTex, {
				x: 0,
				y: 0,
				width: targetWidth,
				height: targetHeight,
			});
			skelPass.end();
			return;
		}
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
 * Builds the RGBA output bytes for mask-family modes from pixels we already hold:
 *  - mask:  white silhouette (r=g=b=mask, a=255)
 *  - matte: child pixels × subject mask (isolate)
 *  - crop:  matte, fitted to the subject bounding box
 */
function uploadComposite(
	pool: SegmentationTexturePool,
	mode: "mask" | "matte" | "crop",
	subject: InstanceMask,
	framePixels: Uint8ClampedArray,
	width: number,
	height: number,
	frameIdx: number,
	nodeKeyStr = "default",
): GPUTexture {
	const mask = subject.mask;
	const out = new Uint8Array(width * height * 4);

	for (let i = 0; i < mask.length; i++) {
		const a = mask[i];
		const px = i * 4;
		if (mode === "mask") {
			out[px] = a;
			out[px + 1] = a;
			out[px + 2] = a;
			out[px + 3] = 255;
		} else {
			// matte & crop: premultiply child RGBA by the subject mask so the
			// background is genuinely transparent (composites over smoke/plates)
			const alpha = (framePixels[px + 3] * a) >> 8;
			out[px] = (framePixels[px] * alpha) >> 8;
			out[px + 1] = (framePixels[px + 1] * alpha) >> 8;
			out[px + 2] = (framePixels[px + 2] * alpha) >> 8;
			out[px + 3] = alpha;
		}
	}

	const key = `vision_composite_${nodeKeyStr}_${mode}_${frameIdx}`;
	const tex = pool.uploadMask(key, out, width, height);

	if (mode === "crop") {
		// Punch in: stretch the subject's bounds to fill the frame.
		const box = maskBounds(subject);
		if (box) {
			return pool.uploadMask(
				`vision_crop_${nodeKeyStr}_${frameIdx}`,
				cropToBounds(out, width, height, box),
				width,
				height,
			);
		}
	}

	return tex;
}

/** Nearest-neighbour resample of `bounds` inside an RGBA frame up to the full frame. */
function cropToBounds(
	rgba: Uint8Array,
	width: number,
	height: number,
	bounds: MaskBounds,
): Uint8Array {
	const cropW = bounds.x1 - bounds.x0 + 1;
	const cropH = bounds.y1 - bounds.y0 + 1;
	const crop = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const srcY =
			bounds.y0 + Math.min(cropH - 1, Math.floor((y / height) * cropH));
		for (let x = 0; x < width; x++) {
			const srcX =
				bounds.x0 + Math.min(cropW - 1, Math.floor((x / width) * cropW));
			const src = (srcY * width + srcX) * 4;
			const dst = (y * width + x) * 4;
			crop[dst] = rgba[src];
			crop[dst + 1] = rgba[src + 1];
			crop[dst + 2] = rgba[src + 2];
			crop[dst + 3] = rgba[src + 3];
		}
	}
	return crop;
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
