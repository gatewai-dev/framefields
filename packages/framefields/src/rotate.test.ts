/**
 * Rotate turns its input about the frame center, clockwise for positive
 * angles, and fits the turned picture into the output (cover by default).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { Media, Rotate } from "./index.js";

let source = "";

/** A 200×100 card: red left half, blue right half. */
beforeAll(async () => {
	const canvas = new Canvas(200, 100);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ff0000";
	ctx.fillRect(0, 0, 100, 100);
	ctx.fillStyle = "#0000ff";
	ctx.fillRect(100, 0, 100, 100);
	source = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "rotate-")), "card.png");
	await fs.writeFile(source, await canvas.toBuffer("png"));
});

async function pixel(png: Buffer, x: number, y: number) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 4));
}

const card = () => Media.image(source, { width: 200, height: 100 });

describe("Rotate", () => {
	it("turns counter-clockwise for negative angles: the right half comes up top", async () => {
		const png = await card().apply(new Rotate({ angle: -90 })).renderFrame({ frame: 0 });
		expect(await pixel(png, 100, 10)).toEqual([0, 0, 255, 255]);
		expect(await pixel(png, 100, 90)).toEqual([255, 0, 0, 255]);
	});

	it("turns clockwise for positive angles: the left half comes up top", async () => {
		const png = await card().apply(new Rotate({ angle: 90 })).renderFrame({ frame: 0 });
		expect(await pixel(png, 100, 10)).toEqual([255, 0, 0, 255]);
		expect(await pixel(png, 100, 90)).toEqual([0, 0, 255, 255]);
	});

	it("leaves 180° upside down and covers the whole frame", async () => {
		const png = await card().apply(new Rotate({ angle: 180 })).renderFrame({ frame: 0 });
		expect(await pixel(png, 10, 50)).toEqual([0, 0, 255, 255]);
		expect(await pixel(png, 190, 50)).toEqual([255, 0, 0, 255]);
	});

	it("contain keeps the whole turned picture, with transparent margins", async () => {
		const png = await card()
			.apply(new Rotate({ angle: 90, fit: "contain" }))
			.renderFrame({ frame: 0 });
		// Turned, the card is 100 tall: contained in 200×100 it is 50 wide, centered.
		expect((await pixel(png, 10, 50))[3]).toBe(0);
		expect(await pixel(png, 100, 20)).toEqual([255, 0, 0, 255]);
		expect(await pixel(png, 100, 80)).toEqual([0, 0, 255, 255]);
	});
});
