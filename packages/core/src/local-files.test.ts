import { afterEach, describe, expect, it } from "vitest";
import {
	isLocalFilePath,
	localFileSize,
	localFileUrl,
	localPathOf,
	setLocalFileSource,
} from "./local-files.js";

const files: Record<string, { url: string; size: number }> = {
	"/assets/clip.mp4": {
		url: "https://app.test/b/files/assets/clip.mp4",
		size: 10,
	},
	"/film/assets/fonts/Inter.ttf": {
		url: "https://app.test/b/files/film/assets/fonts/Inter.ttf",
		size: 20,
	},
};

const bundle = {
	cwd: "/film",
	url: (p: string) => files[p]?.url,
	size: (p: string) => files[p]?.size,
};

afterEach(() => setLocalFileSource());

describe("local files", () => {
	it("serves paths under /@fs until a source is installed", () => {
		expect(localFileUrl("/assets/clip.mp4")).toBe("/@fs/assets/clip.mp4");
		expect(localFileUrl("file:///assets/my%20clip.mp4")).toBe(
			"/@fs/assets/my clip.mp4",
		);
		expect(localFileSize("/assets/clip.mp4")).toBeNull();
		// Relative paths are URLs to the page without a source.
		expect(isLocalFilePath("assets/fonts/Inter.ttf")).toBe(false);
	});

	it("maps paths to an installed source's files", () => {
		setLocalFileSource(bundle);
		expect(localFileUrl("/assets/clip.mp4")).toBe(
			files["/assets/clip.mp4"].url,
		);
		expect(localFileUrl("/@fs/assets/clip.mp4")).toBe(
			files["/assets/clip.mp4"].url,
		);
		expect(localFileUrl("file:///assets/clip.mp4")).toBe(
			files["/assets/clip.mp4"].url,
		);
		expect(localFileSize("/assets/clip.mp4")).toBe(10);
		expect(localFileSize("/nope.png")).toBeUndefined();
	});

	it("resolves relative paths against the source's cwd, as Node does", () => {
		setLocalFileSource(bundle);
		expect(isLocalFilePath("assets/fonts/Inter.ttf")).toBe(true);
		expect(localPathOf("./assets/../assets/fonts/Inter.ttf")).toBe(
			"/film/assets/fonts/Inter.ttf",
		);
		expect(localFileUrl("assets/fonts/Inter.ttf")).toBe(
			files["/film/assets/fonts/Inter.ttf"].url,
		);
	});

	it("leaves URLs alone and names a file the source lacks", () => {
		setLocalFileSource(bundle);
		for (const url of [
			"https://x.test/a.png",
			"data:image/png;base64,AA",
			"blob:x",
			"//cdn/a",
		])
			expect(isLocalFilePath(url), url).toBe(false);
		expect(() => localFileUrl("/missing/clip.mp4")).toThrow(
			/"\/missing\/clip.mp4" is not in this bundle/,
		);
	});
});
