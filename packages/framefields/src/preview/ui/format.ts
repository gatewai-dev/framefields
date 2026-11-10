/** Pure helpers for the preview page: time, the address fragment, the ruler, notes as text. */
import type { PreviewNote } from "../protocol.js";

/** Frame as m:ss.ss on the film's clock. */
export function timecode(frame: number, fps: number): string {
	const s = frame / fps;
	const m = Math.floor(s / 60);
	return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}

export function clampFrame(frame: number, frameCount: number): number {
	return Math.max(0, Math.min(frameCount - 1, Math.round(frame)));
}

/** Where a frame sits on the timeline, 0–100. */
export function framePercent(frame: number, frameCount: number): number {
	return frameCount > 1 ? (frame / (frameCount - 1)) * 100 : 0;
}

/**
 * The frame an address fragment names: `#t=12.5` (seconds) or `#frame=300`,
 * clamped to the film. Null when it names none.
 */
export function frameFromHash(
	hash: string,
	fps: number,
	frameCount: number,
): number | null {
	const t = /[#&]t=([\d.]+)/.exec(hash);
	if (t) return clampFrame(Number(t[1]) * fps, frameCount);
	const f = /[#&]frame=(\d+)/.exec(hash);
	if (f) return clampFrame(Number(f[1]), frameCount);
	return null;
}

/** The fragment that keeps a position across reloads; empty at the start. */
export function hashForFrame(frame: number, fps: number): string {
	return frame > 0 ? `#t=${Number((frame / fps).toFixed(3))}` : "";
}

export interface RulerTick {
	/** 0–100 across the timeline. */
	left: number;
	major: boolean;
	label?: string;
}

const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Ticks for a film `durationSec` long on a timeline `width` px wide: majors at least 80 px apart. */
export function rulerTicks(durationSec: number, width: number): RulerTick[] {
	if (durationSec <= 0) return [];
	const major =
		RULER_STEPS.find((s) => (s / durationSec) * width >= 80) ?? 1200;
	const minor = major / 5;
	const ticks: RulerTick[] = [];
	for (let i = 0; i * minor <= durationSec + 1e-6; i++) {
		const t = i * minor;
		const isMajor = i % 5 === 0;
		const x = (t / durationSec) * width;
		const tick: RulerTick = { left: (t / durationSec) * 100, major: isMajor };
		if (isMajor && x < width - 34) {
			const m = Math.floor(t / 60);
			const s = Math.round((t - m * 60) * 10) / 10;
			tick.label = `${m}:${s < 10 ? "0" : ""}${s}`;
		}
		ticks.push(tick);
	}
	return ticks;
}

export function byFrame(a: PreviewNote, b: PreviewNote): number {
	return a.frame - b.frame || a.id - b.id;
}

/** Notes on the timeline: ones close together stack, up to three high. */
export function markLanes(
	notes: readonly PreviewNote[],
	frameCount: number,
	width: number,
): Array<{ note: PreviewNote; lane: number; left: number }> {
	const lanes: number[] = [];
	return [...notes].sort(byFrame).map((note) => {
		const left = framePercent(note.frame, frameCount);
		const x = (left / 100) * width;
		let lane = lanes.findIndex((end) => x - end >= 16);
		if (lane < 0) lane = lanes.length < 3 ? lanes.length : 2;
		lanes[lane] = x;
		return { note, lane, left };
	});
}

function percent(v: number): string {
	return `${Math.round(v * 100)}%`;
}

/** Where on the frame a note points, as words. */
export function whereText(n: {
	x: number;
	y: number;
	w?: number;
	h?: number;
}): string {
	return n.w != null && n.h != null
		? `area ${percent(n.x)},${percent(n.y)} to ${percent(n.x + n.w)},${percent(n.y + n.h)}`
		: `spot ${percent(n.x)},${percent(n.y)}`;
}

/** The open notes as text, for a chat that can't read the notes folder. */
export function openNotesText(
	title: string,
	notes: readonly PreviewNote[],
	fps: number,
): string {
	const lines = [`Notes on the preview of ${JSON.stringify(title)}:`];
	for (const n of notes.filter((n) => !n.done).sort(byFrame)) {
		lines.push(
			`- Note ${n.id} at ${timecode(n.frame, fps)} (frame ${n.frame}), ${whereText(n)}: ${n.text}${n.image ? ` [picture: ${n.image}]` : ""}`,
		);
	}
	return lines.join("\n");
}

/** How the transport shows the position: as time, or as frames. */
export type PositionMode = "time" | "frames";

/** The position readout: "0:01.50 / 0:02.97", or "45 / 89" (current / last frame). */
export function positionText(
	mode: PositionMode,
	frame: number,
	lastFrame: number,
	fps: number,
): { now: string; end: string } {
	return mode === "frames"
		? { now: String(frame), end: String(lastFrame) }
		: { now: timecode(frame, fps), end: timecode(lastFrame, fps) };
}
