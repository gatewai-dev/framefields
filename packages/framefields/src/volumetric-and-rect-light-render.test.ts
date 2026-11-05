import { describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	LayerAnimation,
	Signal,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

type Proto = Record<string, (...args: unknown[]) => unknown>;

function sumDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	let total = 0;
	for (let i = 0; i < a.length; i++) {
		total += Math.abs(a[i] - (b[i] ?? 0));
	}
	return total;
}

function lumaAt(
	pixels: Uint8ClampedArray,
	width: number,
	x: number,
	y: number,
): number {
	const idx = (Math.round(y) * width + Math.round(x)) * 4;
	return (
		0.2126 * (pixels[idx] ?? 0) +
		0.7152 * (pixels[idx + 1] ?? 0) +
		0.0722 * (pixels[idx + 2] ?? 0)
	);
}

describe("Phase 1: Volumetric Fog, Light Shafts, Rect Area Lights & Omnidirectional Point Shadows", () => {
	it("carves shadowed volumetric light shafts (god rays) behind an occluder", async () => {
		const buildScene = (withVolumetricFog: boolean, withOccluder: boolean) => {
			const comp = new Composition({
				width: 320,
				height: 240,
				fps: 30,
				durationFrames: 10,
				backgroundColor: "#04060c",
			});
			comp.add([
				Layer.camera({
					x: 160,
					y: 120,
					z: -600,
					targetX: 160,
					targetY: 120,
					targetZ: 0,
				}),
				Layer.environment("night", {
					intensity: 0.2,
					...(withVolumetricFog && {
						volumetricFog: {
							density: 0.055,
							color: "#8ab8ff",
							anisotropy: 0.65,
							lightIntensity: 3.0,
							ambientIntensity: 0.2,
							steps: 32,
							maxDistance: 1800,
							noise: { scale: 0.004, strength: 0.35, octaves: 2 },
						},
					}),
				}),
				Layer.spotLight({
					x: 160,
					y: -220,
					z: 100,
					targetX: 160,
					targetY: 220,
					targetZ: 0,
					angle: 50,
					penumbra: 0.25,
					radius: 1800,
					color: "#ffe4b5",
					intensity: 4.5,
					castShadow: true,
				}),
				...(withOccluder
					? [
							Layer3D.roundedBox({
								x: 160,
								y: 40,
								z: 40,
								width: 110,
								height: 36,
								depth: 110,
								color: "#181c24",
								roughness: 0.6,
								castShadow: true,
							}),
						]
					: []),
			]);
			return comp;
		};

		const noFog = (
			await decodePngPixels(
				await buildScene(false, true).renderFrame({ frame: 0 }),
			)
		).pixels;
		const fogWithOccluder = (
			await decodePngPixels(
				await buildScene(true, true).renderFrame({ frame: 0 }),
			)
		).pixels;
		const fogUnoccluded = (
			await decodePngPixels(
				await buildScene(true, false).renderFrame({ frame: 0 }),
			)
		).pixels;

		// Volumetric fog significantly brightens the participating medium compared to empty air
		expect(sumDiff(noFog, fogWithOccluder)).toBeGreaterThan(25000);
		// Shadow caster carves a dark volumetric shadow shaft in the fog below the box
		expect(sumDiff(fogUnoccluded, fogWithOccluder)).toBeGreaterThan(8000);
	});

	it("renders Layer.rectLight area light illumination, representative-point specular, and shadows", async () => {
		const buildRectScene = (castShadow: boolean, intensity: number) => {
			const comp = new Composition({
				width: 300,
				height: 220,
				fps: 30,
				durationFrames: 10,
				backgroundColor: "#050508",
			});
			comp.add([
				Layer.camera({
					x: 150,
					y: -120,
					z: -480,
					targetX: 150,
					targetY: 140,
					targetZ: 0,
				}),
				Layer.environment("night", { intensity: 0.1 }),
				Layer.rectLight({
					x: 150,
					y: -160,
					z: -140,
					targetX: 150,
					targetY: 160,
					targetZ: 0,
					width: 320,
					height: 110,
					color: "#fff2dd",
					intensity,
					radius: 1600,
					castShadow,
				}),
				Layer3D.roundedBox({
					x: 150,
					y: 170,
					z: 0,
					width: 260,
					height: 18,
					depth: 260,
					radius: 0,
					color: "#d8dce6",
					roughness: 0.18,
					metallic: 0.25,
				}),
				Layer3D.sphere({
					x: 150,
					y: 95,
					z: -30,
					radius: 42,
					color: "#ffffff",
					roughness: 0.2,
					castShadow: true,
				}),
			]);
			return comp;
		};

		const dark = (
			await decodePngPixels(
				await buildRectScene(false, 0).renderFrame({ frame: 0 }),
			)
		).pixels;
		const unshadowed = (
			await decodePngPixels(
				await buildRectScene(false, 3.2).renderFrame({ frame: 0 }),
			)
		).pixels;
		const shadowed = (
			await decodePngPixels(
				await buildRectScene(true, 3.2).renderFrame({ frame: 0 }),
			)
		).pixels;

		expect(sumDiff(dark, unshadowed)).toBeGreaterThan(40000);
		expect(sumDiff(unshadowed, shadowed)).toBeGreaterThan(3000);
	});

	it("renders omnidirectional 6-face point light shadows in opposite directions simultaneously", async () => {
		const buildPointScene = (castShadow: boolean) => {
			const comp = new Composition({
				width: 360,
				height: 220,
				fps: 30,
				durationFrames: 10,
				backgroundColor: "#08080c",
			});
			comp.add([
				Layer.camera({
					x: 180,
					y: 110,
					z: -520,
					targetX: 180,
					targetY: 110,
					targetZ: 0,
				}),
				Layer.ambientLight("#ffffff", 0.08),
				// Central point light between left and right casters/walls
				Layer.pointLight({
					x: 180,
					y: 110,
					z: 0,
					color: "#ffffff",
					intensity: 2.2,
					radius: 1200,
					castShadow,
				}),
				// Left receiver wall (-X) and left shadow caster
				Layer3D.roundedBox({
					x: 30,
					y: 110,
					z: 0,
					width: 16,
					height: 180,
					depth: 180,
					radius: 0,
					color: "#e0e0e0",
					castShadow: false,
				}),
				Layer3D.sphere({
					x: 105,
					y: 110,
					z: 0,
					radius: 32,
					color: "#ff5533",
					castShadow: true,
				}),
				// Right receiver wall (+X) and right shadow caster
				Layer3D.roundedBox({
					x: 330,
					y: 110,
					z: 0,
					width: 16,
					height: 180,
					depth: 180,
					radius: 0,
					color: "#e0e0e0",
					castShadow: false,
				}),
				Layer3D.sphere({
					x: 255,
					y: 110,
					z: 0,
					radius: 32,
					color: "#3388ff",
					castShadow: true,
				}),
			]);
			return comp;
		};

		const unshadowed = (
			await decodePngPixels(
				await buildPointScene(false).renderFrame({ frame: 0 }),
			)
		).pixels;
		const shadowed = (
			await decodePngPixels(
				await buildPointScene(true).renderFrame({ frame: 0 }),
			)
		).pixels;

		expect(sumDiff(unshadowed, shadowed)).toBeGreaterThan(2500);
	});

	it("integrates live Signals directly in volumetricFog and Layer.rectLight while keeping comp.toSpec() schema-valid", async () => {
		const fogDensitySignal = Signal.fromArray([0.0, 0.09, 0.0]);
		const lightIntensitySignal = Signal.fromArray([0.0, 4.0, 0.0]);
		const rectWidthSignal = Signal.fromArray([80, 360, 80]);

		const comp = new Composition({
			width: 240,
			height: 180,
			fps: 30,
			durationFrames: 3,
			backgroundColor: "#04050a",
		});

		comp.add([
			Layer.camera({
				x: 120,
				y: 90,
				z: -420,
				targetX: 120,
				targetY: 90,
				targetZ: 0,
			}),
			Layer.environment("night", {
				intensity: 0.1,
				volumetricFog: {
					density: fogDensitySignal,
					color: "#9bc4ff",
					anisotropy: 0.6,
					lightIntensity: 2.5,
				},
			}),
			Layer.rectLight({
				x: 120,
				y: 20,
				z: -100,
				targetX: 120,
				targetY: 120,
				targetZ: 0,
				width: rectWidthSignal,
				height: 100,
				intensity: lightIntensitySignal,
				color: "#ffffff",
			}),
			Layer3D.roundedBox({
				x: 120,
				y: 135,
				z: 0,
				width: 180,
				height: 20,
				depth: 180,
				color: "#cccccc",
			}),
		]);

		// Verify comp.toSpec() is pure JSON and passes strict Zod validation
		const spec = comp.toSpec();
		expect(() => CompositorProgramSchema.parse(spec)).not.toThrow();

		const renderer = new HeadlessMediaRenderer();
		const f0 = await decodePngPixels(
			await comp.renderFrame({ frame: 0, renderer }),
		);
		const f1 = await decodePngPixels(
			await comp.renderFrame({ frame: 1, renderer }),
		);

		// Frame 1 has high signal-driven fog density and rect light intensity
		const centerLumaF0 = lumaAt(f0.pixels, 240, 120, 80);
		const centerLumaF1 = lumaAt(f1.pixels, 240, 120, 80);
		expect(centerLumaF1).toBeGreaterThan(centerLumaF0 + 15);
	});

	it("allocates zero new GPU textures and recycles buffers across 20 frames with volumetric fog, rect light & point shadows", async () => {
		const densitySig = Signal.fromArray(
			Array.from({ length: 30 }, (_, i) => 0.02 + 0.02 * Math.sin(i * 0.3)),
		);
		const comp = new Composition({
			width: 200,
			height: 160,
			fps: 30,
			durationFrames: 30,
			backgroundColor: "#05060a",
		});
		comp.add([
			Layer.camera({
				x: 100,
				y: 80,
				z: -380,
				targetX: 100,
				targetY: 80,
				targetZ: 0,
			}),
			Layer.environment("night", {
				volumetricFog: {
					density: densitySig,
					anisotropy: 0.55,
					steps: 20,
					noise: { strength: 0.4 },
				},
			}),
			Layer.rectLight({
				x: 100,
				y: -120,
				z: -100,
				targetX: 100,
				targetY: 80,
				targetZ: 0,
				width: 200,
				height: 90,
				intensity: 2.0,
				castShadow: true,
			}),
			Layer.pointLight({
				x: 60,
				y: 40,
				z: -60,
				intensity: 1.5,
				radius: 800,
				castShadow: true,
			}),
			Layer3D.sphere({
				x: 100,
				y: 80,
				z: 0,
				radius: 36,
				color: "#e8ecf4",
				castShadow: true,
			}),
		]);

		const renderer = new HeadlessMediaRenderer();
		// Warm up pools on first 3 frames
		for (let f = 0; f < 3; f++) {
			await comp.renderFrame({ frame: f, renderer });
		}

		const proto = (globalThis as unknown as { GPUDevice: { prototype: Proto } })
			.GPUDevice.prototype;
		const origCreateBuffer = proto.createBuffer;
		const origCreateTexture = proto.createTexture;
		let buffersCreated = 0;
		let texturesCreated = 0;
		proto.createBuffer = function (...args: unknown[]) {
			buffersCreated++;
			return origCreateBuffer.apply(this, args);
		};
		proto.createTexture = function (...args: unknown[]) {
			texturesCreated++;
			return origCreateTexture.apply(this, args);
		};
		try {
			for (let f = 3; f < 23; f++) {
				await comp.renderFrame({ frame: f, renderer });
			}
		} finally {
			proto.createBuffer = origCreateBuffer;
			proto.createTexture = origCreateTexture;
		}

		expect(texturesCreated).toBe(0);
		expect(buffersCreated).toBe(0);
	});

	it("supports ergonomic 3D property aliases (topRadius, majorRadius, cornerRadius, rotationX/Y/Z, camera fov, renderFrame format)", async () => {
		const comp = new Composition({
			width: 240,
			height: 160,
			fps: 30,
			durationFrames: 30,
			backgroundColor: "#060810",
		});

		const cam = Layer.camera({
			x: 120,
			y: 80,
			z: -400,
			targetX: 120,
			targetY: 80,
			targetZ: 0,
			fov: 42,
			near: 10,
			far: 4000,
		});
		expect(cam.lens?.fov).toBe(42);
		expect(cam.lens?.near).toBe(10);
		expect(cam.lens?.far).toBe(4000);

		const box = Layer3D.roundedBox({
			x: 60,
			y: 80,
			z: 0,
			width: 50,
			height: 50,
			depth: 50,
			cornerRadius: 8,
			rotationZ: 15,
			color: "#4a78c4",
		});
		expect(box.rotateZ).toBe(15);

		const cyl = Layer3D.cylinder({
			x: 120,
			y: 80,
			z: 0,
			topRadius: 16,
			bottomRadius: 24,
			height: 60,
			rotationX: 10,
			color: "#88a0c8",
		});
		expect(cyl.rotateX).toBe(10);

		const torus = Layer3D.torus({
			x: 180,
			y: 80,
			z: 0,
			majorRadius: 28,
			minorRadius: 8,
			rotationY: 25,
			color: "#f0c868",
		}).animate(
			LayerAnimation.keys("rotationY", [
				[0, 0],
				[29, 180],
			]),
		);
		expect(torus.rotateY).toBe(25);
		expect(torus.animation?.tracks[0]?.prop).toBe("rotateY");

		comp.add([cam, Layer.environment("studio"), box, cyl, torus]);

		// Ensure strict schema validation passes with zero unknown properties
		expect(() => CompositorProgramSchema.parse(comp.toSpec())).not.toThrow();

		const pngBuf = await comp.renderFrame({ frame: 10, format: "png" });
		expect(pngBuf[0]).toBe(0x89); // PNG magic byte
		const rgbaBuf = await comp.renderFrame({ frame: 10, format: "rgba" });
		expect(rgbaBuf.byteLength).toBe(240 * 160 * 4);
	});
});
