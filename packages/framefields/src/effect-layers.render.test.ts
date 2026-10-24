import { beforeAll, describe, expect, it } from "vitest";
import {
	Blur,
	Composition,
	FontManager,
	Layer,
	Pixelate,
	Signal,
} from "./index.js";
import { computeMse, decodePngPixels, getPixel } from "./test-utils/pixels.js";

const W = 200;
const H = 200;

function createStage(fps = 30) {
	return new Composition({
		width: W,
		height: H,
		fps,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
}

describe("Effects on Non-Media Layers", () => {
	beforeAll(async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
	});

	it("applies post-processing effect (Blur) directly to Layer.box", async () => {
		// Stage without effect: a 40x40 white square at center (x: 80, y: 80)
		const plainComp = createStage();
		plainComp.add(
			Layer.box({
				x: 80,
				y: 80,
				width: 40,
				height: 40,
				background: "#ffffff",
			}),
		);
		const plainImg = await decodePngPixels(
			await plainComp.renderFrame({ frame: 0 }),
		);
		// Outside the box (x: 70, y: 100), the plain background is pure black
		const outsidePlain = getPixel(plainImg, 70, 100);
		expect(outsidePlain.r).toBe(0);
		expect(outsidePlain.g).toBe(0);
		expect(outsidePlain.b).toBe(0);

		// Stage with Blur effect directly on the Layer.box
		const blurComp = createStage();
		blurComp.add(
			Layer.box({
				x: 80,
				y: 80,
				width: 40,
				height: 40,
				background: "#ffffff",
			}).withEffect(new Blur({ strength: 35 })),
		);
		const blurImg = await decodePngPixels(
			await blurComp.renderFrame({ frame: 0 }),
		);
		// Inside the blurred box at center, it's lit
		const centerBlur = getPixel(blurImg, 100, 100);
		expect(centerBlur.r).toBeGreaterThan(40);

		// With blur, white spreads outside the 80..120 bounds
		const edgeIn = getPixel(blurImg, 80, 100);
		expect(edgeIn.r).toBeGreaterThan(10);

		// The images must differ significantly
		const mse = computeMse(plainImg.pixels, blurImg.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("applies post-processing effect (Blur) directly to Layer.shape", async () => {
		// Plain shape: filled white circle at center (radius 25)
		const plainComp = createStage();
		plainComp.add(
			Layer.shape("circle", {
				x: 75,
				y: 75,
				width: 50,
				height: 50,
				fillColor: "#ffffff",
			}),
		);
		const plainImg = await decodePngPixels(
			await plainComp.renderFrame({ frame: 0 }),
		);
		// Plain circle center is fully white
		expect(getPixel(plainImg, 100, 100).r).toBe(255);

		// Shape with Blur effect attached
		const blurComp = createStage();
		blurComp.add(
			Layer.shape("circle", {
				x: 75,
				y: 75,
				width: 50,
				height: 50,
				fillColor: "#ffffff",
			}).withEffect(new Blur({ strength: 35 })),
		);
		const blurImg = await decodePngPixels(
			await blurComp.renderFrame({ frame: 0 }),
		);

		// With blur, center intensity is softened and edges blurred
		const centerBlur = getPixel(blurImg, 100, 100);
		expect(centerBlur.r).toBeLessThan(255);
		expect(centerBlur.r).toBeGreaterThan(40);

		const mse = computeMse(plainImg.pixels, blurImg.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("applies post-processing effect directly to Layer.text", async () => {
		const plainComp = createStage();
		plainComp.add(
			Layer.text("EFFECT", {
				x: 20,
				y: 70,
				fontSize: 36,
				fill: "#ffffff",
				fontFamily: "Inter",
			}),
		);
		const plainImg = await decodePngPixels(
			await plainComp.renderFrame({ frame: 0 }),
		);

		const blurComp = createStage();
		blurComp.add(
			Layer.text("EFFECT", {
				x: 20,
				y: 70,
				fontSize: 36,
				fill: "#ffffff",
				fontFamily: "Inter",
			}).withEffect(new Blur({ strength: 20 })),
		);
		const blurImg = await decodePngPixels(
			await blurComp.renderFrame({ frame: 0 }),
		);

		const mse = computeMse(plainImg.pixels, blurImg.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("applies effect to container layers (Layer.box / Layer.flex with children)", async () => {
		// Container with background and two colored boxes inside
		const makeComp = (effect?: Blur) => {
			const comp = createStage();
			const container = Layer.box({
				x: 30,
				y: 30,
				width: 140,
				height: 140,
				background: "#111111",
				children: [
					Layer.box({
						x: 10,
						y: 10,
						width: 40,
						height: 40,
						background: "#ff0000",
					}),
					Layer.box({
						x: 80,
						y: 80,
						width: 40,
						height: 40,
						background: "#0000ff",
					}),
				],
			});
			if (effect) {
				container.withEffect(effect);
			}
			comp.add(container);
			return comp;
		};

		const plainImg = await decodePngPixels(
			await makeComp().renderFrame({ frame: 0 }),
		);
		const blurImg = await decodePngPixels(
			await makeComp(new Blur({ strength: 30 })).renderFrame({ frame: 0 }),
		);

		// Container blur bleeds child red/blue squares across container boundaries
		const mse = computeMse(plainImg.pixels, blurImg.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("evaluates animated effect uniforms on non-media layers across frames", async () => {
		// Blur strength animates from 0 at frame 0 to 40 at frame 15 via Signal.builder
		const animatedStrengthSignal = Signal.builder({
			type: "custom",
			fn: (ctx: { frame: number }) => (ctx.frame >= 15 ? 40 : 0),
		});
		const comp = createStage(30);
		comp.add(
			Layer.box({
				x: 80,
				y: 80,
				width: 40,
				height: 40,
				background: "#ffffff",
			}).withEffect(new Blur({ strength: animatedStrengthSignal })),
		);

		const frame0Img = await decodePngPixels(
			await comp.renderFrame({ frame: 0 }),
		);
		const frame15Img = await decodePngPixels(
			await comp.renderFrame({ frame: 15 }),
		);

		// At frame 0, strength is 0 -> sharp box, center is 255
		const p0 = getPixel(frame0Img, 100, 100);
		expect(p0.r).toBe(255);

		// At frame 15, strength is 40 -> blurred box, center drops due to blur dispersion
		const p15 = getPixel(frame15Img, 100, 100);
		expect(p15.r).toBeLessThan(100);
		expect(p15.r).toBeGreaterThan(20);

		// The two frames must differ significantly
		const mse = computeMse(frame0Img.pixels, frame15Img.pixels);
		expect(mse).toBeGreaterThan(50);
	});

	it("supports multiple chained effects on non-media layers", async () => {
		const comp = createStage();
		comp.add(
			Layer.box({
				x: 50,
				y: 50,
				width: 100,
				height: 100,
				background: "#ffffff",
			}).withEffects([new Pixelate({ size: 10 }), new Blur({ strength: 15 })]),
		);

		const buf = await comp.renderFrame({ frame: 0 });
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(buf.length).toBeGreaterThan(100);

		const img = await decodePngPixels(buf);
		const center = getPixel(img, 100, 100);
		expect(center.r).toBeGreaterThan(100);
	});
});
