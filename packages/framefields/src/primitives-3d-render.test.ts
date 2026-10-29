import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	Path3D,
} from "./index.js";

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return {
		at(x: number, y: number) {
			const i = (Math.round(y) * img.width + Math.round(x)) * 4;
			return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
		},
		data,
	};
}

/** A camera above and in front of (400, 300, 0), looking down at ~45°. */
function stage() {
	const comp = new Composition({
		width: 800,
		height: 600,
		fps: 30,
		durationMs: 1000,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: 400,
			y: 300 - 600,
			z: -600,
			targetX: 400,
			targetY: 300,
			targetZ: 0,
		}),
		Layer.ambientLight("#ffffff", 0.9),
	]);
	return comp;
}

describe("Layer3D mesh primitives", () => {
	it("renders mesh triangle edges when wireframe is enabled", async () => {
		const render = async (wireframe: boolean) => {
			const comp = stage();
			comp.add(
				Layer.directionalLight({
					color: "#ffffff",
					intensity: 1,
					x: 200,
					y: -300,
					z: -400,
					targetX: 400,
					targetY: 300,
					targetZ: 0,
					castShadow: true,
				}),
			);
			comp.add(
				Layer3D.roundedBox({
					width: 220,
					height: 180,
					depth: 120,
					x: 400,
					y: 300,
					color: "#ffffff",
					material: "lit",
					wireframe,
				}),
			);
			return decode(await comp.renderFrame({ frame: 0 }));
		};
		const solid = await render(false);
		const wire = await render(true);
		const lit = (pixels: Uint8ClampedArray) => {
			let count = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i]! > 50) count++;
			}
			return count;
		};
		expect(lit(wire.data)).toBeGreaterThan(100);
		expect(lit(wire.data)).toBeLessThan(lit(solid.data) / 4);
	});

	it("draws a rounded box's top face from above, single-sided", async () => {
		const comp = stage();
		comp.add(
			Layer3D.roundedBox({
				id: "slab",
				width: 300,
				height: 40,
				depth: 300,
				radius: 12,
				x: 400,
				y: 300,
				color: "#ff3030",
			}),
		);
		const img = await decode(await comp.renderFrame({ frame: 0 }));
		// The middle of the frame is the slab's top face, not the black background.
		const top = img.at(400, 300);
		expect(top.r).toBeGreaterThan(150);
		expect(top.g).toBeLessThan(top.r / 2);
		expect(img.at(20, 20).r).toBeLessThan(10);
	});

	it("inherits 2D parent translation when nested inside a 2D container", async () => {
		const comp = stage();
		// Parent container positioned at (200, 150)
		comp.add(
			Layer.box({
				id: "card",
				x: 200,
				y: 150,
				width: 400,
				height: 300,
				children: [
					Layer3D.roundedBox({
						id: "slab-nested",
						width: 300,
						height: 40,
						depth: 300,
						radius: 12,
						x: 200,
						y: 150,
						color: "#ff3030",
					}),
				],
			}),
		);
		const img = await decode(await comp.renderFrame({ frame: 0 }));
		// World position: (200 + 200, 150 + 150) = (400, 300)
		const top = img.at(400, 300);
		expect(top.r).toBeGreaterThan(150);
		expect(top.g).toBeLessThan(top.r / 2);
		expect(img.at(20, 20).r).toBeLessThan(10);
	});

	it("tints by the animated `color` prop", async () => {
		const comp = stage();
		comp.add(
			Layer3D.sphere({
				id: "ball",
				radius: 120,
				x: 400,
				y: 300,
				tint: "#ffffff",
			}).animate(
				LayerAnimation.create().keys("color", [
					[0, "#ffffff"],
					[10, "#2040ff"],
				]),
			),
		);
		const start = (await decode(await comp.renderFrame({ frame: 0 }))).at(
			400,
			300,
		);
		const end = (await decode(await comp.renderFrame({ frame: 10 }))).at(
			400,
			300,
		);
		expect(start.r).toBeGreaterThan(180);
		expect(end.b).toBeGreaterThan(end.r * 2);
	});

	it("rebuilds the mesh from its options when modelData is lost (a JSON spec)", async () => {
		const comp = stage();
		const cylinder = Layer3D.cylinder({
			id: "can",
			radius: 100,
			height: 120,
			x: 400,
			y: 300,
			color: "#30ff30",
		});
		expect(cylinder.primitive3d).toMatchObject({
			type: "cylinder",
			radius: 100,
		});
		delete cylinder.modelData;
		comp.add(cylinder);
		const center = (await decode(await comp.renderFrame({ frame: 0 }))).at(
			400,
			300,
		);
		expect(center.g).toBeGreaterThan(150);
		expect(center.r).toBeLessThan(center.g / 2);
	});

	it("renders a faceted 3D shard with specular highlight", async () => {
		const comp = stage();
		comp.add(
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.5,
				x: 300,
				y: 0,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);
		comp.add(
			Layer3D.shard({
				radius: 120,
				facets: 14,
				seed: 7,
				irregularity: 0.4,
				x: 400,
				y: 300,
				color: "#ff0077",
				material: "lit",
			}),
		);
		const decoded = await decode(await comp.renderFrame({ frame: 0 }));
		const pixel = decoded.at(400, 300);
		// Shard is brightly lit and drawn with #ff0077 base color
		expect(pixel.r).toBeGreaterThan(100);
		expect(pixel.b).toBeGreaterThan(30);
	});

	it("renders torus, capsule, ring, solid prism, pyramid, and icosphere with materials", async () => {
		const comp = stage();
		comp.add(
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.4,
				x: 200,
				y: -400,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);
		comp.add([
			Layer3D.torus({
				radius: 70,
				tube: 24,
				x: 220,
				y: 300,
				rotateX: 55,
				color: "#ef4444",
				roughness: 0.3,
				metallic: 0.2,
			}),
			Layer3D.capsule({
				radius: 35,
				length: 70,
				x: 400,
				y: 300,
				color: "#22c55e",
			}),
			Layer3D.prism({
				sides: 6,
				radius: 55,
				height: 80,
				x: 580,
				y: 300,
				color: "#3b82f6",
				emissive: "#1d4ed8",
				emissiveIntensity: 0.25,
			}),
			Layer3D.pyramid({
				sides: 4,
				radius: 50,
				height: 80,
				x: 300,
				y: 300,
				z: 140,
				color: "#eab308",
			}),
			Layer3D.icosphere({
				radius: 45,
				detail: 2,
				x: 500,
				y: 300,
				z: 140,
				color: "#a855f7",
			}),
		]);
		const decoded = await decode(await comp.renderFrame({ frame: 0 }));
		// Capsule at center (400, 300) is green
		const center = decoded.at(400, 300);
		expect(center.g).toBeGreaterThan(120);
		expect(center.g).toBeGreaterThan(center.r);
		// Prism at right is blue
		const right = decoded.at(555, 300);
		expect(right.b).toBeGreaterThan(100);
	});

	it("renders extruded 2D shapes, lathe profiles, hollow tubes, and 3D diagram lines/points", async () => {
		const comp = stage();
		comp.add([
			Layer3D.extrude({
				shape: "M -40 -40 L 40 -40 L 40 40 L -40 40 Z",
				depth: 30,
				bevelThickness: 4,
				bevelSize: 4,
				x: 240,
				y: 300,
				rotateX: 40,
				color: "#f97316",
			}),
			Layer3D.lathe({
				points: [
					[15, -40],
					[45, 0],
					[25, 40],
				],
				capped: true,
				x: 400,
				y: 300,
				color: "#06b6d4",
			}),
			Layer3D.tube({
				path: Path3D.catmullRom([
					[-60, -40, -40],
					[0, 0, 0],
					[60, 40, 40],
				]),
				x: 560,
				y: 300,
				radius: 18,
				innerRadius: 10,
				color: "#ec4899",
			}),
			Layer3D.line({
				points: [
					[-220, -100, 0],
					[220, -100, 0],
				],
				x: 400,
				y: 300,
				color: "#ffffff",
			}),
			Layer3D.points({
				points: [[-180, -100, -100]],
				x: 400,
				y: 300,
				pointSize: 16,
				color: "#facc15",
			}),
		]);
		const decoded = await decode(await comp.renderFrame({ frame: 0 }));
		// Lathe at center (400, 300) is cyan
		const center = decoded.at(400, 300);
		expect(center.b).toBeGreaterThan(100);
		expect(center.g).toBeGreaterThan(80);
	});
});

describe("text reveal by count", () => {
	it("shows that many characters when `text` is above 1", async () => {
		const render = async (node: ReturnType<typeof Layer.text>) => {
			const comp = new Composition({
				width: 400,
				height: 120,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#000000",
			});
			comp.add(node);
			return decode(await comp.renderFrame({ frame: 0 }));
		};
		const props = {
			id: "t",
			position: "absolute" as const,
			x: 10,
			y: 10,
			fontSize: 64,
			fill: "#ffffff",
		};
		const counted = await render(
			Layer.text("Hello", props).animate(
				LayerAnimation.create().keys("text", [[0, 3]]),
			),
		);
		const plain = await render(Layer.text("Hel", props));
		const full = await render(Layer.text("Hello", props));
		const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
			let sum = 0;
			for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
			return sum;
		};
		expect(diff(counted.data, plain.data)).toBe(0);
		expect(diff(counted.data, full.data)).toBeGreaterThan(0);
	});
});
