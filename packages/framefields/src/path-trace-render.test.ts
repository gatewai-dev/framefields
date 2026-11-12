import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D } from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 240;
const H = 160;

function scene(pathTrace: boolean, extra: unknown[] = []): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 2,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: 120,
			y: 20,
			z: -420,
			targetX: 120,
			targetY: 90,
			targetZ: 0,
		}),
		Layer.environment("studio", {
			intensity: 0.6,
			floor: { y: 130, color: "#9a9a9a", reflectivity: 0.04, roughness: 0.8 },
			...(pathTrace && { pathTrace: { quality: "draft", samples: 16 } }),
		}),
		Layer.directionalLight({
			x: 120,
			y: -400,
			z: 0,
			targetX: 120,
			targetY: 130,
			targetZ: 0,
			intensity: 2,
			castShadow: true,
		}),
		Layer3D.sphere({
			x: 120,
			y: 80,
			z: 0,
			radius: 40,
			color: "#d0d0d0",
			roughness: 0.5,
		}),
		...extra,
	] as never[]);
	return comp;
}

const luma = (p: Uint8ClampedArray, x: number, y: number) => {
	const i = (y * W + x) * 4;
	return 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
};

describe("environment.pathTrace", () => {
	it("traces the 3D batch: a deterministic frame with a contact shadow under the sphere", async () => {
		const traced = await scene(true).renderFrame({ frame: 0 });
		const again = await scene(true).renderFrame({ frame: 0 });
		expect(Buffer.compare(traced as Buffer, again as Buffer)).toBe(0);

		const raster = await scene(false).renderFrame({ frame: 0 });
		const t = (await decodePngPixels(traced)).pixels;
		const r = (await decodePngPixels(raster)).pixels;
		let diff = 0;
		for (let i = 0; i < t.length; i++) diff += Math.abs(t[i] - r[i]);
		expect(diff).toBeGreaterThan(0);

		// The sun is straight overhead: the sphere's shadow lies on the floor just below it.
		expect(luma(t, 120, 96)).toBeLessThan(luma(t, 30, 96) * 0.5);
	});

	it("lights a floor from an emissive sphere as much as the closed form says", async () => {
		// A point straight below a uniformly glowing sphere receives E = π·Le·(R/d)²,
		// so a Lambertian floor of albedo ρ shows ρ·Le·(R/d)².
		const Le = 20;
		const R = 30;
		const d = 120;
		const size = 32;
		const comp = new Composition({
			width: size,
			height: size,
			fps: 30,
			durationFrames: 1,
			backgroundColor: "#000000",
		});
		comp.add([
			Layer.camera({
				x: 540,
				y: 20,
				z: -300,
				targetX: 240,
				targetY: 220,
				targetZ: 0,
				fov: 3,
			}),
			Layer.environment("night", {
				intensity: 0,
				toneMapping: "none",
				floor: {
					y: 220,
					color: "#808080",
					reflectivity: 0,
					roughness: 1,
					fadeDistance: 100000,
				},
				pathTrace: {
					quality: "reference",
					samples: 256,
					denoise: false,
					bounces: 1,
				},
			}),
			Layer3D.sphere({
				x: 240,
				y: 220 - d,
				z: 0,
				radius: R,
				color: "#000000",
				emissive: "#ffffff",
				emissiveIntensity: Le,
			}),
		] as never[]);
		const px = new Uint8Array(
			await comp.renderFrame({ frame: 0, format: "rgba" }),
		);
		const linear = (v: number) =>
			v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		let sum = 0;
		let n = 0;
		for (let y = 12; y < 20; y++) {
			for (let x = 12; x < 20; x++) {
				sum += linear((px[(y * size + x) * 4 + 1] ?? 0) / 255);
				n++;
			}
		}
		const expected = linear(0x80 / 255) * Le * (R / d) ** 2;
		expect(sum / n).toBeGreaterThan(expected * 0.97);
		expect(sum / n).toBeLessThan(expected * 1.03);
	});

	it("names what it does not trace yet", async () => {
		const comp = scene(true, [
			Layer3D.sphere({ x: 60, y: 80, z: 0, radius: 20, material: "toon" }),
		]);
		await expect(comp.renderFrame({ frame: 0 })).rejects.toThrow(
			/toon shading/,
		);
	});
});
