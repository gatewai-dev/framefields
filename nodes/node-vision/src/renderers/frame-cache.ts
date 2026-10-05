/**
 * Per-frame vision results, so a frame is analysed once. A source frame gives
 * the same detections and masks for the same model and settings, so replays,
 * scrubbing back and later renders in the same process reuse them instead of
 * running inference again.
 *
 * Masks are run-length encoded: they are long flat runs with soft edges, so a
 * frame-sized mask shrinks from megabytes to tens of kilobytes.
 */
import type {
	InstanceMask,
	SegmentationResult,
	TrackedObject,
} from "@gitframes/vision";

type DetectedObject = SegmentationResult["detections"][number];

/** A frame-sized 0..255 mask as (value, run length) pairs. */
export interface RleMask {
	readonly width: number;
	readonly height: number;
	readonly values: Uint8Array;
	readonly lengths: Uint32Array;
}

let scratchValues = new Uint8Array(0);
let scratchLengths = new Uint32Array(0);

export function encodeMask(
	mask: Uint8Array,
	width: number,
	height: number,
): RleMask {
	// One pass into reused worst-case buffers; masks are flat almost
	// everywhere, so the copies at the end are small.
	if (scratchValues.length < mask.length) {
		scratchValues = new Uint8Array(mask.length);
		scratchLengths = new Uint32Array(mask.length);
	}
	const values = scratchValues;
	const lengths = scratchLengths;
	let runs = 0;
	let start = 0;
	for (let i = 1; i <= mask.length; i++) {
		if (i === mask.length || mask[i] !== mask[start]) {
			values[runs] = mask[start];
			lengths[runs] = i - start;
			runs++;
			start = i;
		}
	}
	return {
		width,
		height,
		values: values.slice(0, runs),
		lengths: lengths.slice(0, runs),
	};
}

export function decodeMask(rle: RleMask): Uint8Array {
	const out = new Uint8Array(rle.width * rle.height);
	let at = 0;
	for (let r = 0; r < rle.values.length; r++) {
		const end = at + rle.lengths[r];
		if (rle.values[r] !== 0) out.fill(rle.values[r], at, end);
		at = end;
	}
	return out;
}

function rleBytes(rle: RleMask): number {
	return rle.values.byteLength + rle.lengths.byteLength;
}

export interface CachedInstanceMask extends Omit<InstanceMask, "mask"> {
	readonly rle: RleMask;
}

export interface VisionFrameResult {
	readonly detections: readonly DetectedObject[];
	readonly objects: readonly TrackedObject[];
	/** Instance masks, kept only when a vision bundle reads them back. */
	readonly masks: readonly CachedInstanceMask[] | null;
	/** The composited subject (after hold and background keying); null = none. */
	readonly subject: { readonly mask: CachedInstanceMask } | null;
	/** Background-key threshold the subject was grown with. */
	readonly keyThreshold?: number;
}

export function toCachedMask(mask: InstanceMask): CachedInstanceMask {
	const { mask: data, ...rest } = mask;
	return { ...rest, rle: encodeMask(data, mask.width, mask.height) };
}

export function fromCachedMask(mask: CachedInstanceMask): InstanceMask {
	const { rle, ...rest } = mask;
	return { ...rest, mask: decodeMask(rle) };
}

function resultBytes(result: VisionFrameResult): number {
	let bytes =
		512 + result.detections.length * 128 + result.objects.length * 256;
	for (const m of result.masks ?? []) bytes += rleBytes(m.rle);
	if (result.subject) bytes += rleBytes(result.subject.mask.rle);
	return bytes;
}

/** Results by source (node + inference settings) and frame, least recently used out first. */
export class VisionFrameCache {
	private readonly entries = new Map<string, VisionFrameResult>();
	private bytes = 0;

	constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

	get(source: string, frame: number): VisionFrameResult | undefined {
		const key = `${source}#${frame}`;
		const hit = this.entries.get(key);
		if (hit) {
			this.entries.delete(key);
			this.entries.set(key, hit);
		}
		return hit;
	}

	set(source: string, frame: number, result: VisionFrameResult): void {
		const key = `${source}#${frame}`;
		const old = this.entries.get(key);
		if (old) {
			this.bytes -= resultBytes(old);
			this.entries.delete(key);
		}
		this.entries.set(key, result);
		this.bytes += resultBytes(result);
		for (const [k, v] of this.entries) {
			if (this.bytes <= this.maxBytes) break;
			this.entries.delete(k);
			this.bytes -= resultBytes(v);
		}
	}

	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}

	get size(): number {
		return this.entries.size;
	}
}
