import { type FrameSignal, Signal } from "@framefields/core";
import { COCO17_KEYPOINT_NAMES, VisionRunner } from "@framefields/vision";
import { mediaDecoderCache } from "@framefields/webgpu-renderers";
import type { VisionProps } from "./effects/index.js";

export type PoseKeypointName = (typeof COCO17_KEYPOINT_NAMES)[number];

export interface ClipVisionOptions {
	/** Composition frame the clip's first frame plays on (default 0). */
	startFrame?: number;
	/** Seconds trimmed off the clip's start, as on its media layer (default 0). */
	trimStartSec?: number;
	/** Analysis frame rate (default: the composition's). */
	fps?: number;
	/** Track 17 COCO keypoints (default true). */
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
	/** 17 × [x, y, visibility], source px; null when no person was found. */
	kp: Float32Array | null;
	/** cellW × cellH, 0–255; null when no person was found. */
	mask: Uint8Array | null;
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
 * Node: a second run, or a render after a preview, reuses them.
 */
export class ClipVision {
	readonly source: string;
	readonly fps: number;
	readonly startFrame: number;
	readonly trimStartSec: number;
	readonly smoothing: number;
	private readonly options: ClipVisionOptions;
	private readonly results = new Map<number, FrameResult>();
	private sourceWidth = 0;
	private sourceHeight = 0;
	private cellW = 0;
	private cellH = 0;
	private readonly cell: number;
	private queue: Promise<void> = Promise.resolve();
	private runner?: VisionRunner;
	private cacheLoaded?: Promise<void>;
	private unsaved = 0;
	private readonly blurred = new Map<number, Float32Array | null>();
	private readonly smoothed = new Map<string, [number, number, number]>();
	private personView?: PersonTrack;

	/** @internal Use `comp.vision(source, options)`. */
	constructor(source: string, fps: number, options: ClipVisionOptions = {}) {
		this.source = source;
		this.options = options;
		this.fps = options.fps ?? fps;
		this.startFrame = Math.round(options.startFrame ?? 0);
		this.trimStartSec = options.trimStartSec ?? 0;
		this.smoothing = Math.max(0, Math.round(options.smoothing ?? 2));
		this.cell = Math.max(1, Math.round(options.maskCell ?? 8));
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
		this.queue = this.queue.then(() => this.compute(from, to));
		return this.queue;
	}

	/** True when composition frame `frame` can be read synchronously. */
	isReady(frame: number): boolean {
		const [from, to] = this.window(frame, frame);
		for (let c = from; c <= to; c++) if (!this.results.has(c)) return false;
		return true;
	}

	/** Composition frame → clip frame (fractional). */
	clipFrame(frame: number): number {
		return frame - this.startFrame + this.trimStartSec * this.fps;
	}

	private window(frame: number, toFrame: number): [number, number] {
		const a = Math.floor(this.clipFrame(Math.min(frame, toFrame)));
		const b = Math.ceil(this.clipFrame(Math.max(frame, toFrame)));
		return [
			Math.max(0, a - HOLD - this.smoothing),
			Math.max(0, b + this.smoothing),
		];
	}

	private async compute(from: number, to: number): Promise<void> {
		this.cacheLoaded ??= this.loadCache();
		await this.cacheLoaded;
		let missing = false;
		for (let c = from; c <= to; c++) if (!this.results.has(c)) missing = true;
		if (!missing) return;

		const wantPose = this.options.pose ?? true;
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
		const decoder = mediaDecoderCache.getVideo(
			this.source,
			true,
			"clip-vision",
		);
		for (let c = from; c <= to; c++) {
			if (this.results.has(c)) continue;
			const image = await decodedPixels(await decoder.getFrame(c / this.fps));
			if (!image) {
				this.results.set(c, { kp: null, mask: null });
				continue;
			}
			if (!this.sourceWidth) this.setSize(image.width, image.height);
			let kp: Float32Array | null = null;
			let mask: Uint8Array | null = null;
			if (wantPose) {
				const person = (await this.runner.pose(image)).people[0];
				if (person) {
					kp = new Float32Array(51);
					for (const [k, p] of person.keypoints.entries()) {
						kp.set([p.x, p.y, p.visibility], k * 3);
					}
				}
			}
			if (wantMask) {
				const silhouette = personSilhouette(await this.runner.segment(image));
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
			if (++this.unsaved >= 24) await this.saveCache();
		}
		if (this.unsaved > 0) await this.saveCache();
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
		const r = this.mustHave(c);
		const grid = r.mask ? boxBlur(r.mask, this.cellW, this.cellH, 2) : null;
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
			const key = JSON.stringify([
				CACHE_VERSION,
				path.resolve(this.source),
				stat.size,
				stat.mtimeMs,
				this.fps,
				o.pose ?? true,
				o.mask ?? true,
				this.cell,
				o.variant ?? "s",
				o.confidence ?? null,
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
				frames: Record<string, { kp: number[] | null; mask: string | null }>;
			};
			if (json.cell !== this.cell) return;
			this.setSize(json.width, json.height);
			for (const [c, r] of Object.entries(json.frames)) {
				this.results.set(Number(c), {
					kp: r.kp ? Float32Array.from(r.kp) : null,
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
		const frames: Record<string, { kp: number[] | null; mask: string | null }> =
			{};
		for (const [c, r] of this.results) {
			frames[c] = {
				kp: r.kp ? Array.from(r.kp, (v) => Math.round(v * 100) / 100) : null,
				mask: r.mask ? Buffer.from(r.mask).toString("base64") : null,
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

/** @internal Test hook: a clip whose results are given instead of computed. */
export function clipVisionFromResults(
	fps: number,
	size: { width: number; height: number; cell: number },
	frames: Array<{ kp: number[] | null; mask: Uint8Array | null }>,
	options: ClipVisionOptions = {},
): ClipVision {
	const clip = new ClipVision("memory", fps, {
		...options,
		maskCell: size.cell,
		cacheDir: false,
	});
	const c = clip as unknown as {
		setSize(w: number, h: number): void;
		results: Map<number, FrameResult>;
	};
	c.setSize(size.width, size.height);
	frames.forEach((f, i) => {
		c.results.set(i, {
			kp: f.kp ? Float32Array.from(f.kp) : null,
			mask: f.mask,
		});
	});
	return clip;
}
