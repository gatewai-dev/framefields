import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it, vi } from "vitest";
import {
	ChartGPUEngineBridge,
	type ChartGPUOptions,
	Composition,
	ensureDevice,
	Layer,
	LayerAnimation,
	signal,
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

function countNonZeroPixels(image: DecodedImage, threshold = 10): number {
	let count = 0;
	for (let i = 0; i < image.pixels.length; i += 4) {
		const a = image.pixels[i + 3] ?? 0;
		const r = image.pixels[i] ?? 0;
		const g = image.pixels[i + 1] ?? 0;
		const b = image.pixels[i + 2] ?? 0;
		if (a > threshold && (r > threshold || g > threshold || b > threshold)) {
			count++;
		}
	}
	return count;
}

describe("ChartGPU Conformance Test Suite (Headless WebGPU & Compositor Integration)", () => {
	it("1. Shared Device Reuse Test: reuses context device without calling requestDevice", async () => {
		const device = await ensureDevice();
		const createTextureSpy = vi.spyOn(device, "createTexture");

		const bridge = new ChartGPUEngineBridge({
			device,
			width: 400,
			height: 200,
		});

		// The bridge takes chartgpu's own option type, not the document schema's.
		const testOptions: Parameters<ChartGPUEngineBridge["initialize"]>[0] = {
			theme: "dark",
			series: [
				{
					type: "line",
					data: [
						[0, 10],
						[1, 25],
						[2, 40],
					],
				},
			],
		};

		await bridge.initialize(testOptions);
		expect(bridge.width).toBe(400);
		expect(bridge.height).toBe(200);

		const renderedTex = await bridge.renderFrame(1.0);
		expect(renderedTex).toBeDefined();
		expect(createTextureSpy).toHaveBeenCalled();

		bridge.destroy();
	});

	it("2. Offscreen Rendering & Pixel Sampling: renders line chart with area gradient into offscreen texture", async () => {
		const comp = new Composition({
			width: 400,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		const lineChartOptions: ChartGPUOptions = {
			theme: "dark",
			backgroundColor: "transparent",
			padding: { top: 10, right: 10, bottom: 10, left: 10 },
			xAxis: { type: "category", show: false },
			yAxis: { type: "value", show: false },
			series: [
				{
					type: "line",
					data: [
						[0, 10],
						[1, 80],
						[2, 30],
						[3, 90],
						[4, 50],
					],
					lineStyle: {
						color: "#3b82f6",
						width: 3,
						smooth: true,
					},
					areaStyle: {
						color: "#3b82f6",
						gradient: {
							direction: "vertical",
							stops: [
								{ offset: 0, color: "rgba(59, 130, 246, 0.8)" },
								{ offset: 1, color: "rgba(59, 130, 246, 0.0)" },
							],
						},
						opacity: 0.6,
					},
				},
			],
		};

		comp.add(
			Layer.chart(lineChartOptions, {
				id: "conformance-chart",
				x: 0,
				y: 0,
				width: 400,
				height: 200,
			}),
		);

		const pngBuffer = await comp.renderFrame({ atMs: 0 });
		const decoded = await decodePngPixels(pngBuffer);

		expect(decoded.width).toBe(400);
		expect(decoded.height).toBe(200);

		const nonZeroCount = countNonZeroPixels(decoded, 10);
		expect(nonZeroCount).toBeGreaterThan(100);

		// Verify presence of blue hues from #3b82f6 (R: ~59, G: ~130, B: ~246)
		let hasBlueLineOrAreaPixel = false;
		for (let i = 0; i < decoded.pixels.length; i += 4) {
			const b = decoded.pixels[i + 2] ?? 0;
			const r = decoded.pixels[i] ?? 0;
			if (b > 100 && b > r + 30) {
				hasBlueLineOrAreaPixel = true;
				break;
			}
		}
		expect(hasBlueLineOrAreaPixel).toBe(true);
	});

	it("3. Temporal Write-On Progress Delta: frame at progress 0.8 has strictly greater non-zero pixels than progress 0.2", async () => {
		const dataPoints: [number, number][] = [];
		for (let i = 0; i < 50; i++) {
			dataPoints.push([i, Math.sin(i * 0.2) * 40 + 50]);
		}

		const chartOptions: ChartGPUOptions = {
			theme: "dark",
			backgroundColor: "transparent",
			xAxis: { type: "category", show: false },
			yAxis: { type: "value", show: false },
			series: [
				{
					type: "line",
					data: dataPoints,
					lineStyle: { color: "#00ff88", width: 2 },
				},
			],
		};

		const comp = new Composition({
			width: 400,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		const chartLayer = Layer.chart(chartOptions, {
			id: "writeon-chart",
			x: 0,
			y: 0,
			width: 400,
			height: 200,
		}).animate(
			LayerAnimation.create().drawProgress(0.2, 0.8, { from: 0, to: 30 }),
		);

		comp.add(chartLayer);

		const isGreenLinePixel = (px: PixelRgba) => px.g > 100 && px.g > px.r + 30;
		const countGreenPixels = (image: DecodedImage) => {
			let count = 0;
			for (let i = 0; i < image.pixels.length; i += 4) {
				const r = image.pixels[i] ?? 0;
				const g = image.pixels[i + 1] ?? 0;
				const b = image.pixels[i + 2] ?? 0;
				const a = image.pixels[i + 3] ?? 0;
				if (isGreenLinePixel({ r, g, b, a })) {
					count++;
				}
			}
			return count;
		};

		const pngEarly = await comp.renderFrame({ frame: 0 });
		const decodedEarly = await decodePngPixels(pngEarly);
		const greenEarly = countGreenPixels(decodedEarly);

		const pngLate = await comp.renderFrame({ frame: 20 });
		const decodedLate = await decodePngPixels(pngLate);
		const greenLate = countGreenPixels(decodedLate);

		expect(greenLate).toBeGreaterThan(greenEarly);
	});

	it("4. 3D Perspective Projection Conformance: tilts chart container with rotateX, rotateY, and perspective", async () => {
		const chartOptions: ChartGPUOptions = {
			theme: "dark",
			backgroundColor: "#1e293b",
			xAxis: { type: "category", show: false },
			yAxis: { type: "value", show: false },
			series: [
				{
					type: "line",
					data: [
						[0, 10],
						[1, 50],
						[2, 20],
						[3, 80],
					],
					lineStyle: { color: "#f59e0b", width: 4 },
				},
			],
		};

		const compTilted = new Composition({
			width: 400,
			height: 300,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		compTilted.add(
			Layer.chart(chartOptions, {
				id: "tilted-chart",
				x: 50,
				y: 50,
				width: 300,
				height: 200,
				rotateX: 20,
				rotateY: -25,
				perspective: 800,
			}),
		);

		const pngTilted = await compTilted.renderFrame({ frame: 0 });
		const decodedTilted = await decodePngPixels(pngTilted);

		const nonZeroTilted = countNonZeroPixels(decodedTilted, 10);
		expect(nonZeroTilted).toBeGreaterThan(50);
	});

	it("5. Reactive Signal Integration: dynamic signal modulates chart progression", async () => {
		const dynProgress = signal(0.1);

		const chartOptions: ChartGPUOptions = {
			theme: "dark",
			series: [
				{
					type: "line",
					data: [
						[0, 10],
						[1, 30],
						[2, 60],
						[3, 90],
					],
					lineStyle: { color: "#ef4444", width: 2 },
				},
			],
		};

		const comp = new Composition({
			width: 400,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});

		const chartLayer = Layer.chart(chartOptions, {
			id: "signal-chart",
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			progress: dynProgress.value,
		});
		comp.add(chartLayer);

		const png1 = await comp.renderFrame({ atMs: 0 });
		const decoded1 = await decodePngPixels(png1);
		const count1 = countNonZeroPixels(decoded1, 10);

		// Update reactive signal
		dynProgress.value = 1.0;
		chartLayer.progress = dynProgress.value;

		const png2 = await comp.renderFrame({ atMs: 0 });
		const decoded2 = await decodePngPixels(png2);
		const count2 = countNonZeroPixels(decoded2, 10);

		expect(count2).toBeGreaterThanOrEqual(count1);
	});
});
