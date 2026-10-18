import { type FrameSignal, Signal } from "@framefields/core";
import { COCO17_KEYPOINT_NAMES, VisionRunner } from "@framefields/vision";
import { mediaDecoderCache } from "@framefields/webgpu-renderers";
import type { VisionProps } from "./effects/index.js";

export type PoseKeypointName = (typeof COCO17_KEYPOINT_NAMES)[number];

export interface TrackPersonOptions {
	/** Frames per second to sample (default: the composition's). */
	fps?: number;
	/** How many frames (default: the composition's length). */
	totalFrames?: number;
	/** Track 17 COCO keypoints (default true). */
	pose?: boolean;
	/** Track the person's silhouette, dress and held things included (default true). */
	mask?: boolean;
	/** Silhouette cell size in source pixels (default 8: a 1920×1080 clip gives a 240×135 grid). */
	maskCell?: number;
	/** Frames of zero-lag smoothing on keypoints (default 2; 0 for raw). */
	smoothing?: number;
	/** Keypoints below this visibility count as missing and are filled from neighbours (default 0.3). */
	minVisibility?: number;
	variant?: VisionProps["variant"];
	confidence?: number;
	modelsDir?: string;
	baseUrl?: string;
	onProgress?: (frame: number, total: number) => void;
}

/** Where the clip sits in the composition, like a media layer's box and `fit`. */
export interface PersonTrackPlacement {
	x?: number;
	y?: number;
	width: number;
	height: number;
	fit?: "cover" | "contain" | "fill";
}

/** Plain-JSON form, for caching an analysis between runs. */
export interface PersonTrackJSON {
	version: 1;
	fps: number;
	frames: number;
	sourceWidth: number;
	sourceHeight: number;
	/** frames × 17 × [x, y, visibility], source px, smoothed. */
	keypoints?: number[];
	mask?: { cell: number; width: number; height: number; data: string };
}

interface Transform {
	sx: number;
	sy: number;
	ox: number;
	oy: number;
}

const IDENTITY: Transform = { sx: 1, sy: 1, ox: 0, oy: 0 };

/**
 * One person tracked through a clip ahead of rendering: smoothed pose
 * keypoints and a soft silhouette, frame by frame. Unlike the render-time
 * vision signals it is complete before the first frame renders, so it can
 * drive physics (limbs as kinematic bodies, the silhouette as a force field),
 * be keyframed, or be inspected. `place()` maps it into composition pixels.
 */
export class PersonTrack {
	readonly fps: number;
	readonly frames: number;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	private readonly kp?: Float32Array;
	private readonly maskData?: {
		cell: number;
		width: number;
		height: number;
		data: Uint8Array;
	};
	private blurred?: Float32Array[];

	private constructor(
		json: Omit<PersonTrackJSON, "keypoints" | "mask" | "version">,
		kp: Float32Array | undefined,
		mask: PersonTrack["maskData"],
		private readonly t: Transform = IDENTITY,
		shared?: PersonTrack,
	) {
		this.fps = json.fps;
		this.frames = json.frames;
		this.sourceWidth = json.sourceWidth;
		this.sourceHeight = json.sourceHeight;
		this.kp = kp;
		this.maskData = mask;
		if (shared) this.blurred = shared.blurredMasks();
	}

	static fromJSON(json: PersonTrackJSON): PersonTrack {
		const mask = json.mask
			? {
					cell: json.mask.cell,
					width: json.mask.width,
					height: json.mask.height,
					data: new Uint8Array(Buffer.from(json.mask.data, "base64")),
				}
			: undefined;
		return new PersonTrack(
			json,
			json.keypoints ? Float32Array.from(json.keypoints) : undefined,
			mask,
		);
	}

	toJSON(): PersonTrackJSON {
		const m = this.maskData;
		return {
			version: 1,
			fps: this.fps,
			frames: this.frames,
			sourceWidth: this.sourceWidth,
			sourceHeight: this.sourceHeight,
			...(this.kp && {
				keypoints: Array.from(this.kp, (v) => Math.round(v * 100) / 100),
			}),
			...(m && {
				mask: {
					cell: m.cell,
					width: m.width,
					height: m.height,
					data: Buffer.from(m.data).toString("base64"),
				},
			}),
		};
	}

	/** The same track in composition pixels for a clip laid out at `placement`. */
	place(placement: PersonTrackPlacement): PersonTrack {
		const { width: W, height: H } = placement;
		const sw = this.sourceWidth;
		const sh = this.sourceHeight;
		let sx = W / sw;
		let sy = H / sh;
		if (placement.fit !== "fill") {
			const s =
				placement.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
			sx = s;
			sy = s;
		}
		const t: Transform = {
			sx,
			sy,
			ox: (placement.x ?? 0) + (W - sw * sx) / 2,
			oy: (placement.y ?? 0) + (H - sh * sy) / 2,
		};
		return new PersonTrack(this, this.kp, this.maskData, t, this);
	}

	/** Whether the clip had pose / silhouette tracking. */
	get hasPose(): boolean {
		return this.kp !== undefined;
	}
	get hasMask(): boolean {
		return this.maskData !== undefined;
	}

	/** A keypoint at a frame (fractional frames interpolate), placed px. */
	point(
		name: PoseKeypointName,
		frame: number,
	): { x: number; y: number; visibility: number } {
		const kp = this.requirePose();
		const k = keypointIndex(name);
		const f = Math.max(0, Math.min(this.frames - 1, frame));
		const f0 = Math.floor(f);
		const f1 = Math.min(this.frames - 1, f0 + 1);
		const u = f - f0;
		const at = (fi: number, c: number) => kp[(fi * 17 + k) * 3 + c];
		const lerp = (c: number) => at(f0, c) + (at(f1, c) - at(f0, c)) * u;
		return {
			x: lerp(0) * this.t.sx + this.t.ox,
			y: lerp(1) * this.t.sy + this.t.oy,
			visibility: lerp(2),
		};
	}

	/** Per-frame signals for a keypoint (placed px), for `.signal("x", …)` or physics `follow`. */
	signals(
		name: PoseKeypointName,
		options: { startFrame?: number } = {},
	): {
		x: FrameSignal<number>;
		y: FrameSignal<number>;
		visibility: FrameSignal<number>;
	} {
		const start = options.startFrame ?? 0;
		const x = new Float32Array(start + this.frames);
		const y = new Float32Array(start + this.frames);
		const v = new Float32Array(start + this.frames);
		for (let f = 0; f < start + this.frames; f++) {
			const p = this.point(name, f - start);
			x[f] = p.x;
			y[f] = p.y;
			v[f] = p.visibility;
		}
		return {
			x: Signal.fromArray(x, this.fps),
			y: Signal.fromArray(y, this.fps),
			visibility: Signal.fromArray(v, this.fps),
		};
	}

	/**
	 * The silhouette near a point (placed px) at a frame: `alpha` 0–1 (softened
	 * over a few cells), and its gradient `gx`, `gy` per px, pointing into the
	 * body. Push things out with `-gradient`; `alpha > 0.5` is inside.
	 */
	sample(
		frame: number,
		x: number,
		y: number,
	): { alpha: number; gx: number; gy: number } {
		const m = this.requireMask();
		const grids = this.blurredMasks();
		const fi = Math.max(0, Math.min(this.frames - 1, Math.round(frame)));
		const grid = grids[fi];
		// Placed px → mask cells.
		const cx = (x - this.t.ox) / this.t.sx / m.cell - 0.5;
		const cy = (y - this.t.oy) / this.t.sy / m.cell - 0.5;
		const read = (gx: number, gy: number) => {
			if (gx < 0 || gy < 0 || gx >= m.width || gy >= m.height) return 0;
			return grid[gy * m.width + gx];
		};
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
		const alpha = bil(cx, cy);
		const pxPerCellX = m.cell * this.t.sx;
		const pxPerCellY = m.cell * this.t.sy;
		return {
			alpha,
			gx: (bil(cx + 1, cy) - bil(cx - 1, cy)) / (2 * pxPerCellX),
			gy: (bil(cx, cy + 1) - bil(cx, cy - 1)) / (2 * pxPerCellY),
		};
	}

	private requirePose(): Float32Array {
		if (!this.kp) throw new Error("PersonTrack: tracked without `pose`.");
		return this.kp;
	}

	private requireMask(): NonNullable<PersonTrack["maskData"]> {
		if (!this.maskData) throw new Error("PersonTrack: tracked without `mask`.");
		return this.maskData;
	}

	/** Silhouette per frame, softened by a small box blur so gradients reach past the edge. */
	private blurredMasks(): Float32Array[] {
		if (this.blurred) return this.blurred;
		const m = this.requireMask();
		const { width: w, height: h } = m;
		const r = 2;
		const out: Float32Array[] = [];
		const tmp = new Float32Array(w * h);
		for (let f = 0; f < this.frames; f++) {
			const src = m.data.subarray(f * w * h, (f + 1) * w * h);
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
			out.push(dst);
		}
		this.blurred = out;
		return out;
	}

	/** @internal */
	static fromAnalysis(
		meta: {
			fps: number;
			frames: number;
			sourceWidth: number;
			sourceHeight: number;
		},
		kp: Float32Array | undefined,
		mask: PersonTrack["maskData"],
	): PersonTrack {
		return new PersonTrack(meta, kp, mask);
	}
}

function keypointIndex(name: PoseKeypointName): number {
	const i = COCO17_KEYPOINT_NAMES.indexOf(name);
	if (i < 0) {
		throw new Error(
			`PersonTrack: unknown keypoint "${name}". Use one of ${COCO17_KEYPOINT_NAMES.join(", ")}.`,
		);
	}
	return i;
}

/** Runs pose and segmentation over a clip and returns a {@link PersonTrack}. */
export async function trackPerson(
	source: string,
	options: TrackPersonOptions & { fps: number; totalFrames: number },
): Promise<PersonTrack> {
	const { fps, totalFrames } = options;
	const wantPose = options.pose ?? true;
	const wantMask = options.mask ?? true;
	const cell = Math.max(1, Math.round(options.maskCell ?? 8));
	const minVis = options.minVisibility ?? 0.3;
	const runner = VisionRunner.create({
		modelsDir: options.modelsDir,
		baseUrl: options.baseUrl,
		...(options.confidence !== undefined && { confidence: options.confidence }),
		...(options.variant !== undefined && { variant: options.variant }),
	});
	const decoder = mediaDecoderCache.getVideo(source, true);

	let sourceWidth = 0;
	let sourceHeight = 0;
	const kp = wantPose ? new Float32Array(totalFrames * 17 * 3) : undefined;
	let maskW = 0;
	let maskH = 0;
	let maskData: Uint8Array | undefined;

	try {
		for (let i = 0; i < totalFrames; i++) {
			const decoded = await decoder.getFrame(i / fps);
			if (!decoded?.buffer || decoded.width <= 0) continue;
			const frame = {
				data: decoded.buffer,
				width: decoded.width,
				height: decoded.height,
			};
			if (!sourceWidth) {
				sourceWidth = frame.width;
				sourceHeight = frame.height;
				maskW = Math.ceil(sourceWidth / cell);
				maskH = Math.ceil(sourceHeight / cell);
				if (wantMask) maskData = new Uint8Array(totalFrames * maskW * maskH);
			}
			if (kp) {
				const { people } = await runner.pose(frame);
				const person = people[0];
				if (person) {
					person.keypoints.forEach((p, k) => {
						kp.set([p.x, p.y, p.visibility], (i * 17 + k) * 3);
					});
				}
			}
			if (maskData) {
				const seg = await runner.segment(frame);
				const union = personSilhouette(seg);
				if (union)
					downsampleMean(
						union,
						frame.width,
						frame.height,
						cell,
						maskData,
						i * maskW * maskH,
						maskW,
						maskH,
					);
			}
			options.onProgress?.(i + 1, totalFrames);
		}
	} finally {
		runner.close();
		decoder.destroy();
	}
	if (!sourceWidth)
		throw new Error(`trackPerson: could not decode any frame of "${source}".`);
	if (kp) smoothKeypoints(kp, totalFrames, minVis, options.smoothing ?? 2);

	return PersonTrack.fromAnalysis(
		{ fps, frames: totalFrames, sourceWidth, sourceHeight },
		kp,
		maskData && { cell, width: maskW, height: maskH, data: maskData },
	);
}

type Segmentation = Awaited<ReturnType<VisionRunner["segment"]>>;

/**
 * The largest person's mask, plus instances that overlap it and are no more
 * than twice its size (a flowing dress often comes back as "kite").
 */
function personSilhouette(seg: Segmentation): Uint8Array | undefined {
	const people = seg.masks.filter((m) => m.category === "person");
	if (people.length === 0) return undefined;
	const person = people.reduce((a, b) => (b.area > a.area ? b : a));
	const box = seg.detections[person.detectionIndex]?.boundingBox;
	const out = new Uint8Array(person.mask);
	if (!box) return out;
	for (const m of seg.masks) {
		if (m === person || m.area > person.area * 2) continue;
		const b = seg.detections[m.detectionIndex]?.boundingBox;
		if (!b) continue;
		const ix = Math.max(
			0,
			Math.min(box.originX + box.width, b.originX + b.width) -
				Math.max(box.originX, b.originX),
		);
		const iy = Math.max(
			0,
			Math.min(box.originY + box.height, b.originY + b.height) -
				Math.max(box.originY, b.originY),
		);
		if (ix * iy < 0.3 * b.width * b.height) continue;
		for (let i = 0; i < out.length; i++)
			if (m.mask[i] > out[i]) out[i] = m.mask[i];
	}
	return out;
}

function downsampleMean(
	src: Uint8Array,
	w: number,
	h: number,
	cell: number,
	dst: Uint8Array,
	offset: number,
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
			dst[offset + my * mw + mx] = n ? Math.round(sum / n) : 0;
		}
	}
}

/**
 * Fills missing keypoints from their nearest seen frames, then runs a
 * forward and a backward exponential filter (no lag, no overshoot).
 */
function smoothKeypoints(
	kp: Float32Array,
	frames: number,
	minVis: number,
	smoothing: number,
): void {
	for (let k = 0; k < 17; k++) {
		const idx = (f: number, c: number) => (f * 17 + k) * 3 + c;
		const seen: number[] = [];
		for (let f = 0; f < frames; f++) if (kp[idx(f, 2)] >= minVis) seen.push(f);
		if (seen.length === 0) continue;
		let s = 0;
		for (let f = 0; f < frames; f++) {
			if (kp[idx(f, 2)] >= minVis) continue;
			while (s + 1 < seen.length && seen[s + 1] < f) s++;
			const a = seen[s];
			const b = seen.find((v) => v > f);
			for (const c of [0, 1]) {
				if (f < a || b === undefined) kp[idx(f, c)] = kp[idx(a, c)];
				else {
					const u = (f - a) / (b - a);
					kp[idx(f, c)] = kp[idx(a, c)] + (kp[idx(b, c)] - kp[idx(a, c)]) * u;
				}
			}
		}
		if (smoothing <= 0) continue;
		const alpha = 1 / (1 + smoothing);
		for (const c of [0, 1]) {
			for (let f = 1; f < frames; f++)
				kp[idx(f, c)] += (kp[idx(f - 1, c)] - kp[idx(f, c)]) * (1 - alpha);
			for (let f = frames - 2; f >= 0; f--)
				kp[idx(f, c)] += (kp[idx(f + 1, c)] - kp[idx(f, c)]) * (1 - alpha);
		}
	}
}
