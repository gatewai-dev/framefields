import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearHeadlessFonts,
	getHeadlessFontPath,
	registerHeadlessFont,
} from "./headless-font-loader.js";

describe("clearHeadlessFonts", () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		await clearHeadlessFonts();
	});

	it("lets the next job register a family from another file", async () => {
		expect(await registerHeadlessFont("Inter", "file:///a/Inter.ttf")).toBe(
			"/a/Inter.ttf",
		);
		// Without a reset, the first path wins for the life of the process.
		expect(await registerHeadlessFont("Inter", "file:///b/Inter.ttf")).toBe(
			"/a/Inter.ttf",
		);
		await clearHeadlessFonts();
		expect(getHeadlessFontPath("Inter")).toBeUndefined();
		expect(await registerHeadlessFont("Inter", "file:///b/Inter.ttf")).toBe(
			"/b/Inter.ttf",
		);
	});

	it("deletes fonts downloaded from URLs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(new Uint8Array([0, 1, 0, 0]))),
		);
		const file = await registerHeadlessFont(
			"Remote",
			"https://fonts.example/Remote.ttf",
		);
		expect(file && existsSync(file)).toBe(true);
		await clearHeadlessFonts();
		expect(existsSync(path.dirname(file as string))).toBe(false);
	});
});

describe("registerHeadlessFont", () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		await clearHeadlessFonts();
	});

	it("decodes file:// URLs, so paths with spaces resolve", async () => {
		expect(
			await registerHeadlessFont("Spaced", "file:///a/My%20Film/Inter.ttf"),
		).toBe("/a/My Film/Inter.ttf");
	});

	it("does nothing in a browser page: no download, no warning", async () => {
		vi.stubGlobal("window", globalThis);
		vi.stubGlobal("document", {});
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(
			await registerHeadlessFont("Inter", "http://localhost/assets/Inter.ttf"),
		).toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(getHeadlessFontPath("Inter")).toBeUndefined();
	});
});
