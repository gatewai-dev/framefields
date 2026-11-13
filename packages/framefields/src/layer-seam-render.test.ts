import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return {
		width: img.width,
		red: (x: number, y: number) => data[(y * img.width + x) * 4] ?? 0,
	};
}

describe("3D layers that share an edge", () => {
	it("meet without a line of the backdrop between them", async () => {
		const comp = new Composition({
			width: 400,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});
		const half = (x: number) =>
			Layer3D.plane({
				x,
				y: 20,
				// Off the z = 0 plane the two quads' depths differ in their last bits.
				z: -26,
				width: 140,
				height: 260,
				background: "#ffffff",
				material: "unlit",
			});
		comp.add([
			// Off axis, so the shared edge crosses pixel columns as it goes down.
			Layer.camera({
				x: 290,
				y: 60,
				z: -420,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
				lens: { near: 8, far: 60000 },
			}),
			half(60),
			half(200),
		]);

		const { width, red } = await decode(await comp.renderFrame(0));
		let rows = 0;
		for (let y = 70; y <= 230; y++) {
			let left = -1;
			let right = -1;
			for (let x = 0; x < width; x++) {
				if (red(x, y) < 128) continue;
				if (left < 0) left = x;
				right = x;
			}
			// Both layers are in this row: inside their outer edges nothing is dark.
			if (right - left < 150) continue;
			rows++;
			for (let x = left + 2; x <= right - 2; x++)
				expect(red(x, y), `pixel ${x}, ${y}`).toBeGreaterThan(250);
		}
		expect(rows).toBeGreaterThan(120);
	});
});
