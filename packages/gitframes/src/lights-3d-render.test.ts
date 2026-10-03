import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation, Light } from "./index.js";

interface DecodedImage {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
}

interface PixelRgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

async function decodePngPixels(pngBuffer: Buffer): Promise<DecodedImage> {
	const img = await loadImage(pngBuffer);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const imgData = ctx.getImageData(0, 0, img.width, img.height);
	return {
		width: img.width,
		height: img.height,
		pixels: imgData.data,
	};
}

function getPixel(image: DecodedImage, x: number, y: number): PixelRgba {
	const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
	const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
	const index = (clampedY * image.width + clampedX) * 4;
	return {
		r: image.pixels[index] ?? 0,
		g: image.pixels[index + 1] ?? 0,
		b: image.pixels[index + 2] ?? 0,
		a: image.pixels[index + 3] ?? 0,
	};
}

function computeMse(
	pixelsA: Uint8ClampedArray,
	pixelsB: Uint8ClampedArray,
): number {
	if (pixelsA.length !== pixelsB.length) {
		throw new Error(
			`Pixel buffer size mismatch: ${pixelsA.length} vs ${pixelsB.length}`,
		);
	}
	let sumSquaredDiff = 0;
	for (let i = 0; i < pixelsA.length; i += 4) {
		const dr = (pixelsA[i] ?? 0) - (pixelsB[i] ?? 0);
		const dg = (pixelsA[i + 1] ?? 0) - (pixelsB[i + 1] ?? 0);
		const db = (pixelsA[i + 2] ?? 0) - (pixelsB[i + 2] ?? 0);
		sumSquaredDiff += (dr * dr + dg * dg + db * db) / 3;
	}
	return sumSquaredDiff / (pixelsA.length / 4);
}

describe("WebGPU 3D Lighting & Shading Conformance", () => {
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
