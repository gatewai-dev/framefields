import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageLoader } from "./image.js";

// A straight-alpha PNG with non-zero RGB under transparent pixels, as AI
// cutouts and many editors write: the compositor's premultiplied "over"
// would add that RGB onto the background unless it is premultiplied on load.
describe("image alpha", () => {
	let dir: string;
	let pngPath: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "image-alpha-"));
		pngPath = join(dir, "straight.png");
		const raw = Buffer.from(
			[
				[255, 255, 255, 0], // white under alpha 0
				[255, 0, 0, 128], // red at half alpha
				[0, 255, 0, 255], // opaque green
			].flat(),
		);
		const png = await sharp(raw, { raw: { width: 3, height: 1, channels: 4 } })
			.png()
			.toBuffer();
		await writeFile(pngPath, png);
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("premultiplies straight-alpha PNGs in headless mode", async () => {
		const data = await imageLoader.load(pngPath, true);
		expect(Array.from(data.buffer as Uint8Array)).toEqual([
			0, 0, 0, 0, 128, 0, 0, 128, 0, 255, 0, 255,
		]);
	});
});
