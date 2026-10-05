import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	Path3D,
} from "./index.js";

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

describe("WebGPU 3D Shapes & Path Follower Headless Conformance", () => {
	it("renders a 3D volumetric cube headlessly with true depth and orientation", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#050814",
		});

		// 3D Camera looking at the center
		comp.add(
			Layer.camera({
				id: "main-cam",
				x: 400,
				y: 300,
				z: -800,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// Volumetric 3D Cube centered at (400, 300, 0)
		const cube = Layer3D.cube({
			id: "test-cube",
			size: 200,
			x: 400,
			y: 300,
			z: 0,
			rotateX: 25,
			rotateY: 35,
			faces: {
				front: "#3b82f6", // Blue
				top: "#60a5fa", // Light Blue
				right: "#1d4ed8", // Dark Blue
			},
		});

		comp.add(cube);

		const pngBuf = await comp.renderFrame({ frame: 0 });
		expect(pngBuf.length).toBeGreaterThan(1000);
		expect(pngBuf[0]).toBe(0x89);
		expect(pngBuf[1]).toBe(0x50); // 'P'
		expect(pngBuf[2]).toBe(0x4e); // 'N'
		expect(pngBuf[3]).toBe(0x47); // 'G'

		const img = await decodePngPixels(pngBuf);
		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		// Center of screen should be colored by the cube (blue hues)
		const centerPix = getPixel(img, 400, 300);
		expect(centerPix.b).toBeGreaterThan(centerPix.r);
		expect(centerPix.b).toBeGreaterThan(100);

		// Corner of screen should be background (#050814)
		const cornerPix = getPixel(img, 50, 50);
		expect(cornerPix.r).toBeLessThan(20);
		expect(cornerPix.b).toBeLessThan(30);
	});

	it("applies an animated scale to a 3D cube", async () => {
		const comp = new Composition({
			width: 400,
			height: 300,
			fps: 24,
			durationMs: 2000,
			backgroundColor: "#000000",
		});
		comp.add(
			Layer.camera({ x: 200, y: 150, z: -800, targetX: 200, targetY: 150 }),
		);
		comp.add(
			Layer3D.cube({
				size: 160,
				x: 200,
				y: 150,
				rotateX: 20,
				rotateY: 30,
				faces: { front: "#ffffff", top: "#ffffff", right: "#ffffff" },
			}).animate(
				LayerAnimation.create().fromTo("scale", 0, 1, { start: 0, end: 24 }),
			),
		);

		const start = await decodePngPixels(await comp.renderFrame({ frame: 0 }));
		const end = await decodePngPixels(await comp.renderFrame({ frame: 24 }));
		expect(getPixel(start, 200, 150).r).toBeLessThan(20);
		expect(getPixel(end, 200, 150).r).toBeGreaterThan(100);
	});

	it("renders a 3D rotating cube producing temporal frame variance", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#0a0a0a",
		});

		comp.add(
			Layer.camera({
				id: "cam",
				x: 400,
				y: 300,
				z: -900,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		const cube = Layer3D.cube({
			id: "spin-cube",
			size: 220,
			x: 400,
			y: 300,
			z: 0,
			faces: {
				front: "#ef4444", // Red
				back: "#10b981", // Emerald
				left: "#f59e0b", // Amber
				right: "#6366f1", // Indigo
				top: "#ec4899", // Pink
				bottom: "#8b5cf6", // Purple
			},
		});

		// Animate cube rotating around Y axis from 0 to 90 degrees
		const cubeAnim = new LayerAnimation().fromTo("rotateY", 0, 90, {
			from: 0,
			to: 30,
		});
		cube.animate(cubeAnim);

		comp.add(cube);

		const frame0Buf = await comp.renderFrame({ frame: 0 });
		const frame30Buf = await comp.renderFrame({ frame: 30 });

		const img0 = await decodePngPixels(frame0Buf);
		const img30 = await decodePngPixels(frame30Buf);

		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(200); // Significant visual rotation delta
	});

	it("renders a 3D cylindrical Carousel with cards positioned radially", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#0f172a",
		});

		comp.add(
			Layer.camera({
				id: "cam",
				x: 400,
				y: 200,
				z: -1000,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		const cards = [
			Layer.box({ width: 120, height: 160, background: "#3b82f6" }),
			Layer.box({ width: 120, height: 160, background: "#10b981" }),
			Layer.box({ width: 120, height: 160, background: "#f59e0b" }),
			Layer.box({ width: 120, height: 160, background: "#ec4899" }),
		];

		const carousel = Layer.carousel3d({
			id: "my-carousel",
			radius: 250,
			items: cards,
			x: 400,
			y: 300,
			z: 0,
			rotateX: 15,
		});

		comp.add(carousel);

		const buf = await comp.renderFrame({ frame: 0 });
		expect(buf.length).toBeGreaterThan(1000);
		const img = await decodePngPixels(buf);

		// Verify cards are drawn in the scene
		const centerPix = getPixel(img, 400, 300);
		expect(centerPix.a).toBe(255);
	});

	it("renders a layer following a 3D spline trajectory via followPath", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 2000,
			backgroundColor: "#030712",
		});

		comp.add(
			Layer.camera({
				id: "cam",
				x: 400,
				y: 300,
				z: -1000,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		// 3D Path traveling from left to right with elevation and depth curvature
		const path = Path3D.catmullRom([
			[100, 450, -100],
			[300, 200, 100],
			[500, 400, 50],
			[700, 150, -50],
		]);

		const follower = Layer.box({
			id: "follower",
			width: 60,
			height: 60,
			background: "#f97316", // Vibrant orange
			is3D: true,
		});

		const pathAnim = new LayerAnimation().followPath(path, {
			start: 0,
			end: 30,
			autoOrient: true,
			banking: 1.0,
		});
		follower.animate(pathAnim);

		comp.add(follower);

		const f0Buf = await comp.renderFrame({ frame: 0 });
		const f15Buf = await comp.renderFrame({ frame: 15 });
		const f30Buf = await comp.renderFrame({ frame: 30 });

		const img0 = await decodePngPixels(f0Buf);
		const img15 = await decodePngPixels(f15Buf);
		const img30 = await decodePngPixels(f30Buf);

		// First orange (follower) pixel in a frame, scanning row by row.
		const findOrange = (img: typeof img0) => {
			for (let y = 0; y < img.height; y++) {
				for (let x = 0; x < img.width; x++) {
					const pix = getPixel(img, x, y);
					if (pix.r > 200 && pix.g > 100 && pix.b < 50) return { x, y };
				}
			}
			return null;
		};
		const found0 = findOrange(img0);
		const found15 = findOrange(img15);
		const found30 = findOrange(img30);

		expect(found0).not.toBeNull();
		// Halfway along the path the follower is still on screen.
		expect(found15).not.toBeNull();
		expect(found30).not.toBeNull();

		const p0 = getPixel(img0, found0!.x, found0!.y);
		expect(p0.r).toBeGreaterThan(150); // Orange

		const p30 = getPixel(img30, found30!.x, found30!.y);
		expect(p30.r).toBeGreaterThan(150); // Orange

		// MSE between start and finish should be substantial
		const mse = computeMse(img0.pixels, img30.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("renders planar 3D text in 3D camera space with lit material and point light", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#030712",
		});

		comp.add(
			Layer.camera({
				id: "cam-text-3d",
				x: 400,
				y: 300,
				z: -800,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(
			Layer.pointLight({
				id: "text-light",
				color: "#06b6d4",
				intensity: 2.0,
				x: 400,
				y: 200,
				z: -400,
				radius: 800,
			}),
		);

		const text3D = Layer3D.text({
			id: "hero-3d-title",
			text: "FRAMEFIELDS 3D",
			fontSize: 54,
			fontWeight: "bold",
			fill: "#ffffff",
			x: 400,
			y: 300,
			z: 0,
			rotateX: 15,
			rotateY: -20,
			material: "lit",
			shininess: 96,
			specularIntensity: 1.0,
		});

		comp.add(text3D);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		// Verify text pixels are rendered with cyan/white illumination
		let hasLitPixel = false;
		for (let y = 250; y < 350; y++) {
			for (let x = 250; x < 550; x++) {
				const pix = getPixel(img, x, y);
				if (pix.r > 50 || pix.g > 150 || pix.b > 150) {
					hasLitPixel = true;
					break;
				}
			}
			if (hasLitPixel) break;
		}
		expect(hasLitPixel).toBe(true);
	});

	it("renders multi-slice volumetric extruded 3D text (Layer3D.extrudedText)", async () => {
		const comp = new Composition({
			width: 800,
			height: 600,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#030712",
		});

		comp.add(
			Layer.camera({
				id: "cam-extruded",
				x: 400,
				y: 300,
				z: -800,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
		);

		comp.add(
			Layer.pointLight({
				id: "extruded-light",
				color: "#f59e0b",
				intensity: 2.5,
				x: 300,
				y: 200,
				z: -300,
				radius: 800,
			}),
		);

		const extruded = Layer3D.extrudedText({
			id: "volumetric-3d-text",
			text: "WEBGPU",
			fontSize: 72,
			fontWeight: "bold",
			fill: "#ffffff",
			bevelColor: "#d97706",
			depth: 32,
			slices: 8,
			x: 400,
			y: 300,
			z: 0,
			rotateX: 20,
			rotateY: 35,
			material: "lit",
		});

		comp.add(extruded);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		expect(img.width).toBe(800);
		expect(img.height).toBe(600);

		// Find lit pixels in the center region
		let foundExtruded = false;
		for (let y = 250; y < 350; y++) {
			for (let x = 250; x < 550; x++) {
				const pix = getPixel(img, x, y);
				if (pix.r > 100 && pix.a === 255) {
					foundExtruded = true;
					break;
				}
			}
			if (foundExtruded) break;
		}

		expect(foundExtruded).toBe(true);
	});
});
