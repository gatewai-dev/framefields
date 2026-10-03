import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	Effect,
	Layer,
	Relight3D,
	Signal,
	TemporalDeflicker,
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

describe("Module 4: Signal-Based & Effects-Based Pipeline Conformance", () => {
	it("1. TemporalDeflicker Effect Integration: layer.withEffects(Effect.deflicker()) compiles and renders headlessly", async () => {
		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#0a0a0f",
		});

		// Add card with Effect.deflicker() attached via withEffects
		const card = Layer.box({
			id: "deflickered-card",
			x: 25,
			y: 25,
			width: 150,
			height: 150,
			background: "#3b82f6",
		}).withEffects([
			Effect.deflicker({
				blendWeight: 0.45,
				disocclusionThreshold: 0.2,
			}),
		]);

		comp.add(card);

		// Frame 0: Initializes history and renders initial frame
		const frame0Buf = await comp.renderFrame({ frame: 0 });
		expect(Buffer.isBuffer(frame0Buf)).toBe(true);
		expect(frame0Buf.length).toBeGreaterThan(100);

		const img0 = await decodePngPixels(frame0Buf);
		const center0 = getPixel(img0, 100, 100);
		// Card color #3b82f6 (r: 59, g: 130, b: 246)
		expect(center0.b).toBeGreaterThan(200);
		expect(center0.a).toBe(255);

		// Frame 1: Runs motion-compensated forward warping & adaptive temporal blend
		const frame1Buf = await comp.renderFrame({ frame: 1 });
		const img1 = await decodePngPixels(frame1Buf);
		const center1 = getPixel(img1, 100, 100);
		expect(center1.b).toBeGreaterThan(200);
		expect(center1.a).toBe(255);
	});

	it("2. Reactive Signal Modulation on TemporalDeflicker: Signal.sine modulates blendWeight", async () => {
		const comp = new Composition({
			width: 160,
			height: 160,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Dynamic blendWeight driven by Signal.sine across [0.1, 0.9]
		const dynamicBlendSignal = Signal.sine({
			min: 0.1,
			max: 0.9,
			period: 30,
		});

		const dynamicCard = Layer.box({
			id: "signal-deflickered-card",
			x: 20,
			y: 20,
			width: 120,
			height: 120,
			background: "#10b981",
		}).withEffects([
			new TemporalDeflicker({
				blendWeight: dynamicBlendSignal,
			}),
		]);

		comp.add(dynamicCard);

		const f0Buf = await comp.renderFrame({ frame: 0 });
		const f15Buf = await comp.renderFrame({ frame: 15 });

		const img0 = await decodePngPixels(f0Buf);
		const img15 = await decodePngPixels(f15Buf);

		const p0 = getPixel(img0, 80, 80);
		const p15 = getPixel(img15, 80, 80);

		expect(p0.g).toBeGreaterThan(150);
		expect(p15.g).toBeGreaterThan(150);
	});

	it("3. Relight3D Effect Integration: layer.withEffects(Effect.relight3d()) casts 3D point light", async () => {
		const comp = new Composition({
			width: 300,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#050505",
		});

		// Attach Relight3D effect with specular power and normalized light position
		const relitLayer = Layer.box({
			id: "relit-layer-effect",
			x: 50,
			y: 50,
			width: 200,
			height: 200,
			background: "#64748b",
		}).withEffects([
			Effect.relight3d({
				lightType: "Point",
				intensity: 2.5,
				lightPosX: 0.5,
				lightPosY: 0.5,
				lightPosZ: 0.25,
				lightRadius: 0.75,
				specularStrength: 0.9,
				ambientIntensity: 0.15,
			}),
		]);

		comp.add(relitLayer);

		const frameBuf = await comp.renderFrame({ frame: 0 });
		const img = await decodePngPixels(frameBuf);

		const centerPixel = getPixel(img, 150, 150);
		const cornerPixel = getPixel(img, 55, 55);

		// Center under normalized light (0.5, 0.5) must be significantly brighter than corner
		expect(centerPixel.r).toBeGreaterThan(cornerPixel.r);
		expect(centerPixel.r).toBeGreaterThan(80);
	});

	it("4. Relight3D Signal-Driven Modulation: Signal.sine modulates light intensity", async () => {
		const comp = new Composition({
			width: 300,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		// Dynamic intensity signal oscillating between 0.1 and 1.8
		const pulsingIntensity = Signal.sine({
			min: 0.1,
			max: 1.8,
			period: 30,
		});

		const pulseLayer = Layer.box({
			id: "pulse-relit-layer",
			x: 50,
			y: 50,
			width: 200,
			height: 200,
			background: "#475569",
		}).withEffects([
			new Relight3D({
				lightType: "Point",
				intensity: pulsingIntensity,
				lightPosX: 0.5,
				lightPosY: 0.5,
				lightPosZ: 0.3,
				lightRadius: 0.8,
			}),
		]);

		comp.add(pulseLayer);

		// Frame 0: Intensity at midpoint ~2.1
		const f0Buf = await comp.renderFrame({ frame: 0 });
		// Frame 8: Near peak intensity
		const f8Buf = await comp.renderFrame({ frame: 8 });

		const img0 = await decodePngPixels(f0Buf);
		const img8 = await decodePngPixels(f8Buf);

		const p0 = getPixel(img0, 150, 150);
		const p8 = getPixel(img8, 150, 150);

		expect(p8.r).toBeGreaterThan(p0.r);
		const mse = computeMse(img0.pixels, img8.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("5. Section Architecture Integration: comp.section with TemporalDeflicker", () => {
		const comp = Composition.create({
			width: 800,
			height: 600,
			fps: 30,
			durationFrames: 60,
		});

		const baseBox = Layer.box({
			width: 800,
			height: 600,
			background: "#1e1e24",
		});
		comp.add(baseBox);

		const sec = comp.addSection({
			x: 100,
			y: 100,
			width: 400,
			height: 300,
			borderRadius: 12,
			effects: [
				new TemporalDeflicker({
					blendWeight: 0.5,
					disocclusionThreshold: 0.18,
				}),
			],
		});

		expect(sec).toBeDefined();
		expect(sec.effects).toHaveLength(1);
		expect(sec.effects[0]).toBeInstanceOf(TemporalDeflicker);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");
	});
});
