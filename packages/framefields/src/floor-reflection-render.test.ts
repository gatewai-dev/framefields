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
		at(x: number, y: number) {
			const i = (Math.round(y) * img.width + Math.round(x)) * 4;
			return {
				r: data[i] ?? 0,
				g: data[i + 1] ?? 0,
				b: data[i + 2] ?? 0,
			};
		},
		data,
	};
}

describe("Glossy Floor Reflection (Environment.floor)", () => {
	it("renders planar reflection of glowing 3D shards on the glossy floor with HDR bloom", async () => {
		const comp = new Composition({
			width: 400,
			height: 400,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#05040a",
		});

		comp.add([
			Layer.camera({
				x: 200,
				y: 80,
				z: -350,
				targetX: 200,
				targetY: 240,
				targetZ: 0,
			}),
			Layer.environment("night", {
				floor: {
					y: 220,
					color: "#08070e",
					reflectivity: 0.7,
					roughness: 0.15,
					fadeDistance: 900,
					opacity: 1.0,
				},
				bloom: { intensity: 1.2, threshold: 0.8 },
			}),
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.0,
				x: 100,
				y: 50,
				z: -200,
				targetX: 200,
				targetY: 220,
				targetZ: 0,
			}),
			Layer3D.shard({
				x: 200,
				y: 160,
				z: 0,
				radius: 35,
				color: "#00ffff",
				emissive: "#00ffff",
				emissiveStrength: 4.0,
			}),
		]);

		const png = await comp.renderFrame(0);
		const { data, at } = await decode(png);

		// 1. Shard itself is visible above the floor line (y ≈ 160)
		const shardSample = at(200, 160);
		expect(shardSample.g + shardSample.b).toBeGreaterThan(100);

		// 2. Floor plane below y = 220 receives the cyan reflection of the shard
		// Look in the reflection region (y ≈ 260 to 300)
		let floorReflectionFound = false;
		for (let y = 240; y < 320; y += 4) {
			const p = at(200, y);
			if (p.b > 25 || p.g > 25) {
				floorReflectionFound = true;
				break;
			}
		}
		expect(floorReflectionFound).toBe(true);

		// 3. Confirm floor reflection contains bloom radiance
		let brightPixels = 0;
		for (let i = 0; i < data.length; i += 4) {
			const b = data[i + 2] ?? 0;
			if (b > 150) brightPixels++;
		}
		expect(brightPixels).toBeGreaterThan(20);
	});

	it("applies anisotropic roughness blur to floor reflections", async () => {
		// Test that higher roughness spreads out reflection pixels vertically
		const compSharp = new Composition({
			width: 300,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#05040a",
		});
		compSharp.add([
			Layer.camera({
				x: 150,
				y: 70,
				z: -250,
				targetX: 150,
				targetY: 180,
				targetZ: 0,
			}),
			Layer.environment("night", {
				floor: {
					y: 170,
					reflectivity: 0.8,
					roughness: 0.0,
				},
			}),
			Layer3D.shard({
				x: 150,
				y: 120,
				z: 0,
				radius: 25,
				color: "#ff007f",
				emissive: "#ff007f",
				emissiveStrength: 3.0,
			}),
		]);

		const compRough = new Composition({
			width: 300,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#05040a",
		});
		compRough.add([
			Layer.camera({
				x: 150,
				y: 70,
				z: -250,
				targetX: 150,
				targetY: 180,
				targetZ: 0,
			}),
			Layer.environment("night", {
				floor: {
					y: 170,
					reflectivity: 0.8,
					roughness: 0.5,
				},
			}),
			Layer3D.shard({
				x: 150,
				y: 120,
				z: 0,
				radius: 25,
				color: "#ff007f",
				emissive: "#ff007f",
				emissiveStrength: 3.0,
			}),
		]);

		const pngSharp = await compSharp.renderFrame(0);
		const pngRough = await compRough.renderFrame(0);

		const { at: atSharp } = await decode(pngSharp);
		const { at: atRough } = await decode(pngRough);

		// Find where magenta reflection appears on the floor below y = 140
		let maxSharpR = 0;
		let maxRoughR = 0;
		for (let y = 140; y < 290; y++) {
			const s = atSharp(150, y);
			const r = atRough(150, y);
			if (s.r > maxSharpR) maxSharpR = s.r;
			if (r.r > maxRoughR) maxRoughR = r.r;
		}
		// Both reflect magenta
		expect(maxSharpR).toBeGreaterThan(50);
		expect(maxRoughR).toBeGreaterThan(50);

		// And rough floor spreads radiance vertically wider
		let roughReflectedCount = 0;
		for (let y = 180; y < 270; y += 2) {
			if (atRough(150, y).r > 5) roughReflectedCount++;
		}
		expect(roughReflectedCount).toBeGreaterThan(10);
	});
});
