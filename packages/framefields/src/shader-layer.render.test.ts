import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

const W = 96;
const H = 64;

function stage() {
	return new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
}

describe("Layer.shader", () => {
	it("draws the fragment with uv, named uniforms and a per-frame function", async () => {
		const comp = stage();
		comp.add(
			Layer.shader({
				width: W,
				height: H,
				uniforms: { red: 1, green: (ctx) => ctx.frame / 20 },
				fragment: `fn shade(uv : vec2<f32>) -> vec4<f32> {
	return vec4<f32>(u.red * step(0.5, uv.x), u.green, 0.0, 1.0);
}`,
			}),
		);
		const first = await decodePngPixels(await comp.renderFrame({ frame: 0 }));
		expect(getPixel(first, 10, 32).r).toBeLessThan(5);
		expect(getPixel(first, 80, 32).r).toBeGreaterThan(250);
		expect(getPixel(first, 80, 32).g).toBeLessThan(5);

		const later = await decodePngPixels(await comp.renderFrame({ frame: 10 }));
		const green = getPixel(later, 10, 32).g;
		expect(green).toBeGreaterThan(120);
		expect(green).toBeLessThan(135);
	});

	it("keeps its place and size as a layer", async () => {
		const comp = stage();
		comp.add(
			Layer.shader({
				x: 48,
				width: 48,
				height: H,
				fragment:
					"fn shade(uv : vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }",
			}),
		);
		const image = await decodePngPixels(await comp.renderFrame({ frame: 0 }));
		expect(getPixel(image, 20, 32).b).toBeLessThan(5);
		expect(getPixel(image, 70, 32).b).toBeGreaterThan(250);
	});

	it("reports a fragment that does not compile with its own line number", async () => {
		const comp = stage();
		comp.add(
			Layer.shader({
				width: W,
				height: H,
				fragment: `fn shade(uv : vec2<f32>) -> vec4<f32> {
	return vec4<f32>(nope, 0.0, 0.0, 1.0);
}`,
			}),
		);
		await expect(comp.renderFrame({ frame: 0 })).rejects.toThrow(/line 2/);
	});
});
