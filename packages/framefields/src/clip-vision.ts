import {
	type FrameSignal,
	mediaSourceRange,
	mediaSourceTime,
	type ResolvedMediaTimeRemap,
	Signal,
} from "@framefields/core";
import {
	type ClipPose,
	type ClipSubjectSource,
	COCO17_KEYPOINT_NAMES,
	type InstanceMask,
	maskObject,
	mergeSubjectMask,
	VisionBundle,
	VisionRunner,
} from "@framefields/vision";
import type {
	Sam2Options,
	Sam2Tracker,
	Sam3ObjectResult,
	Sam3Options,
	Sam3Tracker,
} from "@framefields/vision-sam";
import { mediaDecoderCache } from "@framefields/webgpu-renderers";
import type { VisionProps } from "./effects/index.js";

export type PoseKeypointName = (typeof COCO17_KEYPOINT_NAMES)[number];

export interface ClipVisionOptions {
	/** Prompted SAM 2.1 (Tiny or Small) video segmentation. Pose is opt-in in this mode, as with sam3. */
	sam2?: Sam2Options;
	/** SAM 3 point/box or text selection with temporal tracking. Mutually exclusive with sam2. */
	sam3?: Sam3Options;
	/** Explicitly agree to Meta's SAM License terms, required to download and run SAM 3. */
	acceptSamLicense?: boolean;
	/** Composition frame the clip's first frame plays on (default 0). */
	startFrame?: number;
	/** Seconds trimmed off the clip's start, as on its media layer (default 0). */
	trimStartSec?: number;
	/** The media layer's source-time mapping. */
	timeRemap?: ResolvedMediaTimeRemap;
	/** Media layer duration in composition frames, when known. */
	durationFrames?: number;
	/** Analysis frame rate (default: the composition's). */
	fps?: number;
	/**
	 * Track 17 COCO keypoints (default true; opt-in with sam2/sam3, where each frame's pose
	 * is the detected person whose keypoints fall most inside the selection).
	 */
	pose?: boolean;
	/** Track the person's silhouette, dress and held things included (default true). */
	mask?: boolean;
	/** Silhouette cell size in source pixels (default 8: a 1920×1080 clip gives a 240×135 grid). */
	maskCell?: number;
	/** Keypoints are averaged over ±`smoothing` frames, weighted by confidence (default 2; 0 = raw). */
	smoothing?: number;
	variant?: VisionProps["variant"];
	confidence?: number;
	modelsDir?: string;
	baseUrl?: string;
	/**
	 * Node: where results persist between runs. Default
	 * `$FRAMEFIELDS_VISION_CACHE_DIR` or `~/.cache/framefields/vision`;
	 * `false` keeps them in memory only. Browsers always keep them in memory.
	 */
	cacheDir?: string | false;
}

/** Where the clip sits in the composition, like a media layer's box and `fit`. */
export interface PersonPlacement {
	x?: number;
	y?: number;
	width: number;
	height: number;
	fit?: "cover" | "contain" | "fill";
}

interface FrameResult {
	score?: number;
	/** 17 × [x, y, visibility], source px; null when no person was found. */
	kp: Float32Array | null;
	/** cellW × cellH, 0–255; null when no person was found. */
	mask: Uint8Array | null;
}

/** A frame's merged subject at source resolution, run-length encoded. */
interface SubjectResult {
	category: string;
	area: number;
	/** (value, run length) pairs over the source-sized 0–255 mask. */
	values: Uint8Array;
	lengths: Uint32Array;
	/**
	 * Prompted (SAM) frames only: presence probability per track ID. The runs then hold a
	 * label map (track ID per pixel, 0 for none) instead of alpha.
	 */
	scores?: number[];
}

/** A subject as written to the subjects cache file. */
interface StoredSubject {
	category: string;
	area: number;
	scores?: number[];
	values: string;
	lengths: string;
}

interface Transform {
	sx: number;
	sy: number;
	ox: number;
	oy: number;
}

/** Frames looked back over to bridge a gap where the person is lost. */
const HOLD = 24;

const CACHE_VERSION = 1;

type VisionSam = typeof import("@framefields/vision-sam");

let visionSam: Promise<VisionSam> | undefined;
let clipVisionIds = 0;

/** SAM ships in its own chunk, loaded only when a clip asks for `sam2` or `sam3`. */
function loadVisionSam(): Promise<VisionSam> {
	visionSam ??= import("@framefields/vision-sam");
	return visionSam;
}

/**
 * Vision results for one clip, computed per frame on demand and shared by
 * everything that reads the clip: physics, layout, signals. Unlike the
 * render-time `withVision`, which analyses a layer's previous rendered frame,
 * this analyses the clip's own frames, so a result exists before its frame
 * renders. The composition analyses what each frame needs just before
 * drawing it (and a live physics world before stepping), so preview and
 * export fill the cache as they play; nothing has to be analysed up front.
 *
 * Results depend only on the clip and settings, so they persist on disk in
 * Node: a second run, or a render after a preview, reuses them. A matte-mode
 * `withVision` layer of the same clip reuses them too (`keepSubjects`).
 */
export class ClipVision implements ClipSubjectSource {
	readonly source: string;
	readonly fps: number;
	readonly compositionFps: number;
	readonly startFrame: number;
	readonly trimStartSec: number;
	readonly smoothing: number;
	/** @internal */
	readonly options: ClipVisionOptions;
	private readonly results = new Map<number, FrameResult>();
	private sourceWidth = 0;
	private sourceHeight = 0;
	private cellW = 0;
	private cellH = 0;
	private readonly cell: number;
	private queue: Promise<void> = Promise.resolve();
	private runner?: VisionRunner;
	private sam2Tracker?: Sam2Tracker;
	private sam2Frame = -1;
	private sam3Tracker?: Sam3Tracker;
	private sam3Frame = -1;
	private sam?: Promise<VisionSam>;
	/** Clips walk their source independently, so each owns a decoder (requests to one supersede). */
	private readonly decoderId = `clip-vision#${++clipVisionIds}#`;
	private signalBundle?: VisionBundle;
	private publishedSignals = new Set<number>();
	private signalMaskFrame = -1;
	/** Masks of `signalMaskFrame` by track ID (0: all tracks merged). */
	private readonly signalMasks = new Map<number, InstanceMask>();
	/** Prompted track count per source frame, including frames where every track is absent. */
	private readonly trackCounts = new Map<number, number>();
	private cacheLoaded?: Promise<void>;
	private unsaved = 0;
	private unsavedSubjects = 0;
	private readonly blurred = new Map<number, Float32Array | null>();
	private readonly smoothed = new Map<string, [number, number, number]>();
	private personView?: PersonTrack;
	/** Full-resolution subject masks for render-time mattes (see `keepSubjects`). */
	private readonly subjects = new Map<number, SubjectResult | null>();
	private wantSubjects = false;
	private subjectsLoaded?: Promise<void>;

	/** @internal Use `comp.vision(source, options)`. */
	constructor(source: string, fps: number, options: ClipVisionOptions = {}) {
		this.source = source;
		if (options.sam2 && options.sam3)
			throw new Error("Choose one prompted backend: sam2 or sam3.");
		this.options = options.sam2
			? {
					...options,
					sam2: {
						...options.sam2,
						prompts: options.sam2.prompts.map((prompt) => ({
							...prompt,
							points: prompt.points.map((point) => ({ ...point })),
						})),
					},
				}
			: options.sam3
				? {
						...options,
						sam3: {
							...options.sam3,
							prompts: (
								options.sam3.prompts ??
								(options.sam3.text
									? [{ frame: 0, text: options.sam3.text }]
									: [])
							).map((prompt) => ({
								...prompt,
								...(prompt.points
									? {
											points: prompt.points.map((point) => ({
												...point,
											})),
										}
									: {}),
							})),
						},
					}
				: options;
		this.compositionFps = fps;
		this.fps = options.fps ?? fps;
		this.startFrame = Math.round(options.startFrame ?? 0);
		this.trimStartSec = options.trimStartSec ?? 0;
		this.smoothing = Math.max(
			0,
			Math.round(options.smoothing ?? (options.sam2 || options.sam3 ? 0 : 2)),
		);
		this.cell = Math.max(1, Math.round(options.maskCell ?? 8));
		if (options.sam2 || options.sam3) this.wantSubjects = true;
	}

	/** @internal Explicit selections must never fall back to another detected subject. */
	get exact(): boolean {
		return this.options.sam2 !== undefined || this.options.sam3 !== undefined;
	}

	/** Object, mask and optional pose signals on the composition clock, in source geometry. */
	get signals(): VisionBundle {
		this.keepSubjects();
		this.signalBundle ??= new VisionBundle({
			fps: this.compositionFps,
			totalFrames: Number.MAX_SAFE_INTEGER,
			maskSource: (frame) =>
				this.trackIds(frame).flatMap((id) => {
					const mask = this.maskAt(frame, id);
					return mask && mask.area > 0 ? [mask] : [];
				}),
			matteSource: (frame) => {
				const mask = this.maskAt(frame);
				return mask
					? {
							mask: mask.mask,
							width: mask.width,
							height: mask.height,
							coverage: mask.coverage,
						}
					: undefined;
			},
		});
		return this.signalBundle;
	}

	private decoder(): ReturnType<typeof mediaDecoderCache.getVideo> {
		return mediaDecoderCache.getVideo(this.source, true, this.decoderId);
	}

	/** Free inference sessions and the decoder. Analysed frames remain readable; later frames replay memory. */
	release(): void {
		mediaDecoderCache.clearNode(this.decoderId);
		this.sam2Tracker?.release();
		this.sam2Tracker = undefined;
		this.sam2Frame = -1;
		this.sam3Tracker?.release();
		this.sam3Tracker = undefined;
		this.sam3Frame = -1;
		this.runner?.close();
		this.runner = undefined;
		this.signalMaskFrame = -1;
		this.signalMasks.clear();
		this.publishedSignals.clear();
	}

	/** The tracked person in source pixels; `.place()` maps it into the composition. */
	get person(): PersonTrack {
		this.personView ??= new PersonTrack(this);
		return this.personView;
	}

	/**
	 * Analyses what reading composition frame `frame` needs (it and a few
	 * neighbours for smoothing). Pass a second frame to analyse a whole range.
	 * Calls queue, so the clip is decoded once, in order.
	 */
	ready(frame: number, toFrame: number = frame): Promise<void> {
		const [from, to] = this.window(frame, toFrame);
		const run = this.queue.then(async () => {
			try {
				await this.compute(from, to);
			} catch (error) {
				this.release();
				throw error;
			}
			if (this.signalBundle)
				this.publishSignals(Math.min(frame, toFrame), Math.max(frame, toFrame));
		});
		this.queue = run.catch(() => undefined);
		return run;
	}

	/** True when composition frame `frame` can be read synchronously. */
	isReady(frame: number): boolean {
		const [from, to] = this.window(frame, frame);
		for (let c = from; c <= to; c++) if (!this.analysed(c)) return false;
		return true;
	}

	/**
	 * @internal Also keep each frame's full-resolution subject mask, merged
	 * like the Vision effect's matte, so a matte layer of this clip reuses it
	 * instead of segmenting the frame again (framefields links them).
	 */
	keepSubjects(): void {
		this.wantSubjects = true;
	}

	/**
	 * @internal The subject at a source frame of the clip (`frame` at `fps`),
	 * for a render-time matte: undefined until that frame is analysed with
	 * subjects kept, null when it holds no subject.
	 */
	subject(frame: number, fps: number): InstanceMask | null | undefined {
		const sourceFrame = this.sourceFrame(frame, fps);
		if (sourceFrame === undefined) return undefined;
		const s = this.subjects.get(sourceFrame);
		if (s === undefined) return s;
		if (s === null || !this.sourceWidth) return null;
		const width = this.sourceWidth;
		const height = this.sourceHeight;
		return {
			category: s.category,
			mask: subjectAlpha(s, width * height),
			width,
			height,
			area: s.area,
			coverage: s.area / (width * height),
			detectionIndex: -1,
		};
	}

	/**
	 * @internal The pose matched to the subject at a source frame of the clip
	 * (`frame` at `fps`), normalized to the source size, for a render-time
	 * skeleton: undefined until that frame and its smoothing window are
	 * analysed, null when no pose matched there.
	 */
	pose(frame: number, fps: number): ClipPose | null | undefined {
		const c = this.sourceFrame(frame, fps);
		if (c === undefined || !this.tracksPose || !this.sourceWidth) return;
		for (let g = c - this.smoothing; g <= c + this.smoothing; g++)
			if (!this.results.has(Math.max(0, g))) return undefined;
		if (!this.results.get(c)?.kp) return null;
		const width = this.sourceWidth;
		const height = this.sourceHeight;
		return {
			width,
			height,
			keypoints: Array.from({ length: 17 }, (_, k) => {
				const [x, y, visibility] = this.keypoint(k, c);
				return { x: x / width, y: y / height, visibility };
			}),
		};
	}

	/** Whether frames carry keypoints: on by default, opt-in for prompted (SAM) clips. */
	get tracksPose(): boolean {
		return this.exact
			? this.options.pose === true
			: (this.options.pose ?? true);
	}

	/**
	 * The analysed source frame a render-time read at `frame` (at `fps`) maps to;
	 * undefined for an unprompted clip read between its analysed frames.
	 */
	private sourceFrame(frame: number, fps: number): number | undefined {
		const c = (frame * this.fps) / fps;
		if (
			!this.exact &&
			!this.options.timeRemap &&
			Math.abs(c - Math.round(c)) > 1e-6
		)
			return undefined;
		return this.options.timeRemap || this.exact
			? Math.floor(c + 1e-6)
			: Math.round(c);
	}

	/** Composition frame → clip frame (fractional). */
	clipFrame(frame: number): number {
		if (this.options.timeRemap)
			return (
				mediaSourceTime(
					this.options.timeRemap,
					this.localFrame(frame),
					this.compositionFps,
				) * this.fps
			);
		return (
			((frame - this.startFrame) / this.compositionFps + this.trimStartSec) *
			this.fps
		);
	}

	private localFrame(frame: number): number {
		const local = Math.max(0, frame - this.startFrame);
		return this.options.durationFrames === undefined
			? local
			: Math.min(local, Math.max(0, this.options.durationFrames - 1));
	}

	private window(frame: number, toFrame: number): [number, number] {
		const range = this.options.timeRemap
			? mediaSourceRange(
					this.options.timeRemap,
					this.localFrame(Math.min(frame, toFrame)),
					this.localFrame(Math.max(frame, toFrame)),
					this.compositionFps,
				)
			: undefined;
		const a = Math.floor(
			range ? range.min * this.fps : this.clipFrame(Math.min(frame, toFrame)),
		);
		const b = Math.ceil(
			range ? range.max * this.fps : this.clipFrame(Math.max(frame, toFrame)),
		);
		return [
			Math.max(0, a - HOLD - this.smoothing),
			Math.max(0, b + this.smoothing),
		];
	}

	private analysed(c: number): boolean {
		return this.results.has(c) && (!this.wantSubjects || this.subjects.has(c));
	}

	/** Loads `@framefields/vision-sam` and validates the prompts once, on first use. */
	private prompted(): Promise<VisionSam> {
		this.sam ??= loadVisionSam().then((sam) => {
			if (this.options.sam2) sam.validateSam2Prompts(this.options.sam2.prompts);
			if (this.options.sam3) sam.validateSam3Prompts(this.options.sam3);
			return sam;
		});
		return this.sam;
	}

	private async compute(from: number, to: number): Promise<void> {
		if (this.exact) await this.prompted();
		this.cacheLoaded ??= this.loadCache();
		await this.cacheLoaded;
		if (this.wantSubjects) {
			this.subjectsLoaded ??= this.loadSubjects();
			await this.subjectsLoaded;
		}
		let missing = false;
		for (let c = from; c <= to; c++) if (!this.analysed(c)) missing = true;
		if (!missing) return;

		if (this.options.sam2) {
			await this.computeSam2(to);
			return;
		}
		if (this.options.sam3) {
			await this.computeSam3(to);
			return;
		}
		const wantPose = this.tracksPose;
		const wantMask = this.options.mask ?? true;
		this.runner ??= VisionRunner.create({
			modelsDir: this.options.modelsDir,
			baseUrl: this.options.baseUrl,
			...(this.options.confidence !== undefined && {
				confidence: this.options.confidence,
			}),
			...(this.options.variant !== undefined && {
				variant: this.options.variant,
			}),
		});
		const decoder = this.decoder();
		for (let c = from; c <= to; c++) {
			if (this.analysed(c)) continue;
			const image = await decodedPixels(await decoder.getFrame(c / this.fps));
			if (!image) {
				this.results.set(c, { kp: null, mask: null });
				if (this.wantSubjects) this.subjects.set(c, null);
				continue;
			}
			if (!this.sourceWidth) this.setSize(image.width, image.height);
			// Analysed before without subjects: only segment it again.
			const known = this.results.get(c);
			let kp: Float32Array | null = known?.kp ?? null;
			let mask: Uint8Array | null = known?.mask ?? null;
			if (wantPose && !known) {
				const person = (await this.runner.pose(image)).people[0];
				if (person) {
					kp = new Float32Array(51);
					for (const [k, p] of person.keypoints.entries()) {
						kp.set([p.x, p.y, p.visibility], k * 3);
					}
				}
			}
			const seg =
				(wantMask && !known) || this.wantSubjects
					? await this.runner.segment(image)
					: undefined;
			if (seg && this.wantSubjects) {
				const subject = mergeSubjectMask(seg.masks);
				this.subjects.set(
					c,
					subject
						? {
								category: subject.category,
								area: subject.area,
								...encodeRuns(subject.mask),
							}
						: null,
				);
				this.unsavedSubjects++;
			}
			if (seg && wantMask && !known) {
				const silhouette = personSilhouette(seg);
				if (silhouette) {
					mask = new Uint8Array(this.cellW * this.cellH);
					downsampleMean(
						silhouette,
						image.width,
						image.height,
						this.cell,
						mask,
						this.cellW,
						this.cellH,
					);
				}
			}
			this.results.set(c, { kp, mask });
			if (!known) this.unsaved++;
			if (this.unsaved >= 24) await this.saveCache();
			if (this.unsavedSubjects >= 24) await this.saveSubjects();
		}
		if (this.unsaved > 0) await this.saveCache();
		if (this.unsavedSubjects > 0) await this.saveSubjects();
	}

	private async computeSam2(to: number): Promise<void> {
		const settings = this.options.sam2;
		if (!settings) return;
		const first = settings.prompts[0]?.frame ?? 0;
		for (let frame = 0; frame < Math.min(first, to + 1); frame++) {
			this.results.set(frame, { kp: null, mask: null, score: 0 });
			this.subjects.set(frame, null);
		}
		if (to < first) return;
		const decoder = this.decoder();
		if (!this.sam2Tracker) {
			const frameCount = Math.max(
				1,
				Math.ceil((await decoder.durationSec()) * this.fps - 1e-6),
			);
			if (settings.prompts.some((prompt) => prompt.frame >= frameCount)) {
				throw new Error("SAM 2 prompt frames must be inside the source video.");
			}
			const { Sam2Tracker } = await this.prompted();
			this.sam2Tracker = await Sam2Tracker.create({
				modelsDir: this.options.modelsDir,
				baseUrl: this.options.baseUrl,
				frameCount,
				model: settings.model,
			});
			this.sam2Frame = first - 1;
		}
		for (let frame = this.sam2Frame + 1; frame <= to; frame++) {
			const image = await decodedPixels(
				await decoder.getFrame(frame / this.fps),
			);
			if (!image) throw new Error(`Cannot decode SAM 2 source frame ${frame}.`);
			if (!this.sourceWidth) this.setSize(image.width, image.height);
			const prompt = settings.prompts.find((item) => item.frame === frame);
			const result = await this.sam2Tracker.process(
				image,
				frame,
				prompt?.points,
			);
			const kp = this.tracksPose
				? await this.matchedPose(image, result.mask)
				: null;
			this.storeSamFrame(frame, result.width, result.height, [result], kp);
			if (this.unsaved >= 24) {
				await this.saveCache();
				await this.saveSubjects();
			}
		}
		await this.saveCache();
		await this.saveSubjects();
	}

	private async computeSam3(to: number): Promise<void> {
		const settings = this.options.sam3;
		if (!settings) return;
		const first = settings.prompts[0]?.frame ?? 0;
		for (let frame = 0; frame < Math.min(first, to + 1); frame++) {
			this.results.set(frame, { kp: null, mask: null, score: 0 });
			this.subjects.set(frame, null);
		}
		if (to < first) return;
		const decoder = this.decoder();
		if (!this.sam3Tracker) {
			const frameCount = Math.max(
				1,
				Math.ceil((await decoder.durationSec()) * this.fps - 1e-6),
			);
			if (settings.prompts.some((prompt) => prompt.frame >= frameCount)) {
				throw new Error("SAM 3 prompt frames must be inside the source video.");
			}
			const { Sam3Tracker } = await this.prompted();
			this.sam3Tracker = await Sam3Tracker.create({
				modelsDir: this.options.modelsDir,
				baseUrl: this.options.baseUrl,
				frameCount,
				textThreshold: settings.textThreshold,
				maxObjects: settings.maxObjects,
				merge: settings.merge,
				redetect: settings.redetect,
				precision: settings.precision,
				acceptLicense:
					this.options.acceptSamLicense ?? this.options.sam3?.acceptLicense,
			});
			this.sam3Frame = first - 1;
		}
		for (let frame = this.sam3Frame + 1; frame <= to; frame++) {
			const image = await decodedPixels(
				await decoder.getFrame(frame / this.fps),
			);
			if (!image) throw new Error(`Cannot decode SAM 3 source frame ${frame}.`);
			if (!this.sourceWidth) this.setSize(image.width, image.height);
			const prompt = settings.prompts.find((item) => item.frame === frame);
			const result = await this.sam3Tracker.process(image, frame, prompt);
			const kp = this.tracksPose
				? await this.matchedPose(image, unionMask(result.objects, image))
				: null;
			this.storeSamFrame(
				frame,
				result.width,
				result.height,
				result.objects,
				kp,
			);
			if (this.unsaved >= 24) {
				await this.saveCache();
				await this.saveSubjects();
			}
		}
		await this.saveCache();
		await this.saveSubjects();
	}

	/** Stores a prompted frame: every track's mask as one label map, the union as the subject. */
	private storeSamFrame(
		frame: number,
		width: number,
		height: number,
		objects: readonly Pick<Sam3ObjectResult, "mask" | "score">[],
		kp: Float32Array | null,
	): void {
		const labels = new Uint8Array(width * height);
		// Ascending presence, so where tracks overlap the most confident one keeps the pixel.
		const order = [...objects.keys()].sort(
			(a, b) => (objects[a]?.score ?? 0) - (objects[b]?.score ?? 0),
		);
		for (const index of order) {
			const mask = objects[index]?.mask;
			if (!mask) continue;
			for (let i = 0; i < mask.length; i++)
				if ((mask[i] ?? 0) >= 128) labels[i] = index + 1;
		}
		const union = Uint8Array.from(labels, (id) => (id ? 255 : 0));
		const grid = new Uint8Array(this.cellW * this.cellH);
		downsampleMean(
			union,
			width,
			height,
			this.cell,
			grid,
			this.cellW,
			this.cellH,
		);
		let area = 0;
		for (const id of labels) if (id) area++;
		const scores = objects.map((o) => 1 / (1 + Math.exp(-o.score)));
		this.results.set(frame, {
			kp,
			mask: grid,
			score: Math.max(0, ...scores),
		});
		this.subjects.set(
			frame,
			area > 0
				? { category: this.samCategory(), area, scores, ...encodeRuns(labels) }
				: null,
		);
		this.trackCounts.set(frame, objects.length);
		this.blurred.delete(frame);
		if (this.options.sam3) this.sam3Frame = frame;
		else this.sam2Frame = frame;
		this.unsaved++;
		this.unsavedSubjects++;
	}

	private samCategory(): string {
		return (
			this.options.sam2?.category ?? this.options.sam3?.category ?? "object"
		);
	}

	private async matchedPose(
		image: {
			data: Uint8Array | Uint8ClampedArray;
			width: number;
			height: number;
		},
		mask: Uint8Array,
	): Promise<Float32Array | null> {
		this.runner ??= VisionRunner.create({
			modelsDir: this.options.modelsDir,
			baseUrl: this.options.baseUrl,
			variant: this.options.variant,
		});
		const { people } = await this.runner.pose(image);
		const ranked = people
			.map((person) => ({
				person,
				overlap: person.keypoints.reduce((sum, point) => {
					const x = Math.max(0, Math.min(image.width - 1, Math.round(point.x)));
					const y = Math.max(
						0,
						Math.min(image.height - 1, Math.round(point.y)),
					);
					return (
						sum + ((mask[y * image.width + x] ?? 0) / 255) * point.visibility
					);
				}, 0),
			}))
			.sort((a, b) => b.overlap - a.overlap);
		const match = ranked[0];
		if (!match || match.overlap < 2) return null;
		return Float32Array.from(
			match.person.keypoints.flatMap((point) => [
				point.x,
				point.y,
				point.visibility,
			]),
		);
	}

	/** Track IDs at a composition frame: every prompted track, else the one subject. */
	private trackIds(frame: number): number[] {
		const c = Math.max(0, Math.floor(this.clipFrame(frame)));
		const count =
			this.subjects.get(c)?.scores?.length ?? this.trackCounts.get(c) ?? 1;
		return Array.from({ length: count }, (_, i) => i + 1);
	}

	/** The subject (all tracks merged) or, with `id`, one track's mask, in source pixels. */
	private maskAt(frame: number, id?: number): InstanceMask | undefined {
		const c = Math.max(0, Math.floor(this.clipFrame(frame)));
		if (this.signalMaskFrame !== c) {
			this.signalMaskFrame = c;
			this.signalMasks.clear();
		}
		const hit = this.signalMasks.get(id ?? 0);
		if (hit) return hit;
		if (!this.results.has(c) || !this.sourceWidth) return undefined;
		const stored = this.subjects.get(c);
		const size = this.sourceWidth * this.sourceHeight;
		const data = stored ? subjectAlpha(stored, size, id) : new Uint8Array(size);
		let area = stored?.area ?? 0;
		if (id !== undefined && stored?.scores) {
			area = 0;
			for (const alpha of data) if (alpha) area++;
		}
		const mask: InstanceMask = {
			category: stored?.category ?? this.samCategory(),
			mask: data,
			width: this.sourceWidth,
			height: this.sourceHeight,
			area,
			coverage: area / size,
			detectionIndex: (id ?? 1) - 1,
			trackId: id ?? 1,
		};
		this.signalMasks.set(id ?? 0, mask);
		return mask;
	}

	private publishSignals(from: number, to: number): void {
		const bundle = this.signalBundle;
		if (!bundle || !this.sourceWidth) return;
		bundle.setFrameSize(this.sourceWidth, this.sourceHeight);
		for (let frame = from; frame <= to; frame++) {
			if (this.publishedSignals.has(frame)) continue;
			this.publishedSignals.add(frame);
			const c = Math.max(0, Math.floor(this.clipFrame(frame)));
			const mask = this.maskAt(frame);
			if (!mask) continue;
			const before = bundle.getObjectResult(frame - 1).objects;
			const scores = this.subjects.get(c)?.scores;
			const objects = this.trackIds(frame).flatMap((id) => {
				const track = this.maskAt(frame, id);
				if (!track) return [];
				return [
					maskObject(
						track,
						frame,
						this.compositionFps,
						scores?.[id - 1] ?? this.results.get(c)?.score ?? 1,
						before.find((object) => object.trackId === id),
					),
				];
			});
			bundle.setObjectResult(frame, objects);
			const object =
				objects[0] ?? maskObject(mask, frame, this.compositionFps, 0);
			const kp = this.results.get(c)?.kp;
			bundle.setPoseResult(frame, {
				people: kp
					? [
							{
								score: object.score,
								boundingBox: object.boundingBox,
								trackId: 1,
								keypoints: Array.from({ length: 17 }, (_, i) => ({
									x: (kp[i * 3] ?? 0) / mask.width,
									y: (kp[i * 3 + 1] ?? 0) / mask.height,
									visibility: kp[i * 3 + 2] ?? 0,
								})),
							},
						]
					: [],
			});
		}
	}

	private setSize(width: number, height: number): void {
		this.sourceWidth = width;
		this.sourceHeight = height;
		this.cellW = Math.ceil(width / this.cell);
		this.cellH = Math.ceil(height / this.cell);
	}

	/** @internal */
	size(): { width: number; height: number } {
		return { width: this.sourceWidth, height: this.sourceHeight };
	}

	/** @internal Raw result for a clip frame, or throws when it was never analysed. */
	result(c: number): FrameResult | undefined {
		return this.results.get(Math.max(0, c));
	}

	/** @internal Confidence-weighted keypoint over the smoothing window, in source px. */
	keypoint(k: number, c: number): [number, number, number] {
		c = Math.max(0, c);
		const key = `${k}:${c}`;
		const hit = this.smoothed.get(key);
		if (hit) return hit;
		const avg = (center: number): [number, number, number] | null => {
			let sx = 0;
			let sy = 0;
			let sv = 0;
			let sw = 0;
			for (let g = center - this.smoothing; g <= center + this.smoothing; g++) {
				const r = this.mustHave(g < 0 ? 0 : g);
				if (!r.kp) continue;
				const v = r.kp[k * 3 + 2];
				const w = (this.smoothing + 1 - Math.abs(g - center)) * v * v;
				sx += r.kp[k * 3] * w;
				sy += r.kp[k * 3 + 1] * w;
				sv += v * w;
				sw += w;
			}
			return sw > 1e-6 ? [sx / sw, sy / sw, sv / sw] : null;
		};
		let out: [number, number, number] | null = null;
		// Lost? Hold the last place the person was seen (within HOLD frames).
		for (let d = 0; d <= HOLD && !out; d++) if (c - d >= 0) out = avg(c - d);
		out ??= [this.sourceWidth / 2, this.sourceHeight / 2, 0];
		this.smoothed.set(key, out);
		return out;
	}

	/** @internal Softened silhouette grid for a clip frame (null: no person). */
	blurredMask(c: number): Float32Array | null {
		c = Math.max(0, c);
		if (this.blurred.has(c)) return this.blurred.get(c) ?? null;
		this.mustHave(c);
		const mask = this.exact
			? (this.results.get(c)?.mask ?? null)
			: bridgedMask(this.results, c, this.smoothing);
		const grid = mask ? boxBlur(mask, this.cellW, this.cellH, 2) : null;
		this.blurred.set(c, grid);
		return grid;
	}

	/** @internal */
	grid(): { cell: number; width: number; height: number } {
		return { cell: this.cell, width: this.cellW, height: this.cellH };
	}

	private mustHave(c: number): FrameResult {
		const r = this.results.get(c);
		if (r) return r;
		throw new Error(
			`ClipVision "${this.source}": frame ${c} is not analysed yet. ` +
				"Read it while rendering (the composition prepares each frame), in a live physics world, " +
				`or after \`await clip.ready(frame)\`.`,
		);
	}

	// ── Persistence (Node) ────────────────────────────────────────────────

	private cacheFile?: string | null;

	private async cachePath(): Promise<string | null> {
		if (this.cacheFile !== undefined) return this.cacheFile;
		this.cacheFile = null;
		if (
			this.options.cacheDir === false ||
			typeof process === "undefined" ||
			!process.versions?.node
		) {
			return null;
		}
		try {
			const [fs, path, os, crypto] = await Promise.all([
				import("node:fs"),
				import("node:path"),
				import("node:os"),
				import("node:crypto"),
			]);
			const stat = fs.statSync(this.source);
			const dir =
				this.options.cacheDir ??
				process.env.FRAMEFIELDS_VISION_CACHE_DIR ??
				path.join(os.homedir(), ".cache", "framefields", "vision");
			const o = this.options;
			const sam = this.exact ? await this.prompted() : undefined;
			const key = JSON.stringify([
				CACHE_VERSION,
				path.resolve(this.source),
				stat.size,
				stat.mtimeMs,
				this.fps,
				this.tracksPose,
				o.mask ?? true,
				this.cell,
				o.variant ?? "s",
				o.confidence ?? null,
				// Prompted subjects are track-ID label maps (format 2); format 3 drops
				// entries keyed as tracking pose when SAM clips left it off by default.
				...(o.sam2 ? [[sam?.sam2Revision(o.sam2.model), o.sam2, 3]] : []),
				...(o.sam3 && sam
					? [
							[
								sam.sam3Revision(
									await sam.sam3Precision(undefined, o.sam3.precision),
								),
								o.sam3,
								3,
							],
						]
					: []),
			]);
			const hash = crypto
				.createHash("sha256")
				.update(key)
				.digest("hex")
				.slice(0, 24);
			fs.mkdirSync(dir, { recursive: true });
			this.cacheFile = path.join(
				dir,
				`${path.basename(this.source)}.${hash}.json`,
			);
		} catch {
			this.cacheFile = null; // remote URL or unreadable: memory only
		}
		return this.cacheFile;
	}

	private async loadCache(): Promise<void> {
		const file = await this.cachePath();
		if (!file) return;
		try {
			const fs = await import("node:fs");
			if (!fs.existsSync(file)) return;
			const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
				width: number;
				height: number;
				cell: number;
				frames: Record<
					string,
					{ kp: number[] | null; mask: string | null; score?: number }
				>;
			};
			if (json.cell !== this.cell) return;
			this.setSize(json.width, json.height);
			for (const [c, r] of Object.entries(json.frames)) {
				this.results.set(Number(c), {
					kp: r.kp ? Float32Array.from(r.kp) : null,
					score: r.score,
					mask: r.mask ? new Uint8Array(Buffer.from(r.mask, "base64")) : null,
				});
			}
		} catch {
			// A damaged cache is recomputed.
		}
	}

	private async saveCache(): Promise<void> {
		this.unsaved = 0;
		const file = await this.cachePath();
		if (!file || !this.sourceWidth) return;
		const frames: Record<
			string,
			{ kp: number[] | null; mask: string | null; score?: number }
		> = {};
		for (const [c, r] of this.results) {
			frames[c] = {
				kp: r.kp ? Array.from(r.kp, (v) => Math.round(v * 100) / 100) : null,
				mask: r.mask ? Buffer.from(r.mask).toString("base64") : null,
				score: r.score,
			};
		}
		const fs = await import("node:fs");
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(
			tmp,
			JSON.stringify({
				width: this.sourceWidth,
				height: this.sourceHeight,
				cell: this.cell,
				frames,
			}),
		);
		fs.renameSync(tmp, file);
	}

	/** Subjects live beside the results: large, and only matte layers read them. */
	private async subjectsPath(): Promise<string | null> {
		const file = await this.cachePath();
		return file ? file.replace(/\.json$/, ".subjects.json") : null;
	}

	private async loadSubjects(): Promise<void> {
		const file = await this.subjectsPath();
		if (!file) return;
		try {
			const fs = await import("node:fs");
			if (!fs.existsSync(file)) return;
			const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
				width: number;
				height: number;
				frames: Record<string, StoredSubject | null>;
			};
			if (this.sourceWidth && json.width !== this.sourceWidth) return;
			if (!this.sourceWidth) this.setSize(json.width, json.height);
			for (const [c, s] of Object.entries(json.frames)) {
				const lengths = Buffer.from(s?.lengths ?? "", "base64");
				this.subjects.set(
					Number(c),
					s && {
						category: s.category,
						area: s.area,
						...(s.scores && { scores: s.scores }),
						values: new Uint8Array(Buffer.from(s.values, "base64")),
						lengths: new Uint32Array(
							lengths.buffer.slice(
								lengths.byteOffset,
								lengths.byteOffset + lengths.byteLength,
							),
						),
					},
				);
			}
		} catch {
			// A damaged cache is recomputed.
		}
	}

	private async saveSubjects(): Promise<void> {
		this.unsavedSubjects = 0;
		const file = await this.subjectsPath();
		if (!file || !this.sourceWidth) return;
		const frames: Record<string, StoredSubject | null> = {};
		for (const [c, s] of this.subjects) {
			frames[c] = s && {
				category: s.category,
				area: s.area,
				...(s.scores && { scores: s.scores }),
				values: Buffer.from(s.values).toString("base64"),
				lengths: Buffer.from(
					s.lengths.buffer,
					s.lengths.byteOffset,
					s.lengths.byteLength,
				).toString("base64"),
			};
		}
		const fs = await import("node:fs");
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(
			tmp,
			JSON.stringify({
				width: this.sourceWidth,
				height: this.sourceHeight,
				frames,
			}),
		);
		fs.renameSync(tmp, file);
	}
}

/**
 * The person in a {@link ClipVision}: pose keypoints and silhouette at any
 * composition frame, in source pixels or, after `place()`, composition
 * pixels. Reads are synchronous; the frame must be analysed (it is while
 * rendering, inside a live physics world, or after `await clip.ready(frame)`).
 */
export class PersonTrack {
	/** @internal */
	constructor(
		readonly clip: ClipVision,
		private readonly t?: Transform,
		private readonly placement?: PersonPlacement,
	) {}

	/** The same person in composition pixels for a clip laid out at `placement`. */
	place(placement: PersonPlacement): PersonTrack {
		return new PersonTrack(this.clip, undefined, placement);
	}

	private transform(): Transform {
		if (this.t) return this.t;
		const p = this.placement;
		const { width: sw, height: sh } = this.clip.size();
		if (!p || !sw) return { sx: 1, sy: 1, ox: 0, oy: 0 };
		let sx = p.width / sw;
		let sy = p.height / sh;
		if (p.fit !== "fill") {
			const s = p.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
			sx = s;
			sy = s;
		}
		return {
			sx,
			sy,
			ox: (p.x ?? 0) + (p.width - sw * sx) / 2,
			oy: (p.y ?? 0) + (p.height - sh * sy) / 2,
		};
	}

	/** A keypoint at a composition frame (fractional frames interpolate). */
	point(
		name: PoseKeypointName,
		frame: number,
	): { x: number; y: number; visibility: number } {
		const k = keypointIndex(name);
		const c = this.clip.clipFrame(frame);
		const c0 = Math.floor(c);
		const u = c - c0;
		const a = this.clip.keypoint(k, c0);
		const b = u > 0 ? this.clip.keypoint(k, c0 + 1) : a;
		const t = this.transform();
		return {
			x: (a[0] + (b[0] - a[0]) * u) * t.sx + t.ox,
			y: (a[1] + (b[1] - a[1]) * u) * t.sy + t.oy,
			visibility: a[2] + (b[2] - a[2]) * u,
		};
	}

	/** Signals for a keypoint, for `.signal("x", …)`; read while rendering. */
	signals(name: PoseKeypointName): {
		x: FrameSignal<number>;
		y: FrameSignal<number>;
		visibility: FrameSignal<number>;
	} {
		const read = (axis: "x" | "y" | "visibility") =>
			Signal.builder({
				type: "custom",
				fn: (ctx) => this.point(name, ctx.frame)[axis],
			}) as FrameSignal<number>;
		return { x: read("x"), y: read("y"), visibility: read("visibility") };
	}

	/**
	 * @internal The softened silhouette grid at a composition frame and how
	 * placed px map onto it (`cell = (px − origin) / scale − 0.5`), for GPU
	 * consumers such as particles. Null when no person was found.
	 */
	silhouetteGrid(frame: number): {
		data: Float32Array;
		width: number;
		height: number;
		originX: number;
		originY: number;
		scaleX: number;
		scaleY: number;
	} | null {
		const grid = this.clip.blurredMask(Math.round(this.clip.clipFrame(frame)));
		if (!grid) return null;
		const { cell, width, height } = this.clip.grid();
		const t = this.transform();
		return {
			data: grid,
			width,
			height,
			originX: t.ox,
			originY: t.oy,
			scaleX: cell * t.sx,
			scaleY: cell * t.sy,
		};
	}

	/**
	 * The silhouette near a point at a composition frame: `alpha` 0–1 (softened
	 * over a few cells; inside > 0.5) and its gradient `gx`, `gy` per px,
	 * pointing into the body. Push things out with `-gradient`.
	 */
	sample(
		frame: number,
		x: number,
		y: number,
	): { alpha: number; gx: number; gy: number } {
		const grid = this.clip.blurredMask(Math.round(this.clip.clipFrame(frame)));
		if (!grid) return { alpha: 0, gx: 0, gy: 0 };
		const { cell, width: w, height: h } = this.clip.grid();
		const t = this.transform();
		const cx = (x - t.ox) / t.sx / cell - 0.5;
		const cy = (y - t.oy) / t.sy / cell - 0.5;
		const read = (gx: number, gy: number) =>
			gx < 0 || gy < 0 || gx >= w || gy >= h ? 0 : grid[gy * w + gx];
		const bil = (px: number, py: number) => {
			const x0 = Math.floor(px);
			const y0 = Math.floor(py);
			const ux = px - x0;
			const uy = py - y0;
			const a = read(x0, y0) + (read(x0 + 1, y0) - read(x0, y0)) * ux;
			const b =
				read(x0, y0 + 1) + (read(x0 + 1, y0 + 1) - read(x0, y0 + 1)) * ux;
			return a + (b - a) * uy;
		};
		return {
			alpha: bil(cx, cy),
			gx: (bil(cx + 1, cy) - bil(cx - 1, cy)) / (2 * cell * t.sx),
			gy: (bil(cx, cy + 1) - bil(cx, cy - 1)) / (2 * cell * t.sy),
		};
	}
}

function keypointIndex(name: PoseKeypointName): number {
	const i = COCO17_KEYPOINT_NAMES.indexOf(name);
	if (i < 0) {
		throw new Error(
			`Unknown keypoint "${name}". Use one of ${COCO17_KEYPOINT_NAMES.join(", ")}.`,
		);
	}
	return i;
}

/** RGBA pixels of a decoded frame (headless buffer, or a canvas in the browser). */
async function decodedPixels(
	frame: {
		width: number;
		height: number;
		buffer?: Uint8Array;
		canvas?: unknown;
	} | null,
): Promise<{
	data: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
} | null> {
	if (!frame || frame.width <= 0) return null;
	if (frame.buffer)
		return { data: frame.buffer, width: frame.width, height: frame.height };
	const canvas = frame.canvas as
		| {
				getContext(type: "2d"): {
					getImageData(
						x: number,
						y: number,
						w: number,
						h: number,
					): { data: Uint8ClampedArray };
				} | null;
		  }
		| undefined;
	const ctx = canvas?.getContext("2d");
	if (!ctx) return null;
	return {
		data: ctx.getImageData(0, 0, frame.width, frame.height).data,
		width: frame.width,
		height: frame.height,
	};
}

type Segmentation = Awaited<ReturnType<VisionRunner["segment"]>>;

/**
 * The largest person's mask, plus instances that overlap it and are no more
 * than twice its size (a flowing dress often comes back as "kite").
 */
function personSilhouette(seg: Segmentation): Uint8Array | undefined {
	return mergeSubjectMask(seg.masks, {
		classes: ["person"],
		overlap: 0.2,
		maxGrowth: 3.5,
	})?.mask;
}

function maskSum(m: Uint8Array | null | undefined): number {
	if (!m) return 0;
	let s = 0;
	for (let i = 0; i < m.length; i++) s += m[i];
	return s;
}

/**
 * Bridges 1–2 frame segmentation part dropouts (e.g. a fast-spinning skirt
 * missed on a single frame) across the smoothing window.
 */
function bridgedMask(
	results: Map<number, FrameResult>,
	c: number,
	smoothing: number,
): Uint8Array | null {
	const base = results.get(c)?.mask ?? null;
	if (smoothing <= 0) return base;
	const baseSum = maskSum(base);
	let prevFrame = -1;
	let prevMask: Uint8Array | null = null;
	let nextFrame = -1;
	let nextMask: Uint8Array | null = null;
	const threshold = Math.max(1000, baseSum * 1.35);

	for (let d = 1; d <= smoothing + 1; d++) {
		if (prevFrame < 0 && c - d >= 0) {
			const m = results.get(c - d)?.mask ?? null;
			if (maskSum(m) > threshold) {
				prevFrame = c - d;
				prevMask = m;
			}
		}
		if (nextFrame < 0) {
			const m = results.get(c + d)?.mask ?? null;
			if (maskSum(m) > threshold) {
				nextFrame = c + d;
				nextMask = m;
			}
		}
	}
	if (!prevMask && !nextMask) return base;
	const ref = prevMask ?? nextMask;
	if (!ref) return base;
	const out = base ? new Uint8Array(base) : new Uint8Array(ref.length);
	if (prevMask && nextMask && nextFrame > prevFrame) {
		const u = (c - prevFrame) / (nextFrame - prevFrame);
		for (let i = 0; i < out.length; i++) {
			const v = Math.round(prevMask[i] + (nextMask[i] - prevMask[i]) * u);
			if (v > out[i]) out[i] = v;
		}
	} else {
		for (let i = 0; i < out.length; i++) {
			if (ref[i] > out[i]) out[i] = ref[i];
		}
	}
	return out;
}

function downsampleMean(
	src: Uint8Array,
	w: number,
	h: number,
	cell: number,
	dst: Uint8Array,
	mw: number,
	mh: number,
): void {
	for (let my = 0; my < mh; my++) {
		for (let mx = 0; mx < mw; mx++) {
			let sum = 0;
			let n = 0;
			for (let y = my * cell; y < Math.min(h, (my + 1) * cell); y++) {
				for (let x = mx * cell; x < Math.min(w, (mx + 1) * cell); x++) {
					sum += src[y * w + x];
					n++;
				}
			}
			dst[my * mw + mx] = n ? Math.round(sum / n) : 0;
		}
	}
}

/** A mask as (value, run length) pairs: long flat runs with soft edges. */
function encodeRuns(mask: Uint8Array): {
	values: Uint8Array;
	lengths: Uint32Array;
} {
	let runs = 0;
	for (let i = 1; i <= mask.length; i++)
		if (i === mask.length || mask[i] !== mask[i - 1]) runs++;
	const values = new Uint8Array(runs);
	const lengths = new Uint32Array(runs);
	let r = 0;
	let start = 0;
	for (let i = 1; i <= mask.length; i++) {
		if (i === mask.length || mask[i] !== mask[start]) {
			values[r] = mask[start];
			lengths[r++] = i - start;
			start = i;
		}
	}
	return { values, lengths };
}

function decodeRuns(
	runs: { values: Uint8Array; lengths: Uint32Array },
	size: number,
): Uint8Array {
	const out = new Uint8Array(size);
	let at = 0;
	for (let r = 0; r < runs.values.length; r++) {
		const end = Math.min(size, at + runs.lengths[r]);
		if (runs.values[r] !== 0) out.fill(runs.values[r], at, end);
		at = end;
	}
	return out;
}

/** Separable box blur to 0–1, so gradients reach a little past the edge. */
function boxBlur(
	src: Uint8Array,
	w: number,
	h: number,
	r: number,
): Float32Array {
	const tmp = new Float32Array(w * h);
	const dst = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			let n = 0;
			for (let k = -r; k <= r; k++) {
				const xx = x + k;
				if (xx >= 0 && xx < w) {
					s += src[y * w + xx];
					n++;
				}
			}
			tmp[y * w + x] = s / n / 255;
		}
	}
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			let n = 0;
			for (let k = -r; k <= r; k++) {
				const yy = y + k;
				if (yy >= 0 && yy < h) {
					s += tmp[yy * w + x];
					n++;
				}
			}
			dst[y * w + x] = s / n;
		}
	}
	return dst;
}

type SeedFrame = {
	kp: number[] | null;
	mask: Uint8Array | null;
	/** Source-sized subject mask for render-time mattes; null = no subject. */
	subject?: Uint8Array | null;
};

/** @internal Test hook: a clip whose results are given instead of computed. */
export function clipVisionFromResults(
	fps: number,
	size: { width: number; height: number; cell: number },
	frames: SeedFrame[],
	options: ClipVisionOptions = {},
): ClipVision {
	const clip = new ClipVision("memory", fps, {
		...options,
		maskCell: size.cell,
		cacheDir: false,
	});
	return seedClipVision(clip, size, frames);
}

/** @internal Test hook: gives a clip's per-frame results instead of computing them. */
export function seedClipVision(
	clip: ClipVision,
	size: { width: number; height: number },
	frames: SeedFrame[],
): ClipVision {
	const c = clip as unknown as {
		setSize(w: number, h: number): void;
		results: Map<number, FrameResult>;
		subjects: Map<number, SubjectResult | null>;
	};
	c.setSize(size.width, size.height);
	frames.forEach((f, i) => {
		c.results.set(i, {
			kp: f.kp ? Float32Array.from(f.kp) : null,
			mask: f.mask,
		});
		if (f.subject === undefined) return;
		let area = 0;
		for (const v of f.subject ?? []) area += v;
		c.subjects.set(
			i,
			f.subject && {
				category: "person",
				area: Math.round(area / 255),
				...encodeRuns(f.subject),
			},
		);
	});
	return clip;
}

/** A stored subject as 0/255 alpha: label maps merge every track, or keep track `id` only. */
function subjectAlpha(
	stored: SubjectResult,
	size: number,
	id?: number,
): Uint8Array {
	const values = decodeRuns(stored, size);
	if (!stored.scores) return values;
	return values.map((label) =>
		(id === undefined ? label > 0 : label === id) ? 255 : 0,
	);
}

/** Every track's mask merged, for matching one pose to the whole selection. */
function unionMask(
	objects: readonly Pick<Sam3ObjectResult, "mask">[],
	image: { width: number; height: number },
): Uint8Array {
	const union = new Uint8Array(image.width * image.height);
	for (const { mask } of objects)
		for (let i = 0; i < union.length; i++)
			union[i] = Math.max(union[i] ?? 0, mask[i] ?? 0);
	return union;
}
