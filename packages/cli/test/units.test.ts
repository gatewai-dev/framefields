import { describe, expect, it } from "vitest";
import { buildLockfile } from "../src/assets.js";
import { parseCredentialInput } from "../src/commands/auth.js";
import { hostKey, hostUrl } from "../src/config.js";
import { normalizeRemote } from "../src/git/index.js";
import { globToRegExp, matchesAny } from "../src/glob.js";
import {
	looksLikeFrame,
	parseFrame,
	parseRange,
	spreadFrames,
} from "../src/timecode.js";

describe("timecodes", () => {
	it("parses frames, seconds, milliseconds and clock times", () => {
		expect(parseFrame("60", 30)).toBe(60);
		expect(parseFrame("2.5s", 30)).toBe(75);
		expect(parseFrame("1500ms", 24)).toBe(36);
		expect(parseFrame("02:15", 30)).toBe(135 * 30);
		expect(parseFrame("00:02:15", 30)).toBe(135 * 30);
		expect(parseFrame("00:00:01.5", 30)).toBe(45);
		expect(parseFrame("00:00:01:12", 24)).toBe(36);
	});

	it("rejects other input as a usage error", () => {
		for (const bad of ["", "abc", "-1", "1.5", "2.5x", "00:00:01:30"]) {
			expect(() => parseFrame(bad, 30)).toThrow(
				expect.objectContaining({ code: "usage" }),
			);
		}
	});

	it("tells frames from composition ids", () => {
		expect(looksLikeFrame("60")).toBe(true);
		expect(looksLikeFrame("2.5s")).toBe(true);
		expect(looksLikeFrame("00:02:15")).toBe(true);
		expect(looksLikeFrame("step-1")).toBe(false);
		expect(looksLikeFrame("film")).toBe(false);
	});

	it("ranges and spreads", () => {
		expect(parseRange("0..120", 30)).toEqual({ from: 0, to: 120 });
		expect(parseRange("..5s", 30)).toEqual({ from: undefined, to: 150 });
		expect(parseRange("10-20", 30)).toEqual({ from: 10, to: 20 });
		expect(spreadFrames(0, 899, 4)).toEqual([0, 300, 599, 899]);
		expect(spreadFrames(0, 2, 16)).toEqual([0, 1, 2]);
		expect(spreadFrames(5, 5, 4)).toEqual([5]);
	});
});

describe("globs", () => {
	it("matches assets.exclude patterns", () => {
		expect(matchesAny(["**/.DS_Store"], ".DS_Store")).toBe(true);
		expect(matchesAny(["**/.DS_Store"], "assets/a/.DS_Store")).toBe(true);
		expect(matchesAny(["scratch/**"], "scratch/a/b.png")).toBe(true);
		expect(matchesAny(["scratch/**"], "assets/scratch.png")).toBe(false);
		expect(matchesAny(["*.{wav,mp3}"], "a.wav")).toBe(true);
		expect(matchesAny(["*.{wav,mp3}"], "x/a.wav")).toBe(false);
		expect(globToRegExp("a?.png").test("ab.png")).toBe(true);
	});
});

describe("hosts and remotes", () => {
	it("normalises hosts", () => {
		expect(hostUrl("framefields.dev")).toBe("https://framefields.dev");
		expect(hostUrl("http://localhost:8787/")).toBe("http://localhost:8787");
		expect(hostKey("http://localhost:8787")).toBe("localhost:8787");
		expect(() => hostUrl("http://")).toThrow(/invalid host/);
	});

	it("compares remotes without credentials or .git", () => {
		expect(
			normalizeRemote("https://user:pw@Artifacts.example/ns/Film.git"),
		).toBe(normalizeRemote("https://artifacts.example/ns/film"));
	});
});

describe("lockfile", () => {
	it("keeps unchanged entries' fields and unknown keys", () => {
		const prev = {
			version: 1,
			projectId: "proj_1",
			assets: {
				"assets/a.png": {
					sha256: "a".repeat(64),
					size: 1,
					uploadedAt: "2026-01-01T00:00:00Z",
					r2Key: "k",
				},
			},
		};
		const next = buildLockfile(prev, [
			{
				path: "assets/a.png",
				sha256: "a".repeat(64),
				size: 1,
				mimeType: "image/png",
			},
			{
				path: "assets/b.wav",
				sha256: "b".repeat(64),
				size: 2,
				mimeType: "audio/wav",
			},
		]);
		expect(next.projectId).toBe("proj_1");
		expect(next.assets["assets/a.png"]).toMatchObject({
			uploadedAt: "2026-01-01T00:00:00Z",
			r2Key: "k",
			mimeType: "image/png",
		});
		expect(next.assets["assets/b.wav"]).toMatchObject({
			sha256: "b".repeat(64),
			size: 2,
		});
	});
});

it("parses git credential input", () => {
	expect(
		parseCredentialInput(
			"protocol=https\nhost=git.example\npath=ns/r.git\ncapability[]=authtype\ncapability[]=state\n\n",
		),
	).toEqual({
		protocol: ["https"],
		host: ["git.example"],
		path: ["ns/r.git"],
		"capability[]": ["authtype", "state"],
	});
});
