import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { toLocalPath } from "./local-path.js";

describe("toLocalPath (Node)", () => {
	it("returns null for URLs that should be fetched", async () => {
		for (const src of [
			"http://example.com/a.mp4",
			"https://example.com/a.mp4",
			"data:video/mp4;base64,AAAA",
			"blob:http://localhost/abc",
		]) {
			expect(await toLocalPath(src)).toBeNull();
		}
	});

	it("converts file:// URLs with fileURLToPath", async () => {
		const abs = resolve("media", "clip one.mp4");
		expect(await toLocalPath(pathToFileURL(abs).href)).toBe(abs);
	});

	it("resolves relative paths against the working directory", async () => {
		expect(await toLocalPath("media/clip.mp4")).toBe(resolve("media/clip.mp4"));
		expect(await toLocalPath("./clip.mp4")).toBe(resolve("clip.mp4"));
	});

	it("treats a Windows drive path as local, not as a URL scheme", async () => {
		expect(await toLocalPath("D:\\media\\clip.mp4")).not.toBeNull();
		expect(await toLocalPath("D:/media/clip.mp4")).not.toBeNull();
	});
});
