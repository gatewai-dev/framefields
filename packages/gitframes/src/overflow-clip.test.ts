/**
 * overflow: hidden honours border-radius: a container's rounded corners clip
 * its children, whether the radius is fixed or animated.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation } from "./index.js";

async function pixel(png: Buffer, x: number, y: number) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

function clipped(radius: number, animated: boolean) {
	const comp = new Composition({ width: 400, height: 400, fps: 30, durationFrames: 30, backgroundColor: "#000000" });
	const box = Layer.box({
		id: "clip",
		position: "absolute",
		x: 100,
		y: 100,
		width: 200,
		height: 200,
		overflow: "hidden",
		borderRadius: animated ? 0 : radius,
		children: [Layer.box({ id: "fill", position: "absolute", x: 0, y: 0, width: 200, height: 200, background: "#ffffff" })],
	});
	comp.add(animated ? box.animate(LayerAnimation.create().fromTo("borderRadius", 0, radius, { start: 0, end: 10 })) : box);
	return comp;
}

describe("overflow clipping", () => {
	it("clips children to a fixed border radius", async () => {
		const png = await clipped(100, false).renderFrame({ frame: 0 });
		expect(await pixel(png, 104, 104)).toEqual([0, 0, 0]);
		expect(await pixel(png, 200, 200)).toEqual([255, 255, 255]);
	});

	it("clips children to an animated border radius", async () => {
		const comp = clipped(100, true);
		expect(await pixel(await comp.renderFrame({ frame: 0 }), 104, 104)).toEqual([255, 255, 255]);
		expect(await pixel(await comp.renderFrame({ frame: 20 }), 104, 104)).toEqual([0, 0, 0]);
	});
});
