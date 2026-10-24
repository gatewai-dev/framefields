/**
 * 3D models inside 2D containers sit at their own x / y in the parent's
 * coordinates, like any other layer: a container's offset moves them too.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

async function litBounds(nested: boolean) {
	const comp = new Composition({
		width: 600,
		height: 400,
		fps: 30,
		durationFrames: 10,
		backgroundColor: "#000000",
	});
	const model = Layer3D.roundedBox({
		id: "m",
		width: 80,
		height: 80,
		depth: 40,
		x: 60,
		y: 60,
		color: "#ffffff",
	} as never);
	comp.add(
		nested
			? Layer.box({
					id: "outer",
					position: "absolute",
					x: 300,
					y: 200,
					width: 200,
					height: 150,
					children: [
						Layer.box({
							id: "inner",
							position: "absolute",
							x: 0,
							y: 0,
							width: 200,
							height: 150,
							children: [model],
						}),
					],
				})
			: model,
	);
	const img = await decodePngPixels(await comp.renderFrame({ frame: 0 }));
	let x0 = 1e9;
	let y0 = 1e9;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < 400; y++)
		for (let x = 0; x < 600; x++) {
			const p = getPixel(img, x, y);
			if (p.r + p.g + p.b > 60) {
				x0 = Math.min(x0, x);
				y0 = Math.min(y0, y);
				x1 = Math.max(x1, x);
				y1 = Math.max(y1, y);
			}
		}
	return { x0, y0, x1, y1 };
}

describe("3D models in 2D containers", () => {
	it("inherit the containers' offset", async () => {
		const top = await litBounds(false);
		const nested = await litBounds(true);
		expect(top.x1).toBeGreaterThan(0);
		// Bounds centres: perspective shows a little more side face off-centre.
		const cx = (r: typeof top) => (r.x0 + r.x1) / 2;
		const cy = (r: typeof top) => (r.y0 + r.y1) / 2;
		expect(Math.abs(cx(nested) - cx(top) - 300)).toBeLessThan(15);
		expect(Math.abs(cy(nested) - cy(top) - 200)).toBeLessThan(15);
	});
});
