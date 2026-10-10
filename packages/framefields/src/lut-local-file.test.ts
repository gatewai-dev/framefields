/**
 * ApplyLUT reads a `.cube` from a local path under Node, the same kind of
 * source a video layer takes (fetch cannot open a bare path or file:// URL).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Canvas, loadImage } from "skia-canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { ApplyLUT, Media } from "./index.js";

let dir = "";
let grey = "";

/** A 2³ LUT that sends every colour to pure green. */
const GREEN_CUBE = ["LUT_3D_SIZE 2", ...Array(8).fill("0 1 0")].join("\n");

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "lut local "));
	await fs.writeFile(path.join(dir, "all green.cube"), GREEN_CUBE);
	const canvas = new Canvas(64, 64);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#808080";
	ctx.fillRect(0, 0, 64, 64);
	grey = path.join(dir, "grey.png");
	await fs.writeFile(grey, await canvas.toBuffer("png"));
});

async function center(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return Array.from(ctx.getImageData(32, 32, 1, 1).data.slice(0, 3));
}

describe("ApplyLUT with a local .cube", () => {
	it.each([
		["a path (with spaces)", () => path.join(dir, "all green.cube")],
		["a file:// URL", () => pathToFileURL(path.join(dir, "all green.cube")).href],
	])("loads %s", async (_, lutUrl) => {
		const png = await Media.image(grey, { width: 64, height: 64 })
			.apply(new ApplyLUT({ lutUrl: lutUrl(), intensity: 1 }))
			.renderFrame({ frame: 0 });
		expect(await center(png)).toEqual([0, 255, 0]);
	});
});
