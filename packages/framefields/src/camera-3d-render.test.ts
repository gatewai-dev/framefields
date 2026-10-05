import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { CameraAnimation, Composition, Layer } from "./index.js";

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

describe("WebGPU 3D Camera & Multiplane Render Conformance", () => {
	it("renders 3D camera dolly with multiplane depth layers and optical scaling", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#05070d",
		});

		// 1. Camera with Dolly track
		const cameraAnim = CameraAnimation.camera().dolly({
			fromDistance: -2000,
			toDistance: -1000,
			start: 0,
			end: 30,
			ease: "none",
		});

		comp.add(
			Layer.camera({
				id: "dolly-cam",
				x: 400,
				y: 300,
				z: -2000,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
				animation: cameraAnim,
			}),
		);

		// 2. Background layer at z = 800 (Blue)
		comp.add(
			Layer.box({
				id: "bg-layer",
				is3D: true,
				z: 800,
				x: 250,
				y: 150,
				width: 300,
				height: 300,
				background: "#1e3a8a",
			}),
		);

		// 3. Foreground layer at z = -200 (Emerald)
		comp.add(
			Layer.box({
				id: "fg-layer",
				is3D: true,
				z: -200,
				x: 350,
				y: 250,
				width: 100,
				height: 100,
				background: "#059669",
			}),
		);

		// Render frame 0 (far camera) and frame 30 (near camera)
		const frame0Buf = await comp.renderFrame({ frame: 0 });
		const frame30Buf = await comp.renderFrame({ frame: 30 });

		// Verify PNG headers
		expect(frame0Buf.length).toBeGreaterThan(1000);
		expect(frame30Buf.length).toBeGreaterThan(1000);
		expect(frame0Buf[0]).toBe(0x89);
		expect(frame0Buf[1]).toBe(0x50); // 'P'
		expect(frame0Buf[2]).toBe(0x4e); // 'N'
		expect(frame0Buf[3]).toBe(0x47); // 'G'

		const img0 = await decodePngPixels(frame0Buf);
		const img30 = await decodePngPixels(frame30Buf);

		// Assert temporal frame delta (MSE) is significant due to camera movement
		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(15);

		// Sample center pixel of the foreground card (at center: x=400, y=300)
		const centerPixel = getPixel(img30, 400, 300);
		// Center pixel should have strong green component from emerald foreground (#059669)
		expect(centerPixel.g).toBeGreaterThan(centerPixel.r);
		expect(centerPixel.a).toBe(255);
	}, 15000);

	it("renders lateral camera truck with differential multiplane parallax", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#020408",
		});

		// Truck camera laterally across X
		const cameraAnim = CameraAnimation.camera().truck(300, 500, {
			start: 0,
			end: 30,
			ease: "none",
		});

		comp.add(
			Layer.camera({
				id: "truck-cam",
				x: 300,
				y: 300,
				z: -1400,
				animation: cameraAnim,
			}),
		);

		// Deep background card at z: 1000 (Red)
		comp.add(
			Layer.box({
				id: "deep-bg",
				is3D: true,
				z: 1000,
				x: 300,
				y: 200,
				width: 200,
				height: 200,
				background: "#dc2626",
			}),
		);

		// Foreground card at z: -300 (Cyan)
		comp.add(
			Layer.box({
				id: "close-fg",
				is3D: true,
				z: -300,
				x: 350,
				y: 250,
				width: 100,
				height: 100,
				background: "#06b6d4",
			}),
		);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame30 = await comp.renderFrame({ frame: 30 });

		expect(frame0.length).toBeGreaterThan(1000);
		expect(frame30.length).toBeGreaterThan(1000);

		const img0 = await decodePngPixels(frame0);
		const img30 = await decodePngPixels(frame30);

		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(25);
	}, 15000);

	it("renders spherical orbit turntable around target", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#080c14",
		});

		// Orbit camera azimuth from -30 to 30 degrees
		const cameraAnim = CameraAnimation.camera().orbit({
			azimuth: { from: -30, to: 30 },
			elevation: { from: 10, to: 10 },
			radius: { to: 1500 },
			start: 0,
			end: 30,
			ease: "none",
		});

		comp.add(
			Layer.camera({
				id: "orbit-cam",
				targetX: 400,
				targetY: 300,
				targetZ: 0,
				animation: cameraAnim,
			}),
		);

		comp.add(
			Layer.box({
				id: "central-card",
				is3D: true,
				z: 0,
				x: 300,
				y: 200,
				width: 200,
				height: 200,
				borderRadius: 16,
				background: "#8b5cf6",
			}),
		);

		const frame0 = await comp.renderFrame({ frame: 0 });
		const frame15 = await comp.renderFrame({ frame: 15 });
		const frame30 = await comp.renderFrame({ frame: 30 });

		const img0 = await decodePngPixels(frame0);
		const img15 = await decodePngPixels(frame15);
		const img30 = await decodePngPixels(frame30);

		// Frame 0 vs Frame 15 vs Frame 30 must have continuous movement
		const mse015 = computeMse(img0.pixels, img15.pixels);
		const mse1530 = computeMse(img15.pixels, img30.pixels);
		expect(mse015).toBeGreaterThan(10);
		expect(mse1530).toBeGreaterThan(10);
	}, 15000);

	it("renders Depth of Field (DoF) bilateral bokeh post-processing", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#030712",
		});

		// Focus on foreground (distance = 1000)
		comp.add(
			Layer.camera({
				id: "dof-cam",
				x: 400,
				y: 300,
				z: -1400,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
				dof: {
					enabled: true,
					focusDistance: 1000, // sharp at depth z = -400 (dist from eye = 1000)
					fStop: 1.4,
					maxBlurRadius: 28,
				},
			}),
		);

		// Sharp foreground card
		comp.add(
			Layer.box({
				id: "sharp-card",
				is3D: true,
				z: -400,
				x: 250,
				y: 150,
				width: 150,
				height: 150,
				background: "#f59e0b", // Amber
			}),
		);

		// Blurry background card
		comp.add(
			Layer.box({
				id: "blurred-bg-card",
				is3D: true,
				z: 800,
				x: 450,
				y: 250,
				width: 200,
				height: 200,
				background: "#ec4899", // Pink
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		expect(frameBuf.length).toBeGreaterThan(1000);

		const decoded = await decodePngPixels(frameBuf);
		expect(decoded.width).toBe(800);
		expect(decoded.height).toBe(600);

		// Check sharp card color presence
		const sharpPixel = getPixel(decoded, 325, 225);
		expect(sharpPixel.r).toBeGreaterThan(200);
		expect(sharpPixel.g).toBeGreaterThan(100);
	}, 15000);

	it("composites 2D screen overlays seamlessly over 3D camera scene", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#0f172a",
		});

		comp.add(
			Layer.camera({
				id: "cinema-cam",
				x: 400,
				y: 300,
				z: -1500,
			}),
		);

		// 3D Scene Layer
		comp.add(
			Layer.box({
				id: "world-cube",
				is3D: true,
				z: 0,
				x: 200,
				y: 150,
				width: 400,
				height: 300,
				background: "#3b82f6",
			}),
		);

		// 2D Screen Overlay (HUD Title) - no is3D
		comp.add(
			Layer.text("HEADS UP DISPLAY", {
				id: "screen-hud",
				is3D: false,
				x: 50,
				y: 50,
				fontSize: 32,
				fill: "#ffffff",
			}),
		);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		expect(frameBuf.length).toBeGreaterThan(1000);

		const decoded = await decodePngPixels(frameBuf);
		// Sample 3D world card at center (x=400, y=300)
		const worldPixel = getPixel(decoded, 400, 300);
		expect(worldPixel.b).toBeGreaterThan(150); // Blue card
	}, 15000);
});
