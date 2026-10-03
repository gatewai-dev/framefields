import type { VirtualMediaData } from "@gitframes/core";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	FontManager,
	Layer,
	LayerAnimation,
	Media,
	TextPathBuilder,
} from "./index.js";
import { HeadlessMediaRenderer } from "./renderer/index.js";

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

function getLuminance(pixel: PixelRgba): number {
	return 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
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

describe("Rendering Conformance Test Suite (Headless WebGPU & Pixel Verification)", () => {
	const renderer = new HeadlessMediaRenderer();

	it("1. Pixel Sampling: accurately renders background and shape geometry with exact colors", async () => {
		const comp = new Composition({
			width: 320,
			height: 180,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#112233", // R: 17, G: 34, B: 51
		});

		// Rectangular shape with green fill #00ff88 (R: 0, G: 255, B: 136)
		comp.add(
			Layer.shape("rect", {
				x: 40,
				y: 30,
				width: 100,
				height: 80,
				fillColor: "#00ff88",
			}),
		);

		const vm = comp.toVirtualMedia();
		const pngBuffer = await renderer.renderImage(vm, 0, 30);
		const decoded = await decodePngPixels(pngBuffer);

		expect(decoded.width).toBe(320);
		expect(decoded.height).toBe(180);

		// Sample background area (x: 10, y: 10)
		const bgPixel = getPixel(decoded, 10, 10);
		expect(Math.abs(bgPixel.r - 17)).toBeLessThanOrEqual(3);
		expect(Math.abs(bgPixel.g - 34)).toBeLessThanOrEqual(3);
		expect(Math.abs(bgPixel.b - 51)).toBeLessThanOrEqual(3);

		// Sample center of shape area (x: 90, y: 70)
		const shapePixel = getPixel(decoded, 90, 70);
		expect(shapePixel.r).toBeLessThanOrEqual(15);
		expect(shapePixel.g).toBeGreaterThanOrEqual(235);
		expect(Math.abs(shapePixel.b - 136)).toBeLessThanOrEqual(15);
	});

	it("2. Typography Conformance: rasterizes font glyphs with non-zero pixel coverage", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");

		const comp = new Composition({
			width: 320,
			height: 180,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		comp.add(
			Layer.text("GITFRAMES", {
				x: 30,
				y: 40,
				fontSize: 32,
				fill: "#ffffff",
				fontFamily: "Inter",
			}),
		);

		const vm = comp.toVirtualMedia();
		const pngBuffer = await renderer.renderImage(vm, 0, 30);
		const decoded = await decodePngPixels(pngBuffer);

		// Count bright pixels inside text bounding region [30..250, 40..85]
		let textPixelCount = 0;
		for (let y = 40; y < 85; y += 2) {
			for (let x = 30; x < 250; x += 2) {
				const p = getPixel(decoded, x, y);
				if (getLuminance(p) > 60) {
					textPixelCount++;
				}
			}
		}

		// Verify text glyphs actually produced visible pixels
		expect(textPixelCount).toBeGreaterThan(50);

		// Far corner should remain untouched black
		const cornerPixel = getPixel(decoded, 5, 5);
		expect(getLuminance(cornerPixel)).toBeLessThan(5);
	});

	it("3. VFX Shader Conformance: Vignette darkens corners relative to center", async () => {
		const baseVM: VirtualMediaData = {
			metadata: { width: 320, height: 240, fps: 30, durationMs: 1000 },
			operation: {
				op: "Paint",
				dataType: "Video",
				backgroundColor: "#ffffff",
				timeline: { startFrame: 0, segments: [{ startSec: 0, endSec: 1 }] },
			},
			children: [],
		};

		const media = new Media(baseVM).apply("Vignette", {
			strength: 85,
			radius: 0.35,
		});

		const pngBuffer = await renderer.renderImage(media.toVirtualMedia(), 0, 30);
		const decoded = await decodePngPixels(pngBuffer);

		const centerPixel = getPixel(decoded, 160, 120);
		const cornerPixel = getPixel(decoded, 10, 10);

		const centerLum = getLuminance(centerPixel);
		const cornerLum = getLuminance(cornerPixel);

		// Center must stay bright while corner is significantly darkened
		expect(centerLum).toBeGreaterThan(200);
		expect(cornerLum).toBeLessThan(120);
		expect(centerLum - cornerLum).toBeGreaterThan(80);
	});

	it("4. VFX Shader Conformance: ColorBalance correctly shifts color channel balances", async () => {
		const baseVM: VirtualMediaData = {
			metadata: { width: 200, height: 200, fps: 30, durationMs: 1000 },
			operation: {
				op: "Paint",
				dataType: "Video",
				backgroundColor: "#808080", // neutral gray (128, 128, 128)
				timeline: { startFrame: 0, segments: [{ startSec: 0, endSec: 1 }] },
			},
			children: [],
		};

		// Warm shift: boost Red, decrease Blue
		const media = new Media(baseVM).apply("ColorBalance", {
			shadows: { cyanRed: 40, magentaGreen: 0, yellowBlue: -40 },
			midtones: { cyanRed: 35, magentaGreen: 0, yellowBlue: -35 },
		});

		const pngBuffer = await renderer.renderImage(media.toVirtualMedia(), 0, 30);
		const decoded = await decodePngPixels(pngBuffer);

		const pixel = getPixel(decoded, 100, 100);

		// Red must be shifted upwards, Blue downwards
		expect(pixel.r).toBeGreaterThan(135);
		expect(pixel.b).toBeLessThan(120);
	});

	it("5. Temporal Motion Verification: detects frame animation and verifies deterministic repeatability", async () => {
		const comp = new Composition({
			width: 320,
			height: 180,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Animate shape from x: 10 to x: 200 across 30 frames
		comp.add(
			Layer.shape("rect", {
				width: 40,
				height: 40,
				fillColor: "#ffffff",
			}).animate(
				LayerAnimation.create().fromTo("x", 10, 200, { from: 0, to: 30 }),
			),
		);

		const vm = comp.toVirtualMedia();

		// Render frame 0 twice to test frame repeatability
		const frame0A = await renderer.renderImage(vm, 0, 30);
		const frame0B = await renderer.renderImage(vm, 0, 30);
		const decoded0A = await decodePngPixels(frame0A);
		const decoded0B = await decodePngPixels(frame0B);

		const mseIdentity = computeMse(decoded0A.pixels, decoded0B.pixels);
		expect(mseIdentity).toBe(0);

		// Render frame 20 and compute delta against frame 0
		const frame20 = await renderer.renderImage(vm, 20, 30);
		const decoded20 = await decodePngPixels(frame20);

		const mseMotion = computeMse(decoded0A.pixels, decoded20.pixels);
		expect(mseMotion).toBeGreaterThan(20);

		// Pixel at initial position (x: 25, y: 20) should be white in frame 0, but black in frame 20
		const p0 = getPixel(decoded0A, 25, 20);
		const p20 = getPixel(decoded20, 25, 20);
		expect(getLuminance(p0)).toBeGreaterThan(200);
		expect(getLuminance(p20)).toBeLessThan(10);
	});

	it("6. VFX Shader Conformance: FilmGrain generates statistical noise variance across solid colors", async () => {
		const baseVM: VirtualMediaData = {
			metadata: { width: 100, height: 100, fps: 30, durationMs: 1000 },
			operation: {
				op: "Paint",
				dataType: "Video",
				backgroundColor: "#808080", // solid gray
				timeline: { startFrame: 0, segments: [{ startSec: 0, endSec: 1 }] },
			},
			children: [],
		};

		const media = new Media(baseVM).apply("FilmGrain", {
			strength: 40,
		});

		const pngBuffer = await renderer.renderImage(media.toVirtualMedia(), 0, 30);
		const decoded = await decodePngPixels(pngBuffer);

		// Compute standard deviation of luminance across sampled pixels
		let sum = 0;
		const samples: number[] = [];
		for (let y = 10; y < 90; y += 4) {
			for (let x = 10; x < 90; x += 4) {
				const lum = getLuminance(getPixel(decoded, x, y));
				samples.push(lum);
				sum += lum;
			}
		}
		const mean = sum / samples.length;
		let varianceSum = 0;
		for (const val of samples) {
			varianceSum += (val - mean) * (val - mean);
		}
		const stdDev = Math.sqrt(varianceSum / samples.length);

		// Solid gray has stdDev = 0. With FilmGrain strength 40, stdDev must be > 3.0
		expect(stdDev).toBeGreaterThan(3.0);
	});

	it("7. VFX Shader Conformance: Blur disperses sharp step boundaries into smooth gradients", async () => {
		const comp = new Composition({
			width: 200,
			height: 100,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Right half white shape
		comp.add(
			Layer.shape("rect", {
				x: 100,
				y: 0,
				width: 100,
				height: 100,
				fillColor: "#ffffff",
			}),
		);

		const blurredMedia = new Media(comp.toVirtualMedia()).apply("Blur", {
			strength: 20,
		});

		const pngBuffer = await renderer.renderImage(
			blurredMedia.toVirtualMedia(),
			0,
			30,
		);
		const decoded = await decodePngPixels(pngBuffer);

		// Boundary column at x = 100 should have blurred mid-tone luminance
		const midPixel = getPixel(decoded, 100, 50);
		const midLum = getLuminance(midPixel);
		expect(midLum).toBeGreaterThan(40);
		expect(midLum).toBeLessThan(215);
	});
	/** Bounding box of pixels brighter than `threshold`, or null when none are. */
	function litBounds(image: DecodedImage, threshold = 128) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = -1;
		let maxY = -1;
		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < image.width; x++) {
				if (getLuminance(getPixel(image, x, y)) <= threshold) continue;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
		return maxX < 0 ? null : { minX, minY, maxX, maxY };
	}

	it("8. Path text is laid out in its node's space and follows the node and its parents", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		const badge = (x: number, y: number) =>
			Layer.text("ROUND AND ROUND AND ROUND ", {
				position: "absolute",
				x,
				y,
				width: 120,
				height: 120,
				fontSize: 14,
				fill: "#ffffff",
				fontFamily: "Inter",
				pathOptions: TextPathBuilder.circularBadge(60, 60, 45).build(),
			});
		const render = async (node: unknown) => {
			const comp = new Composition({
				width: 320,
				height: 180,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#000000",
			});
			comp.add(node as ReturnType<typeof Layer.box>);
			return litBounds(
				await decodePngPixels(
					await renderer.renderImage(comp.toVirtualMedia(), 0, 30),
				),
			);
		};

		const atOrigin = await render(badge(0, 0));
		const moved = await render(badge(150, 40));
		const nested = await render(
			Layer.box({
				position: "absolute",
				x: 100,
				y: 20,
				width: 200,
				height: 160,
				children: [badge(50, 20)],
			}),
		);
		expect(atOrigin).not.toBeNull();
		expect(moved?.minX).toBe((atOrigin?.minX ?? 0) + 150);
		expect(moved?.minY).toBe((atOrigin?.minY ?? 0) + 40);
		expect(nested).toEqual(moved);
	});

	it("9. SVG arc commands draw: a two-arc circle path strokes a full ring", async () => {
		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});
		comp.add(
			Layer.shape("path", {
				position: "absolute",
				x: 0,
				y: 0,
				width: 200,
				height: 200,
				d: "M 100 40 A 60 60 0 1 1 100 160 A 60 60 0 1 1 100 40",
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: 4,
			}),
		);
		const decoded = await decodePngPixels(
			await renderer.renderImage(comp.toVirtualMedia(), 0, 30),
		);
		for (const [x, y] of [
			[100, 40],
			[160, 100],
			[100, 160],
			[40, 100],
		]) {
			expect(
				getLuminance(getPixel(decoded, x, y)),
				`${x},${y}`,
			).toBeGreaterThan(128);
		}
		expect(getLuminance(getPixel(decoded, 100, 100))).toBeLessThan(5);
	});
});
