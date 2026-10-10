import { usageError } from "./errors.js";

/**
 * A frame reference: a frame number (`60`), seconds (`2.5s`), milliseconds
 * (`1500ms`), a clock time (`02:15`, `00:02:15`, `00:02:15.5`) or SMPTE
 * `hh:mm:ss:ff`. Returns the frame index at `fps`.
 */
export function parseFrame(value: string, fps: number): number {
	const v = value.trim();
	let frame: number | undefined;
	if (/^\d+$/.test(v)) frame = Number(v);
	else if (/^\d+(\.\d+)?s$/.test(v)) frame = Number(v.slice(0, -1)) * fps;
	else if (/^\d+(\.\d+)?ms$/.test(v))
		frame = (Number(v.slice(0, -2)) / 1000) * fps;
	else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(v)) {
		const parts = v.split(":").map(Number);
		const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
		frame = seconds * fps;
	} else if (/^\d+:\d{1,2}:\d{1,2}:\d{1,3}$/.test(v)) {
		const [h = 0, m = 0, s = 0, f = 0] = v.split(":").map(Number);
		if (f >= Math.ceil(fps))
			throw usageError(`'${value}': frame ${f} is past ${fps} fps`);
		frame = (h * 3600 + m * 60 + s) * fps + f;
	}
	if (frame === undefined || !Number.isFinite(frame)) {
		throw usageError(
			`'${value}' is not a frame or timecode`,
			"use a frame number (60), seconds (2.5s), milliseconds (1500ms) or a time (00:02:15)",
		);
	}
	return Math.round(frame);
}

export const looksLikeFrame = (value: string) =>
	/^(\d+|\d+(\.\d+)?m?s|\d+(:\d{1,2}){1,3}(\.\d+)?)$/.test(value.trim());

/** `from..to` or `from-to` (either side optional). */
export function parseRange(
	value: string,
	fps: number,
): { from?: number; to?: number } {
	const sep = value.includes("..") ? ".." : "-";
	const i = value.indexOf(sep);
	if (i === -1)
		throw usageError(
			`'${value}' is not a range`,
			"use --range <from>..<to>, e.g. 0..120 or 2s..5s",
		);
	const a = value.slice(0, i).trim();
	const b = value.slice(i + sep.length).trim();
	return {
		from: a ? parseFrame(a, fps) : undefined,
		to: b ? parseFrame(b, fps) : undefined,
	};
}

/** `count` frames spread evenly over [from, to], inclusive and distinct. */
export function spreadFrames(
	from: number,
	to: number,
	count: number,
): number[] {
	if (count <= 1 || to <= from) return [from];
	const frames = Array.from({ length: count }, (_, i) =>
		Math.round(from + (i * (to - from)) / (count - 1)),
	);
	return [...new Set(frames)];
}

export const frameFileName = (frame: number) =>
	`f${String(frame).padStart(4, "0")}.png`;
