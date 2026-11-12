/**
 * How much work a traced frame does, for slow and fast machines alike.
 *
 * Final renders are deterministic: a frame takes exactly `samples` samples
 * per pixel with a seed from its frame number, whatever the GPU, so a split
 * cloud render's chunks match and a slow machine renders the same picture,
 * only later. Slow GPUs are protected by the dispatch size instead: work is
 * cut into tiles of at most `maxPixelsPerDispatch` pixel-samples, so no
 * single dispatch runs into an OS GPU watchdog.
 *
 * Interactive previews spend a GPU time budget instead: timestamp queries
 * measure what a sample costs on this machine, and the next frame takes as
 * many samples as fit (up to the preset), or, when even one sample at full
 * resolution does not fit, traces at a lower resolution that the resolve
 * pass filters back up.
 */

export type PathTraceQuality = "draft" | "standard" | "high" | "reference";

export interface PathTraceOptions {
	/**
	 * Preset (default "high"):
	 * - draft: 8 samples, 3 bounces, denoised. Quick looks; final renders on slow GPUs.
	 * - standard: 32 samples, 5 bounces, denoised. Faster finals for simple scenes.
	 * - high: 128 samples, 8 bounces, denoised. Clean finals, glass, interiors, product shots.
	 * - reference: 1024 samples, 16 bounces, no denoiser and no clamping (ground truth).
	 */
	quality?: PathTraceQuality;
	/** Samples per pixel of every rendered frame (overrides the preset). */
	samples?: number;
	/** Light bounces after the first hit (overrides the preset). */
	bounces?: number;
	/** Filter the remaining noise, guided by albedo, normals and depth. */
	denoise?: boolean;
	/** Brightest indirect light per sample (luminance); 0 turns clamping off. Removes fireflies at a small energy loss. */
	clamp?: number;
	/** Longest side a layer picture or material map keeps in the trace atlas, px. */
	textureSize?: number;
	/**
	 * Path regularization 0..1: once a path has scattered diffusely, every
	 * surface it reaches is at least this rough. Light that reaches a matte
	 * surface by way of a mirror or glass (caustics: a chrome ball or a glossy
	 * floor throwing a light's reflection onto a wall) then arrives as a soft
	 * glow instead of rare bright speckles that flicker frame to frame. What
	 * the camera sees directly stays sharp. 0 is unbiased.
	 */
	filterGlossy?: number;
	/** Interactive preview only: GPU time a frame's tracing may take, ms. Default 33. */
	previewBudgetMs?: number;
}

export interface PathTraceSettings {
	samples: number;
	bounces: number;
	denoise: boolean;
	clamp: number;
	textureSize: number;
	filterGlossy: number;
	/** Bounce from which Russian roulette may end a path. */
	rouletteDepth: number;
	previewBudgetMs: number;
}

const PRESETS: Record<
	PathTraceQuality,
	Omit<PathTraceSettings, "previewBudgetMs">
> = {
	draft: {
		samples: 8,
		bounces: 3,
		denoise: true,
		clamp: 8,
		textureSize: 1024,
		filterGlossy: 0.7,
		rouletteDepth: 2,
	},
	standard: {
		samples: 32,
		filterGlossy: 0.6,
		bounces: 5,
		denoise: true,
		clamp: 16,
		textureSize: 2048,
		rouletteDepth: 3,
	},
	high: {
		samples: 128,
		filterGlossy: 0.45,
		bounces: 8,
		denoise: true,
		clamp: 32,
		textureSize: 2048,
		rouletteDepth: 4,
	},
	reference: {
		samples: 1024,
		bounces: 16,
		denoise: false,
		clamp: 0,
		textureSize: 4096,
		filterGlossy: 0,
		rouletteDepth: 6,
	},
};

function positiveInt(
	value: number | undefined,
	name: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(
			`pathTrace.${name} must be a positive integer, got ${value}`,
		);
	}
	return value;
}

/** The preset with the options laid over it. */
export function resolvePathTrace(
	options: boolean | PathTraceOptions,
): PathTraceSettings {
	const o = options === true || options === false ? {} : options;
	const preset = PRESETS[o.quality ?? "high"];
	if (!preset) {
		throw new Error(
			`pathTrace.quality must be one of ${Object.keys(PRESETS).join(", ")}, got ${o.quality}`,
		);
	}
	const bounces = o.bounces ?? preset.bounces;
	if (!Number.isInteger(bounces) || bounces < 0 || bounces > 64) {
		throw new Error(
			`pathTrace.bounces must be an integer 0..64, got ${bounces}`,
		);
	}
	return {
		samples: positiveInt(o.samples, "samples") ?? preset.samples,
		bounces,
		denoise: o.denoise ?? preset.denoise,
		clamp: Math.max(0, o.clamp ?? preset.clamp),
		textureSize:
			positiveInt(o.textureSize, "textureSize") ?? preset.textureSize,
		filterGlossy: Math.max(
			0,
			Math.min(1, o.filterGlossy ?? preset.filterGlossy),
		),
		rouletteDepth: Math.min(preset.rouletteDepth, bounces),
		previewBudgetMs: Math.max(1, o.previewBudgetMs ?? 33),
	};
}

/**
 * Pixel-samples one dispatch may take. A path with a few bounces costs a
 * fraction of a microsecond on a fast GPU and some microseconds on a slow
 * one; a quarter million keeps a dispatch well under a second even on
 * integrated GPUs, far from the 2 s watchdogs.
 */
export const MAX_PIXELS_PER_DISPATCH = 1 << 18;

/** Tiles (in pixels) that cover a width × height trace within the dispatch cap. */
export function dispatchTiles(
	width: number,
	height: number,
	maxPixels = MAX_PIXELS_PER_DISPATCH,
): { x: number; y: number; w: number; h: number }[] {
	const tiles: { x: number; y: number; w: number; h: number }[] = [];
	if (width <= maxPixels) {
		// Whole rows: as many as fit.
		const rows = Math.floor(maxPixels / width);
		for (let y = 0; y < height; y += rows) {
			tiles.push({ x: 0, y, w: width, h: Math.min(rows, height - y) });
		}
		return tiles;
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x += maxPixels) {
			tiles.push({ x, y, w: Math.min(maxPixels, width - x), h: 1 });
		}
	}
	return tiles;
}

/** What an interactive frame traces. */
export interface PreviewPlan {
	samples: number;
	/** Trace resolution as a fraction of the target's. */
	scale: number;
}

/** Smallest preview resolution scale: below this a frame says nothing. */
const MIN_SCALE = 0.25;

/**
 * Learns what a sample costs on this GPU from measured frames and plans the
 * next one inside the budget.
 */
export class PreviewBudget {
	/** GPU milliseconds per sample per million pixels; unknown until measured. */
	private msPerMegaSample: number | null = null;
	/** GPU milliseconds per million pixels after tracing (denoise, resolve), whatever the samples. */
	private msPerMegaPixel = 0;

	/**
	 * Folds in a measured frame: its tracing and what followed (exponential
	 * averages; the newest frame weighs 30%).
	 */
	record(
		traceMs: number,
		postMs: number,
		samples: number,
		pixels: number,
	): void {
		if (!(traceMs > 0) || samples <= 0 || pixels <= 0) return;
		const mp = pixels / 1e6;
		const trace = traceMs / (samples * mp);
		const post = Math.max(0, postMs) / mp;
		const first = this.msPerMegaSample === null;
		this.msPerMegaSample = first
			? trace
			: (this.msPerMegaSample as number) * 0.7 + trace * 0.3;
		this.msPerMegaPixel = first ? post : this.msPerMegaPixel * 0.7 + post * 0.3;
	}

	get measured(): boolean {
		return this.msPerMegaSample !== null;
	}

	/**
	 * The next frame's samples and scale. Before any measurement (or without
	 * timestamp queries) a frame takes one sample at half resolution: cheap
	 * on any GPU, and the measurement it yields sizes the frames after it.
	 */
	plan(
		width: number,
		height: number,
		settings: PathTraceSettings,
	): PreviewPlan {
		if (this.msPerMegaSample === null) return { samples: 1, scale: 0.5 };
		const mp = (width * height) / 1e6;
		const sample = this.msPerMegaSample * mp;
		const post = this.msPerMegaPixel * mp;
		const fit = Math.floor((settings.previewBudgetMs - post) / sample);
		if (fit >= 1) return { samples: Math.min(fit, settings.samples), scale: 1 };
		// One sample, at the resolution whose whole frame fits.
		const scale = Math.sqrt(settings.previewBudgetMs / (sample + post));
		return { samples: 1, scale: Math.max(MIN_SCALE, Math.min(1, scale)) };
	}
}
