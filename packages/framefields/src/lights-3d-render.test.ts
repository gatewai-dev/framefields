import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation } from "./index.js";
import { computeMse, decodePngPixels, getPixel } from "./test-utils/pixels.js";

describe("WebGPU 3D Lighting & Shading Conformance", () => {
	it("renders direct lights beyond the eighth", async () => {
		const comp = new Composition({
			width: 400,
			height: 400,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});
		comp.add(
			Layer.camera({
				x: 200,
				y: 200,
				z: -600,
				targetX: 200,
				targetY: 200,
				targetZ: 0,
			}),
		);
		for (let i = 0; i < 8; i++)
			comp.add(
				Layer.directionalLight({
					color: "#ffffff",
					intensity: 0,
					x: 200,
					y: 200,
					z: -600,
					targetX: 200,
					targetY: 200,
					targetZ: 0,
				}),
			);
		comp.add(
			Layer.directionalLight({
				color: "#ff0000",
				intensity: 1,
				x: 200,
				y: 200,
				z: -600,
				targetX: 200,
				targetY: 200,
				targetZ: 0,
			}),
		);
		comp.add(
			Layer.box({
				is3D: true,
				x: 100,
				y: 100,
				width: 200,
				height: 200,
				background: "#ffffff",
				material: "lit",
			}),
		);
		const pixel = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 0 })),
			200,
			200,
		);
		expect(pixel.r).toBeGreaterThan(100);
		expect(pixel.g).toBeLessThan(30);
	});

	it("renders unlit mode when no lights are present (backward compatibility)", async () => {
		const comp = new Composition({
			width: 400,
			height: 400,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		comp.add(
			Layer.box({
				id: "unlit-card",
				is3D: true,
				z: 0,
				x: 100,
				y: 100,
				width: 200,
				height: 200,
				background: "#ff0000",
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);
		const center = getPixel(img, 200, 200);

		// Pure unlit red without darkening
		expect(center.r).toBeGreaterThanOrEqual(250);
		expect(center.g).toBeLessThan(10);
		expect(center.b).toBeLessThan(10);
		expect(center.a).toBe(255);
	});

	it("renders directional + ambient light diffuse shading on a 3D tilted plane", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#0a0a0a",
		});

		// Camera
		comp.add(
			Layer.camera({
				id: "main-cam",
				x: 300,
				y: 300,
				z: -1000,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// Ambient Light (dim background)
		comp.add(Layer.ambientLight("#ffffff", 0.1));

		// Directional Light from top-left shining toward center
		comp.add(
			Layer.directionalLight({
				color: "#ffffff",
				intensity: 1.0,
				x: 0,
				y: 0,
				z: -1000,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// 3D Plane tilted
		comp.add(
			Layer.box({
				id: "lit-plane",
				is3D: true,
				x: 150,
				y: 150,
				width: 300,
				height: 300,
				background: "#ffffff",
				rotateY: 30,
				material: "lit",
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		const center = getPixel(img, 300, 300);
		// Plane is lit by directional + ambient light
		expect(center.r).toBeGreaterThan(50);
		expect(center.g).toBeGreaterThan(50);
		expect(center.b).toBeGreaterThan(50);
		expect(center.a).toBe(255);
	});

	it("renders point light radial distance attenuation on a 3D surface", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Camera
		comp.add(
			Layer.camera({
				id: "cam",
				x: 300,
				y: 300,
				z: -1000,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// Point light positioned directly in front of the center (300, 300, -150)
		comp.add(
			Layer.pointLight({
				id: "pt-light",
				color: "#ffffff",
				intensity: 1.5,
				x: 300,
				y: 300,
				z: -150,
				radius: 350,
				decay: 1.0,
			}),
		);

		// Ground wall
		comp.add(
			Layer.box({
				id: "ground-wall",
				is3D: true,
				x: 50,
				y: 50,
				width: 500,
				height: 500,
				background: "#ffffff",
				material: "lit",
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		const centerPixel = getPixel(img, 300, 300);
		const edgePixel = getPixel(img, 100, 100);

		// Center directly under light should be bright
		expect(centerPixel.r).toBeGreaterThan(120);

		// Far edge (beyond 282px distance) should be significantly darker than center due to falloff
		expect(centerPixel.r).toBeGreaterThan(edgePixel.r * 1.5);
	});

	it("renders spot light cone cutoff with smooth penumbra", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Camera
		comp.add(
			Layer.camera({
				id: "cam",
				x: 300,
				y: 300,
				z: -1000,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// Spot light shining directly at center (300, 300) with a 20-degree cone
		comp.add(
			Layer.spotLight({
				id: "spot",
				color: "#00ff88",
				intensity: 1.5,
				x: 300,
				y: 300,
				z: -400,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
				angle: 20,
				penumbra: 0.3,
				radius: 1000,
			}),
		);

		// White wall
		comp.add(
			Layer.box({
				id: "wall",
				is3D: true,
				x: 50,
				y: 50,
				width: 500,
				height: 500,
				background: "#ffffff",
				material: "lit",
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		// Center inside spot cone
		const center = getPixel(img, 300, 300);
		// Far corner outside spot cone
		const corner = getPixel(img, 70, 70);

		// Inside cone has strong green tint (#00ff88)
		expect(center.g).toBeGreaterThan(100);
		// Outside cone should be near pitch black
		expect(corner.g).toBeLessThan(15);
	});

	it("renders animated moving point light with temporal frame variance", async () => {
		const comp = new Composition({
			width: 600,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		comp.add(
			Layer.camera({
				id: "cam",
				x: 300,
				y: 300,
				z: -1000,
				targetX: 300,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// Light moving horizontally from x=150 to x=450 across 30 frames (0..29)
		const lightAnim = LayerAnimation.fromTo("x", 150, 450, {
			start: 0,
			end: 29,
			ease: "none",
		});

		comp.add(
			Layer.pointLight({
				id: "moving-light",
				color: "#ff8800",
				intensity: 2.5,
				x: 150,
				y: 300,
				z: -150,
				radius: 220,
				animation: lightAnim,
			}),
		);

		comp.add(
			Layer.box({
				id: "wall",
				is3D: true,
				x: 50,
				y: 50,
				width: 500,
				height: 500,
				background: "#ffffff",
				material: "lit",
			}),
		);

		const frame0Buf = await comp.renderFrame({ frame: 0 });
		const frame29Buf = await comp.renderFrame({ frame: 29 });

		const img0 = await decodePngPixels(frame0Buf);
		const img29 = await decodePngPixels(frame29Buf);

		// Frame 0: left side (x=150) is bright, right side (x=450) is dark (outside radius)
		const left0 = getPixel(img0, 150, 300);
		const right0 = getPixel(img0, 450, 300);
		expect(left0.r).toBeGreaterThan(100);
		expect(right0.r).toBeLessThan(20);

		// Frame 29: right side (x=450) is bright, left side (x=150) is dark
		const left29 = getPixel(img29, 150, 300);
		const right29 = getPixel(img29, 450, 300);
		expect(right29.r).toBeGreaterThan(100);
		expect(left29.r).toBeLessThan(20);

		// Temporal MSE variance
		const mse = computeMse(img0.pixels, img29.pixels);
		expect(mse).toBeGreaterThan(20);
	});
});
