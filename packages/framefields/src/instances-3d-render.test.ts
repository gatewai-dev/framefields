import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, Physics } from "./index.js";

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return {
		at(x: number, y: number) {
			const i = (Math.round(y) * img.width + Math.round(x)) * 4;
			return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
		},
		data,
	};
}

describe("Layer3D.instances hardware instancing", () => {
	it("renders 100+ instanced procedural shards in a single batch", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		comp.add([
			Layer.camera({
				x: 300,
				y: 300,
				z: -600,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
			Layer.ambientLight("#333333", 0.5),
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.5,
				x: 200,
				y: 100,
				z: -500,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		]);

		const shardVariants = [
			Layer3D.shard({ radius: 18, facets: 10, seed: 1, irregularity: 0.3 }),
			Layer3D.shard({ radius: 22, facets: 14, seed: 42, irregularity: 0.5 }),
			Layer3D.shard({ radius: 16, facets: 8, seed: 99, irregularity: 0.2 }),
		];

		const count = 120;
		comp.add(
			Layer3D.instances({
				mesh: shardVariants,
				count,
				material: "lit",
				roughness: 0.3,
				metallic: 0.8,
				instanceAt(i) {
					const angle = (i / count) * Math.PI * 6;
					const radius = 40 + (i / count) * 180;
					return {
						x: 300 + Math.cos(angle) * radius,
						y: 300 + Math.sin(angle) * radius,
						z: (i - count / 2) * 2,
						scale: 0.8 + (i % 5) * 0.1,
						rotation: [i * 15, i * 27, i * 33],
						color: i % 2 === 0 ? "#00e5ff" : "#ff007f",
						emissive: i % 5 === 0 ? "#ffffff" : undefined,
						emissiveIntensity: i % 5 === 0 ? 3.0 : 0,
					};
				},
			}),
		);

		const png = await comp.renderFrame(0);
		const { data } = await decode(png);

		let nonBlack = 0;
		let hasCyan = 0;
		let hasMagenta = 0;
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i] ?? 0;
			const g = data[i + 1] ?? 0;
			const b = data[i + 2] ?? 0;
			if (r > 20 || g > 20 || b > 20) {
				nonBlack++;
				if (b > 100 && g > 100 && r < 80) hasCyan++;
				if (r > 100 && b > 100 && g < 80) hasMagenta++;
			}
		}

		expect(nonBlack).toBeGreaterThan(1500);
		expect(hasCyan).toBeGreaterThan(100);
		expect(hasMagenta).toBeGreaterThan(100);
	});

	it("renders hardware instances driven by Physics.world3d rigid bodies", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050508",
		});

		comp.add([
			Layer.camera({
				x: 300,
				y: 200,
				z: -600,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 0.6),
		]);

		const physics = await Physics.world3d({
			gravity: 3000,
			fps: 30,
			frames: 30,
		});
		physics.ground({ y: 500 });

		const shardMesh = Layer3D.shard({ radius: 25, facets: 12, seed: 7 });
		const numBodies = 25;
		const bodies = [];
		for (let i = 0; i < numBodies; i++) {
			bodies.push(
				physics.body(shardMesh, {
					x: 200 + (i % 5) * 50,
					y: 100 + Math.floor(i / 5) * 50,
					z: (i % 3) * 30,
					shape: "hull",
					velocity: [(i % 2 === 0 ? 1 : -1) * 100, 0, 0],
				}),
			);
		}
		physics.simulate();

		comp.add(
			Layer3D.instances({
				mesh: shardMesh,
				bodies,
				color: "#ffaa00",
				emissiveBySpeed: {
					color: ["#ffaa00", "#ffffff"],
					maxSpeed: 800,
					intensity: 2.0,
				},
			}),
		);

		const png = await comp.renderFrame(15);
		const { data } = await decode(png);

		let nonBlack = 0;
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i] ?? 0;
			const g = data[i + 1] ?? 0;
			const b = data[i + 2] ?? 0;
			if (r > 30 || g > 30 || b > 30) nonBlack++;
		}
		expect(nonBlack).toBeGreaterThan(1000);
	});
});
