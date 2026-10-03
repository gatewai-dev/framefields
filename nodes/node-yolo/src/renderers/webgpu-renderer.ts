/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import {
	matchPoseToTracks,
	PoseSkeletonRenderer,
	SegmentationTexturePool,
	TemporalObjectTracker,
	type YoloInstanceMask,
	type YoloPoseResult,
	type YoloVisionBundle,
	YoloVisionRunner,
} from "@gitframes/yolo";
import type { YoloOperation } from "../shared/config.js";

let sharedRunner: YoloVisionRunner | null = null;
let sharedSkeletonRenderer: PoseSkeletonRenderer | null = null;
let sharedTexturePool: SegmentationTexturePool | null = null;
let sharedObjectTracker: TemporalObjectTracker | null = null;

/**
 * Persistent per-node child textures. The shared frame encoder is submitted at
 * the END of the frame, so a node renderer cannot read back the child it just
 * drew. We keep the texture around and read back the PREVIOUS frame's pixels at
 * the start of the next call — a stable one-frame delay instead of the
 * unpredictable multi-frame lag you get from pooled textures.
 *
 * Keyed on the stable Yolo `Effect` instance (render ids change every frame),
 * with a size-keyed fallback for raw operation nodes.
 */
const yoloChildTexturesByEffect = new WeakMap<object, GPUTexture>();
const yoloChildTexturesByKey = new Map<string, GPUTexture>();

/**
 * Last successful subject mask, reused for a few frames when the model misses —
 * a transient miss then holds the silhouette instead of flashing the raw plate.
 * Keyed per node/effect so multiple YOLO nodes do not collide.
 */
const lastSubjectByNode = new Map<
	string,
	{ mask: YoloInstanceMask; frame: number }
>();
const SUBJECT_HOLD_FRAMES = 3;

/**
 * Lazy shared runner — `create()` is a pure constructor (zero I/O); the first frame that
 * requests a task triggers that task's model download at inference time (never at init).
 */
function getSharedRunner(op: YoloOperation): YoloVisionRunner {
	if (
		!sharedRunner ||
		sharedRunner.variant !== op.variant ||
		sharedRunner.enableWorld !== op.enableWorld ||
		sharedRunner.prompts !== op.prompts ||
		sharedRunner.customModel !== op.customModel ||
		sharedRunner.featherRadius !== op.featherRadius ||
		sharedRunner.maskThreshold !== op.maskThreshold
	) {
		sharedRunner = YoloVisionRunner.create({
			variant: op.variant,
			imgsz: op.imgsz,
			confidence: op.confidence,
			iouThreshold: op.iouThreshold,
			classes: op.classes,
			enableWorld: op.enableWorld,
			prompts: op.prompts,
			customModel: op.customModel,
			maskThreshold: op.maskThreshold,
			featherRadius: op.featherRadius,
			modelsDir: op.modelsDir,
			baseUrl: op.baseUrl,
		});
	}
	return sharedRunner;
}

/** Lazy shared tracker — detections (incl. OBB) are tracked under one stable identity space. */
function getSharedObjectTracker(op: YoloOperation): TemporalObjectTracker {
	if (!sharedObjectTracker) {
		sharedObjectTracker = new TemporalObjectTracker({
			iouThreshold: op.iouThreshold ?? 0.25,
			maxMissedFrames: op.maxMissedFrames ?? 15,
		});
	}
	return sharedObjectTracker;
}

/**
 * Normalizes the runner's pose keypoints (plate pixel space) to [0, 1] landmarks, which is
 * the contract the signal bundle and the skeleton pipeline expect.
 */
function normalizePoseKeypoints(
	result: YoloPoseResult,
	width: number,
	height: number,
): YoloPoseResult {
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
	masks: readonly YoloInstanceMask[],
	tracked: readonly { trackId: number; centerX: number; centerY: number }[],
): YoloInstanceMask[] {
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

/** Picks the subject mask: the largest instance, preferring a person when present. */
function selectSubjectMask(
	masks: readonly YoloInstanceMask[],
): YoloInstanceMask | undefined {
	if (masks.length === 0) return undefined;
	let best = masks[0];
	for (const m of masks) {
		const mIsPerson = m.category.toLowerCase() === "person";
		const bestIsPerson = best.category.toLowerCase() === "person";
		if (mIsPerson && !bestIsPerson) {
			best = m;
			continue;
		}
		if (mIsPerson === bestIsPerson && m.area > best.area) best = m;
	}
	return best;
}

/**
 * Grows a person mask into connected foreground pixels — the COCO person head
 * drops a flowing dress (treats it as non-person), so seeding a flood fill from
 * the body through pixels that differ from the sampled backdrop recovers the
 * fabric without adding the near-uniform studio wall or its soft grey shadow.
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

function maskCentroid(mask: YoloInstanceMask): { cx: number; cy: number } {
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

export const YoloWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
		| YoloOperation
		| Record<string, unknown>
		| undefined;
	if (!rawOp) return;
	const op = normalizeOperation(rawOp);
	if (!op) return;

	// Close the incoming render pass to allow custom render passes
	pass.end();

	const childMedia = virtualMedia?.children?.[0];
	if (!childMedia) return;

	// 1. Persistent per-node child texture (see yoloChildTextures*). Reading the
	//    texture we just drew would race the end-of-frame submit; reading last
	//    frame's already-submitted pixels at the start of this call is correct.
	const effectKey = (op as { effect?: object }).effect;
	const hasEffectKey = effectKey !== undefined && effectKey !== null;
	const nodeKeyStr =
		(virtualMedia as any)?.id ??
		(rawOp as any)?.id ??
		`${targetWidth}x${targetHeight}_${op.mode}_${op.variant}_${op.keyBackground}_${op.backgroundKeyThreshold}`;
	const fallbackKey = `yolo-${nodeKeyStr}`;
	let childTex = hasEffectKey
		? yoloChildTexturesByEffect.get(effectKey as object)
		: yoloChildTexturesByKey.get(fallbackKey);
	if (
		childTex &&
		(childTex.width !== targetWidth || childTex.height !== targetHeight)
	) {
		childTex.destroy();
		childTex = undefined;
		if (hasEffectKey) yoloChildTexturesByEffect.delete(effectKey as object);
		else yoloChildTexturesByKey.delete(fallbackKey);
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
			label: "yolo_child_persistent",
		});
		if (hasEffectKey)
			yoloChildTexturesByEffect.set(effectKey as object, childTex);
		else yoloChildTexturesByKey.set(fallbackKey, childTex);
		// keep the fallback cache bounded across many renders in one process
		if (yoloChildTexturesByKey.size > 4) {
			const oldest = yoloChildTexturesByKey.keys().next().value;
			if (oldest && oldest !== fallbackKey) {
				yoloChildTexturesByKey.get(oldest)?.destroy();
				yoloChildTexturesByKey.delete(oldest);
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
			label: "yolo_frame_staging",
		});

		const readbackEncoder = ctx.device.createCommandEncoder({
			label: "yolo_readback_encoder",
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

	// 4. YOLO inference on the previous frame's pixels (models download lazily on
	//    first use of each task). Masks are therefore one frame behind the plate.
	const frameIdx = props.frame ?? 0;
	const visionBundle =
		(op.visionBundle as YoloVisionBundle | undefined) ??
		((virtualMedia as Record<string, unknown>).visionBundle as
			| YoloVisionBundle
			| undefined);
	const runner = await getSharedRunner(op);
	const image = framePixels
		? { data: framePixels, width: targetWidth, height: targetHeight }
		: null;

	if (
		image &&
		op.mode !== "obb" &&
		(op.enableDetection !== false ||
			op.mode === "boxes" ||
			op.mode === "tracking")
	) {
		const detections = await runner.detect(image);
		const tracker = getSharedObjectTracker(op);
		if (frameIdx === 0) {
			tracker.reset();
		}
		const tracked = tracker.update(detections, frameIdx, props.fps ?? 24);
		visionBundle?.setObjectResult(frameIdx, {
			objects: tracked,
			rawDetections: detections,
		});
	}

	const needsSegmentation =
		op.enableSegmentation === true ||
		op.mode === "mask" ||
		op.mode === "matte" ||
		op.mode === "crop";

	// Decoded masks are kept locally so mask-family modes render even without an
	// attached visionBundle (the round-trip through the bundle is for signal DX).
	let frameMasks: readonly YoloInstanceMask[] = [];
	if (image && needsSegmentation) {
		const segRes = await runner.segment(image);
		const tracked = visionBundle?.getObjectResult(frameIdx).objects ?? [];
		frameMasks = assignMasksToTracks(segRes.masks, tracked);
		visionBundle?.setMaskResult(frameIdx, frameMasks);
	}

	let currentPoseRes: YoloPoseResult | undefined;
	if (image && (op.enablePose === true || op.mode === "skeleton")) {
		const poseRes = await runner.pose(image);
		const normalized = normalizePoseKeypoints(
			poseRes,
			image.width,
			image.height,
		);
		const tracked = visionBundle?.getObjectResult(frameIdx).objects ?? [];
		const matchedPeople = matchPoseToTracks(normalized.people, tracked);
		currentPoseRes = { people: matchedPeople };
		visionBundle?.setPoseResult(frameIdx, currentPoseRes);
	}

	if (image && op.enableClassification === true) {
		const classifyRes = await runner.classify(image);
		visionBundle?.setClassifyResult(frameIdx, classifyRes);
	}

	if (image && (op.enableObb === true || op.mode === "obb")) {
		const obbRes = await runner.detectObb(image);
		visionBundle?.setObbResult(frameIdx, obbRes);
		// OBB detections also flow through the tracker so `objects.*` (and `bounds.angle`)
		// work in `obb` mode without a separate detect pass.
		const detections = obbRes.detections.map((d) => ({
			category: d.category,
			score: d.score,
			boundingBox: d.boundingBox,
		}));
		const tracker = getSharedObjectTracker(op);
		if (frameIdx === 0) {
			tracker.reset();
		}
		const tracked = tracker.update(detections, frameIdx, props.fps ?? 24);
		visionBundle?.setObjectResult(frameIdx, {
			objects: tracked,
			rawDetections: detections,
		});
	}

	// 5. Output to destination texture based on mode
	const mode = op.mode ?? "passthrough";

	// Mask-family modes composite from CPU pixels we already hold (frame + masks)
	if (mode === "mask" || mode === "matte" || mode === "crop") {
		if (!sharedTexturePool) {
			sharedTexturePool = new SegmentationTexturePool(ctx.device);
		}
		const masks =
			frameMasks.length > 0
				? frameMasks
				: (visionBundle?.getMaskResult(frameIdx) ?? []);
		const selected = selectSubjectMask(masks);
		let subject: YoloInstanceMask | undefined;
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

		// Opt-in: grow the person mask into the flowing dress (connected colourful
		// /dark fabric) so the dancer reads as a full body, not a torso cut-out.
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

	if (mode === "obb") {
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

		const detections = visionBundle?.getObbResult(frameIdx).detections ?? [];
		const obbColor = "#f59e0b";
		for (const det of detections) {
			if (det.corners.length < 4) continue;
			// Rotated quad stroked as an SVG path (corners are already source px).
			const path =
				det.corners
					.map(
						(corner, i) => `${i === 0 ? "M" : "L"} ${corner[0]} ${corner[1]}`,
					)
					.join(" ") + " Z";
			try {
				ctx.renderer.drawPath(outPass, path, obbColor, 2);
			} catch {
				// Fall back to the axis-aligned box if the path pipeline is unavailable.
				const b = det.boundingBox;
				ctx.renderer.drawRect(
					outPass,
					{ x: b.originX, y: b.originY, width: b.width, height: b.height },
					obbColor,
					2,
				);
			}
		}
		outPass.end();
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

		const objRes = visionBundle?.getObjectResult(frameIdx);
		if (objRes && objRes.objects.length > 0) {
			const boxColor = "#38bdf8";
			const stroke = 2;

			for (const obj of objRes.objects) {
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
	subject: YoloInstanceMask,
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

	const key = `yolo_composite_${nodeKeyStr}_${mode}_${frameIdx}`;
	const tex = pool.uploadMask(key, out, width, height);

	if (mode === "crop") {
		// punch-in: re-upload centered on the subject bbox (scaled to full frame)
		const box = subjectBoundingBox(subject);
		if (box) {
			const cropW = Math.max(1, Math.round(box.width));
			const cropH = Math.max(1, Math.round(box.height));
			const crop = new Uint8Array(width * height * 4);
			for (let y = 0; y < height; y++) {
				const srcY = Math.min(
					cropH - 1,
					Math.max(0, Math.round((y / height) * cropH)),
				);
				for (let x = 0; x < width; x++) {
					const srcX = Math.min(
						cropW - 1,
						Math.max(Math.round((x / width) * cropW)),
					);
					const srcIdx = (srcY * width + srcX) * 4;
					const dstIdx = (y * width + x) * 4;
					crop[dstIdx] = out[srcIdx];
					crop[dstIdx + 1] = out[srcIdx + 1];
					crop[dstIdx + 2] = out[srcIdx + 2];
					crop[dstIdx + 3] = out[srcIdx + 3];
				}
			}
			return pool.uploadMask(`yolo_crop_${frameIdx}`, crop, width, height);
		}
	}

	return tex;
}

function subjectBoundingBox(
	subject: YoloInstanceMask,
): { width: number; height: number } | null {
	// Derive the bbox from the mask's non-zero extent (cheap one-pass)
	const { mask, width } = subject;
	let minX = width;
	let minY = Infinity;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < subject.height; y++) {
		for (let x = 0; x < width; x++) {
			if (mask[y * width + x] > 0) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < minX || maxY < minY) return null;
	return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Legacy-compat: accepts a `MediaPipe` operation (from compositions targeting the old
 * node) and maps its flags onto the YOLO config — pose, object tracking, segmentation,
 * and passthrough/mask/skeleton/boxes/tracking modes all carry over.
 */
function normalizeOperation(
	raw: YoloOperation | Record<string, unknown>,
): YoloOperation | null {
	if (raw.op === "Yolo") return raw as YoloOperation;

	if (raw.op === "MediaPipe") {
		const legacy = raw as Record<string, unknown>;
		return {
			...raw,
			op: "Yolo",
			enableDetection:
				legacy.enableObjectTracking === true ||
				legacy.mode === "boxes" ||
				legacy.mode === "tracking",
			enablePose:
				legacy.enablePoseLandmarks === true || legacy.mode === "skeleton",
			enableSegmentation:
				legacy.enableSegmentation === true ||
				legacy.mode === "mask" ||
				legacy.mode === "matte",
			confidence: (legacy.objectScoreThreshold as number | undefined) ?? 0.25,
			iouThreshold: (legacy.iouThreshold as number | undefined) ?? 0.45,
			classes: (legacy.objectCategories as string[] | undefined) ?? undefined,
			modelsDir: (legacy.modelsDir as string | undefined) ?? undefined,
		} as unknown as YoloOperation;
	}

	return null;
}
