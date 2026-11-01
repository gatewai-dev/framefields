/**
 * A 2D leaf (text, a shape, media) rasterizes at its scale on the canvas: one
 * an ancestor scales up (a camera push, a card at scale 4) is as sharp as the
 * same thing drawn at that size, not a magnified layout-size raster. At scale
 * 1 and below it renders as it always has.
 */
import { Canvas, loadImage } from "skia-canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { LayerStyle } from "./effects/index.js";
import { Composition, FontManager, Layer } from "./index.js";

beforeAll(async () => {
	// No optical sizes: set at 10 px and scaled 4×, it is the same glyphs as at 40.
	await FontManager.register("assets/fonts/JetBrainsMono.ttf");
});

type Node = ReturnType<typeof Layer.box>;

/** Red channel of a frame holding `children`, by pixel. */
async function render(width: number, height: number, children: Node[]) {
	const comp = new Composition({
		width,
		height,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	comp.add(Layer.box({ width, height, children }));
	const img = await loadImage(await comp.renderFrame({ frame: 0 }));
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	return (x: number, y: number) => data[(y * img.width + x) * 4] as number;
}

/** `child` inside a box at (x, y) scaled `scale` from its top-left corner. */
const scaledBy = (scale: number, x: number, y: number, child: Node) =>
	Layer.box({
		position: "absolute",
		x,
		y,
		width: 100,
		height: 40,
		anchorX: 0,
		anchorY: 0,
		scale,
		children: [child],
	});

/** Mean and largest difference between two w×h regions. */
function compare(
	at: (x: number, y: number) => number,
	a: [number, number],
	b: [number, number],
	w: number,
	h: number,
) {
	let sum = 0;
	let max = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const d = Math.abs(at(a[0] + x, a[1] + y) - at(b[0] + x, b[1] + y));
			sum += d;
			max = Math.max(max, d);
		}
	return { mean: sum / (w * h), max };
}

const row = (
	at: (x: number, y: number) => number,
	y: number,
	x0: number,
	x1: number,
) => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));

describe("leaf raster scale", () => {
	it("an 8 px circle scaled 4× is the round 32 px circle, not a magnified blur", async () => {
		const circle = (size: number) =>
			Layer.shape("circle", {
				position: "absolute",
				x: 0,
				y: 0,
				width: size,
				height: size,
				fillColor: "#ffffff",
			});
		const at = await render(200, 80, [
			scaledBy(4, 20, 20, circle(8)),
			Layer.box({
				position: "absolute",
				x: 100,
				y: 20,
				width: 32,
				height: 32,
				children: [circle(32)],
			}),
		]);
		const diff = compare(at, [16, 16], [96, 16], 40, 40);
		expect(diff.mean).toBeLessThan(0.5);
		expect(diff.max).toBeLessThanOrEqual(8);
		// Inside the bounding square, outside the circle: dark, not a corner.
		expect(at(23, 23)).toBe(0);
		expect(at(36, 36)).toBe(255);
	});

	it("10 px text scaled 4× is set like 40 px text", async () => {
		const text = (fontSize: number) =>
			Layer.text("Wave 42", {
				position: "absolute",
				x: 0,
				y: 0,
				fontFamily: "JetBrains Mono",
				fontSize,
				fill: "#ffffff",
			});
		const at = await render(240, 160, [
			scaledBy(4, 10, 10, text(10)),
			Layer.box({
				position: "absolute",
				x: 10,
				y: 90,
				width: 220,
				height: 60,
				children: [text(40)],
			}),
		]);
		const diff = compare(at, [0, 0], [0, 80], 240, 70);
		expect(diff.mean).toBeLessThan(0.5);
		expect(diff.max).toBeLessThanOrEqual(16);
		// There is text to compare: solid strokes, not a soft smear.
		const ink = row(at, 40, 10, 230).filter((v) => v > 230).length;
		expect(ink).toBeGreaterThan(10);
	});

	it("a layer style scales with its layer: a 2× shadow is the shadow at twice the size", async () => {
		const shadowed = (size: number, k: number) =>
			Layer.shape("circle", {
				position: "absolute",
				x: 0,
				y: 0,
				width: size,
				height: size,
				fillColor: "#ffffff",
			}).withEffect(
				new LayerStyle({
					dropShadow: {
						enabled: true,
						color: "#ff0000",
						opacity: 1,
						angle: 90,
						distance: 3 * k,
						size: 4 * k,
					},
				} as ConstructorParameters<typeof LayerStyle>[0]),
			);
		const at = await render(200, 100, [
			scaledBy(2, 10, 10, shadowed(30, 1)),
			Layer.box({
				position: "absolute",
				x: 110,
				y: 10,
				width: 60,
				height: 60,
				children: [shadowed(60, 2)],
			}),
		]);
		const diff = compare(at, [10, 10], [110, 10], 70, 70);
		expect(diff.mean).toBeLessThan(0.5);
		expect(diff.max).toBeLessThanOrEqual(8);
		// The shadow shows past the circle's lower edge, inside the layer.
		expect(at(20, 66)).toBeGreaterThan(100);
	});

	it("at scale 1 and below a leaf keeps its layout-size raster", async () => {
		const at = await render(200, 100, [
			Layer.shape("circle", {
				position: "absolute",
				x: 20,
				y: 20,
				width: 32,
				height: 32,
				fillColor: "#ffffff",
			}),
			Layer.box({
				position: "absolute",
				x: 100,
				y: 20,
				width: 64,
				height: 64,
				anchorX: 0,
				anchorY: 0,
				scale: 0.5,
				children: [
					Layer.shape("circle", {
						width: 64,
						height: 64,
						fillColor: "#ffffff",
					}),
				],
			}),
		]);
		// Edge coverage near the top of each circle, as rendered before leaves
		// rasterized at their scale (a minified 64 px raster on the right).
		const near = (actual: number[], expected: number[]) => {
			for (const [i, v] of actual.entries())
				expect(Math.abs(v - (expected[i] as number))).toBeLessThanOrEqual(2);
		};
		near(row(at, 22, 24, 30), [0, 18, 184, 255, 255, 255, 255]);
		near(row(at, 22, 104, 110), [0, 0, 67, 214, 255, 255, 255]);
	});
});
