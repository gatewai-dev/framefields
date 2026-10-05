/**
 * A container animated with rotateX/rotateY tracks that settle at 0 must lay
 * out and composite its child boxes exactly as it would without the tracks.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation } from "./index.js";

async function pixels(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return (x: number, y: number) =>
		Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

function scene(tilt: boolean) {
	const comp = new Composition({
		width: 1920,
		height: 1080,
		fps: 30,
		durationFrames: 90,
		backgroundColor: "#000000",
	});
	const box = Layer.box({
		id: "card",
		position: "absolute",
		x: 120,
		y: 300,
		width: 1680,
		height: 690,
		perspective: 1400,
		background: "#202020",
		children: [
			Layer.box({
				id: "plot",
				position: "absolute",
				x: 100,
				y: 100,
				width: 1480,
				height: 490,
				background: "#ffffff",
			}),
		],
	});
	comp.add(
		tilt
			? box.animate(
					LayerAnimation.create()
						.fromTo("rotateX", 28, 0, { start: 0, end: 56 })
						.fromTo("rotateY", -18, 0, { start: 0, end: 56 }),
				)
			: box,
	);
	return comp;
}

describe("3D-rotated container children", () => {
	it("places child boxes identically once rotate tracks settle at 0", async () => {
		const flat = await pixels(await scene(false).renderFrame({ frame: 70 }));
		const tilted = await pixels(await scene(true).renderFrame({ frame: 70 }));
		// Plot spans x 220..1700, y 400..890 in composition space.
		for (const [x, y] of [
			[225, 405],
			[1695, 405],
			[225, 885],
			[1695, 885],
			[960, 640],
		]) {
			expect(flat(x, y)).toEqual([255, 255, 255]);
			expect(tilted(x, y)).toEqual([255, 255, 255]);
		}
		for (const [x, y] of [
			[215, 645],
			[1705, 645],
			[960, 395],
			[960, 895],
		]) {
			expect(flat(x, y)).toEqual([32, 32, 32]);
			expect(tilted(x, y)).toEqual([32, 32, 32]);
		}
	});
});
