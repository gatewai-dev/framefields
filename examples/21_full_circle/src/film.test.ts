import { describe, expect, it } from "vitest";
import { analyzeBeatGrid } from "./beat-grid.js";
import { cleanTrack, measureCircle } from "./circles.js";
import { CUTS, EDIT, poseAt, windowAt } from "./edit.js";
import { buildFilm } from "./film.js";
import { bar, beat, DURATION, GRID } from "./grid.js";
import { layerOffset } from "./plates.js";
import { SHOTS } from "./shots.js";
import { FPS, H, W } from "./theme.js";
import { decodeWav } from "./wav.js";

/** A click track: a kick on every downbeat, hats on the other beats, loud from `loudFromBar`. */
function clickTrack(
	bpm: number,
	offsetSec: number,
	seconds: number,
	loudFromBar: number,
	sr = 22050,
): Float32Array {
	const out = new Float32Array(Math.round(seconds * sr));
	const beatSec = 60 / bpm;
	for (let k = 0; offsetSec + k * beatSec < seconds; k++) {
		const start = Math.round((offsetSec + k * beatSec) * sr);
		const downbeat = k % 4 === 0;
		const gain = k / 4 >= loudFromBar ? 1 : 0.25;
		for (let i = 0; i < sr * 0.08 && start + i < out.length; i++) {
			const env = Math.exp(-i / (sr * 0.015));
			const tone = downbeat
				? Math.sin((2 * Math.PI * 60 * i) / sr)
				: Math.sin((2 * Math.PI * 3000 * i) / sr) * 0.4;
			out[start + i] += gain * env * tone;
		}
	}
	return out;
}

describe("beat grid", () => {
	it("recovers tempo, downbeat and drop from a click track", () => {
		const sr = 22050;
		const grid = analyzeBeatGrid(clickTrack(117, 0.37, 30, 6, sr), sr, {
			bpmHint: 120,
		});
		expect(grid.bpm).toBeCloseTo(117, 0);
		expect(Math.abs(grid.downbeatSec - 0.37)).toBeLessThan(0.02);
		expect(grid.dropBar).toBe(6);
	});
});

describe("wav", () => {
	it("decodes 16-bit stereo PCM to mono", () => {
		const frames = [
			[16384, -16384],
			[32767, 32767],
		];
		const data = Buffer.alloc(frames.length * 4);
		frames.forEach(([l, r], i) => {
			data.writeInt16LE(l, i * 4);
			data.writeInt16LE(r, i * 4 + 2);
		});
		const fmt = Buffer.alloc(16);
		fmt.writeUInt16LE(1, 0);
		fmt.writeUInt16LE(2, 2);
		fmt.writeUInt32LE(44100, 4);
		fmt.writeUInt32LE(44100 * 4, 8);
		fmt.writeUInt16LE(4, 12);
		fmt.writeUInt16LE(16, 14);
		const chunk = (id: string, body: Buffer) =>
			Buffer.concat([
				Buffer.from(id),
				Buffer.from(new Uint32Array([body.length]).buffer),
				body,
			]);
		const wave = Buffer.concat([
			Buffer.from("WAVE"),
			chunk("fmt ", fmt),
			chunk("LIST", Buffer.alloc(6)),
			chunk("data", data),
		]);
		const { samples, sampleRate } = decodeWav(chunk("RIFF", wave));
		expect(sampleRate).toBe(44100);
		expect(samples[0]).toBeCloseTo(0, 6);
		expect(samples[1]).toBeCloseTo(32767 / 32768, 6);
	});
});

describe("circle measurement", () => {
	const w = 400;
	const h = 300;
	const disc = (
		cx: number,
		cy: number,
		r: number,
		inside: number,
		outside: number,
	) => {
		const luma = new Uint8Array(w * h).fill(outside);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) luma[y * w + x] = inside;
		return luma;
	};

	it("finds a dark disc from a nearby seed", () => {
		const c = measureCircle(
			disc(210, 140, 60, 10, 200),
			w,
			h,
			{ polarity: "dark", threshold: 0.2, maxR: 120 },
			[190, 150],
		);
		expect(c?.cx).toBeCloseTo(210, 0);
		expect(c?.cy).toBeCloseTo(140, 0);
		expect(c?.r).toBeCloseTo(60, 0);
	});

	it("rejects a flood that leaks past the search radius", () => {
		const c = measureCircle(
			disc(210, 140, 60, 10, 10),
			w,
			h,
			{ polarity: "dark", threshold: 0.2, maxR: 120 },
			[210, 140],
		);
		expect(c).toBeNull();
	});

	it("fills misses and drops single-frame outliers", () => {
		const ok = { cx: 100, cy: 100, r: 50 };
		const track = cleanTrack([ok, null, ok, { cx: 300, cy: 20, r: 5 }, ok, ok]);
		expect(track.every((c) => c.cx === 100 && c.r === 50)).toBe(true);
	});
});

describe("edit", () => {
	it("tiles the timeline with no gaps or overlaps", () => {
		expect(CUTS[0].from).toBe(0);
		for (let i = 1; i < CUTS.length; i++)
			expect(CUTS[i].from).toBe(CUTS[i - 1].to);
		expect(CUTS[CUTS.length - 1].to).toBe(DURATION);
	});

	it("cuts on the beat grid", () => {
		const beats = new Set(
			Array.from(
				{ length: Math.ceil(GRID.durationSec / GRID.beatSec) + 1 },
				(_, k) => beat(k),
			),
		);
		for (const cut of CUTS.slice(1))
			expect(beats.has(cut.from), `${cut.id} at ${cut.from}`).toBe(true);
		expect(bar(0)).toBe(beat(0));
	});

	it("stays inside every clip", () => {
		for (const cut of CUTS.filter((c) => c.shot)) {
			const shot = SHOTS.find((s) => s.id === cut.shot);
			expect(shot, cut.id).toBeDefined();
			expect(cut.trim + (cut.to - cut.from) / FPS, cut.id).toBeLessThanOrEqual(
				shot?.seconds ?? 0,
			);
		}
	});

	it("never exposes the edge of a plate", () => {
		for (const cut of EDIT.filter((c) => c.shot)) {
			for (let f = 0; f < cut.to - cut.from; f++) {
				// Only the inside of a window is visible; elsewhere the plate must fill the frame.
				if (cut.window || windowAt(cut, f)) continue;
				const { c, pose } = poseAt(cut, f);
				const { x, y } = layerOffset(c, pose);
				const slackX = ((pose.scale - 1) * W) / 2 + 0.5;
				const slackY = ((pose.scale - 1) * H) / 2 + 0.5;
				expect(pose.scale, `${cut.id}@${f}`).toBeGreaterThanOrEqual(1 - 1e-9);
				expect(Math.abs(x), `${cut.id}@${f} x`).toBeLessThanOrEqual(slackX);
				expect(Math.abs(y), `${cut.id}@${f} y`).toBeLessThanOrEqual(slackY);
			}
		}
	});

	it("matches circles across every free cut", () => {
		for (let i = 0; i + 1 < EDIT.length; i++) {
			const a = EDIT[i];
			const b = EDIT[i + 1];
			if (!a.shot || !b.shot || a.window || b.window || a.hold || b.hold)
				continue;
			const out = poseAt(a, a.to - a.from - 1);
			const into = poseAt(b, 0);
			expect(
				Math.hypot(out.pose.cx - into.pose.cx, out.pose.cy - into.pose.cy),
				`${a.id}→${b.id}`,
			).toBeLessThan(8);
			expect(
				Math.abs(out.c.r * out.pose.scale - into.c.r * into.pose.scale),
				`${a.id}→${b.id} r`,
			).toBeLessThan(12);
		}
	});
});

describe("film", () => {
	it("produces a program that passes schema validation", async () => {
		const film = await buildFilm();
		expect(() => film.toSpec()).not.toThrow();
	});
});
