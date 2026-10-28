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

describe("Layer3D.swarm GPU compute simulation", () => {
	it("simulates 3D shard swarm with vortex, floor friction and kinetic HDR heat", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1500,
			backgroundColor: "#050408",
		});

		comp.add([
			Layer.camera({
				x: 300,
				y: 200,
				z: -600,
				targetX: 300,
				targetY: 350,
				targetZ: 0,
			}),
			Layer.environment({
				color: "#0a0810",
				bloom: { intensity: 1.5, threshold: 0.8 },
			}),
			Layer.ambientLight("#332244", 0.5),
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.2,
				x: 100,
				y: 50,
				z: -400,
				targetX: 300,
				targetY: 350,
				targetZ: 0,
			}),
		]);

		comp.add(
			Layer3D.swarm({
				max: 800,
				mesh: "shard",
				seed: 1234,
				substeps: 2,
				size: [20, 14],
				emitter: {
					shape: "ring",
					x: 300,
					y: 200,
					z: 0,
					radius: 120,
					rate: 350,
				},
				speed: [150, 400],
				direction: [0, 1, 0],
				spread: 60,
				gravity: [0, 900, 0],
				drag: 0.04,
				noise: {
					strength: 350,
					scale: 180,
					speed: 1.5,
				},
				vortex: {
					x: 300,
					y: 350,
					z: 0,
					axis: [0, -1, 0],
					swirl: 1200,
					pull: 400,
					axial: 200,
					radius: 600,
				},
				floor: {
					y: 520,
					bounce: 0.25,
					friction: 2.0,
					heatGain: 1.5,
					heatDecay: 0.4,
				},
				color: ["#2a2035", "#3a1545"],
				roughness: 0.25,
				metallic: 0.85,
				heat: {
					source: "both",
					maxSpeed: 800,
					curve: 1.5,
					intensity: 6.0,
					color: ["#200530", "#ff007f", "#ffffff"],
				},
			}),
		);

		// Render frame 20 (particles swirling and hitting the floor)
		const png20 = await comp.renderFrame(20);
		const { data: d20 } = await decode(png20);

		let nonBlack20 = 0;
		let hasGlowingHotPixels = 0;
		for (let i = 0; i < d20.length; i += 4) {
			const r = d20[i] ?? 0;
			const g = d20[i + 1] ?? 0;
			const b = d20[i + 2] ?? 0;
			if (r > 20 || g > 20 || b > 20) {
				nonBlack20++;
				// High intensity hot emissive/bloom pixels
				if (r > 180 && b > 140) {
					hasGlowingHotPixels++;
				}
			}
		}

		expect(nonBlack20).toBeGreaterThan(1200);
		expect(hasGlowingHotPixels).toBeGreaterThan(50);

		// Deterministic scrubbing check: render frame 30, then scrub back to frame 20
		await comp.renderFrame(30);
		const png20Scrubbed = await comp.renderFrame(20);
		const { data: d20Scrubbed } = await decode(png20Scrubbed);

		let diffPixels = 0;
		for (let i = 0; i < d20.length; i += 4) {
			const dr = Math.abs((d20[i] ?? 0) - (d20Scrubbed[i] ?? 0));
			const dg = Math.abs((d20[i + 1] ?? 0) - (d20Scrubbed[i + 1] ?? 0));
			const db = Math.abs((d20[i + 2] ?? 0) - (d20Scrubbed[i + 2] ?? 0));
			if (dr > 1 || dg > 1 || db > 1) {
				diffPixels++;
			}
		}

		// Snapshot restore must be bit-identical or within floating point epsilon
		expect(diffPixels).toBeLessThan(10);
	});
});
