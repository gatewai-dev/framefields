import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeChannels } from "@framefields/components/toolkit";
import { describe, expect, it } from "vitest";
import {
	ANALYSIS_FPS,
	estimateBpm,
	onsetSeconds,
	peaks,
	reportAudio,
	strongestStart,
} from "./analyze.js";
import { parseEntry, readCatalog } from "./catalog.js";
import { exportName, mediaModule } from "./module.js";
import { encodeWav, SAMPLE_RATE, synthesize } from "./synth.js";

const CATALOG = new URL("../catalog", import.meta.url).pathname;

describe("synth", () => {
	it("is deterministic and peaks just under full scale", () => {
		const recipe = {
			kind: "whoosh",
			seconds: 0.5,
			from: 300,
			to: 2400,
		} as const;
		const a = encodeWav(synthesize(recipe));
		const b = encodeWav(synthesize(recipe));
		expect(a.equals(b)).toBe(true);
		expect(a.length).toBe(44 + Math.round(0.5 * SAMPLE_RATE) * 4);
		const [left, right] = synthesize(recipe);
		const peak = Math.max(...left.map(Math.abs), ...right.map(Math.abs));
		expect(peak).toBeCloseTo(0.89, 2);
	});
});

describe("audio analysis", () => {
	it("finds a tempo from regular beats, folding half and double time", () => {
		const beats = (gap: number) =>
			Array.from({ length: 16 }, (_, i) => i * gap);
		expect(estimateBpm(beats(0.5))).toBe(120);
		expect(estimateBpm(beats(1))).toBe(120); // 60 → doubled
		expect(estimateBpm(beats(0.25))).toBe(120); // 240 → halved
		expect(estimateBpm(beats(0.1))).toBeUndefined(); // gaps under 0.2 s are ignored
		expect(estimateBpm([0, 0.5, 1])).toBeUndefined();
	});

	it("places the onset, the strongest stretch and the waveform", () => {
		const level = [0, 0, 0, 0.5, 1, 0.8, 0.2, 0.9, 1, 1, 0.1, 0];
		expect(onsetSeconds(level, 10)).toBe(0.3);
		expect(strongestStart(level, 10, 0.3)).toBe(0); // starts on a whole second
		const wave = peaks(level, 4);
		expect(wave).toHaveLength(4);
		expect(Math.max(...wave)).toBe(1);
		// Linear amplitude: half the level range (24 dB down) is far below half height.
		expect(peaks([0.5, 1], 2)[0]).toBeLessThan(0.1);
	});

	it("measures a synthesized hit the way the engine hears it", () => {
		const [l, r] = synthesize({
			kind: "impact",
			seconds: 1,
			from: 110,
			to: 40,
		});
		const silence = new Float32Array(SAMPLE_RATE / 4);
		const pad = (c: Float32Array) => {
			const out = new Float32Array(silence.length + c.length);
			out.set(c, silence.length);
			return out;
		};
		const levels = analyzeChannels([pad(l), pad(r)], SAMPLE_RATE, {
			fps: ANALYSIS_FPS,
		});
		const report = reportAudio(levels, false);
		expect(report.analysis.duration).toBeCloseTo(1.25, 1);
		expect(report.analysis.onset).toBeGreaterThanOrEqual(0.24);
		expect(report.analysis.onset).toBeLessThanOrEqual(0.26);
		expect(report.analysis.bpm).toBeUndefined();
		expect(report.start).toBe(0);
	});
});

describe("catalog", () => {
	it("reads every entry in the repo's catalog", () => {
		const entries = readCatalog(CATALOG);
		expect(entries.length).toBeGreaterThan(0);
		for (const e of entries) {
			expect(e.license.id).toBeTruthy();
			// Downloads are pinned before they ship.
			if (e.source) expect(e.source.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it("rejects code kinds, unlicensed and unpinnable entries", () => {
		const base = {
			title: "T",
			summary: "S",
			tags: ["a"],
			version: 1,
			license: { id: "CC0-1.0", commercial: true },
			synth: { kind: "pop", seconds: 0.1, from: 900, to: 200 },
		};
		expect(parseEntry("f", "sfx", "pop", base).name).toBe("sfx/pop");
		expect(() => parseEntry("f", "component", "x", base)).toThrow(
			/not a media kind/,
		);
		expect(() => parseEntry("f", "sfx", "Bad Name", base)).toThrow(
			/valid item name/,
		);
		expect(() =>
			parseEntry("f", "sfx", "x", { ...base, license: undefined }),
		).toThrow(/license/);
		expect(() =>
			parseEntry("f", "sfx", "x", {
				...base,
				source: { url: "http://x", ext: "wav" },
			}),
		).toThrow(/exactly one/);
	});

	it("reads kinds from folders", () => {
		const dir = mkdtempSync(join(tmpdir(), "ff-catalog-"));
		mkdirSync(join(dir, "sfx"));
		writeFileSync(
			join(dir, "sfx", "tick.json"),
			JSON.stringify({
				title: "Tick",
				summary: "A tick",
				tags: ["ui"],
				version: 2,
				license: { id: "CC0-1.0", commercial: true },
				synth: { kind: "click", seconds: 0.1, tone: 3000 },
			}),
		);
		expect(readCatalog(dir).map((e) => [e.name, e.kind, e.version])).toEqual([
			["sfx/tick", "sfx", 2],
		]);
	});
});

describe("media module", () => {
	it("names exports as identifiers", () => {
		expect(exportName("hdri", "studio-small-09")).toBe("studioSmall09");
		expect(exportName("sfx", "8-bit-coin")).toBe("sfx8BitCoin");
	});

	it("writes the pinned path, the measurements and the credit", () => {
		const { path, content, title } = mediaModule({
			kind: "music",
			slug: "neon-drive",
			title: "Neon Drive",
			kindLabel: "Music",
			license: { id: "CC-BY-4.0", commercial: true, attribution: "Someone" },
			assetPath: "music/neon-drive.mp3",
			analysis: { duration: 92.4, bpm: 120, beats: [0.5, 1, 1.5], onset: 0.02 },
			start: 30,
		});
		expect(path).toBe("music/neon-drive.ts");
		expect(title).toBe("neonDrive");
		expect(content).toContain('src: "assets/library/music/neon-drive.mp3"');
		expect(content).toContain("bpm: 120,");
		expect(content).toContain("start: 30,");
		expect(content).toContain("beats: [0.5, 1, 1.5],");
		expect(content).toContain("Credit: Someone.");
		expect(content).toContain("} as const;");
	});
});
