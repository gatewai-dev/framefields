/**
 * Containers draw without a group texture when nothing needs isolating, and
 * a container's effects run over its box plus their reach. These pin what
 * those shortcuts must keep: rounded corners, children, and shadows that
 * reach past the box.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { LayerStyle } from "./effects/index.js";
import { Composition, Flip, Layer } from "./index.js";

async function pixels(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return (x: number, y: number) =>
		Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

const scene = (child: ReturnType<typeof Layer.box>) => {
	const comp = new Composition({
		width: 400,
		height: 400,
		fps: 30,
		durationFrames: 10,
		backgroundColor: "#000000",
	});
	comp.add(
		Layer.box({
			width: 400,
			height: 400,
			background: "#000000",
			children: [child],
		}),
	);
	return comp;
};

describe("container fast paths", () => {
	it("a rounded card with children clear of its corners keeps both", async () => {
		const card = Layer.box({
			position: "absolute",
			x: 100,
			y: 100,
			width: 200,
			height: 200,
			borderRadius: 40,
			background: "#ffffff",
			children: [
				Layer.box({
					position: "absolute",
					x: 50,
					y: 50,
					width: 100,
					height: 100,
					background: "#ff0000",
				}),
			],
		});
		const at = await pixels(await scene(card).renderFrame({ frame: 0 }));
		expect(at(200, 200)).toEqual([255, 0, 0]); // the child
		expect(at(120, 200)).toEqual([255, 255, 255]); // the card
		expect(at(102, 102)).toEqual([0, 0, 0]); // outside the rounded corner
	});

	it("a shadow reaches past its box", async () => {
		const box = Layer.box({
			position: "absolute",
			x: 150,
			y: 100,
			width: 100,
			height: 100,
			background: "#ffffff",
			children: [
				Layer.box({
					position: "absolute",
					x: 20,
					y: 20,
					width: 60,
					height: 60,
					background: "#888888",
				}),
			],
		}).withEffect(
			new LayerStyle({
				dropShadow: {
					enabled: true,
					color: "#ff0000",
					opacity: 1,
					angle: 90,
					distance: 12,
					size: 4,
				},
			} as ConstructorParameters<typeof LayerStyle>[0]),
		);
		const at = await pixels(await scene(box).renderFrame({ frame: 0 }));
		expect(at(200, 150)).toEqual([136, 136, 136]); // the child, untouched
		// Below the box, where only the shadow is.
		const below = at(200, 207);
		expect(below[0]).toBeGreaterThan(120);
		expect(below[1]).toBeLessThan(40);
	});

	it("an effect that declares no reach still runs over the whole target", async () => {
		// Flip (a mirror) has no `reach`: on a container it mirrors across the
		// whole canvas, so a box on the left lands on the right.
		const box = Layer.box({
			position: "absolute",
			x: 40,
			y: 150,
			width: 100,
			height: 100,
			background: "#ffffff",
			children: [
				Layer.box({
					position: "absolute",
					x: 10,
					y: 10,
					width: 20,
					height: 20,
					background: "#ff0000",
				}),
			],
		}).withEffect(new Flip({ horizontal: true }));
		const at = await pixels(await scene(box).renderFrame({ frame: 0 }));
		expect(at(90, 200)).toEqual([0, 0, 0]); // where it was laid out
		expect(at(310, 200)).toEqual([255, 255, 255]); // mirrored across the canvas
	});
});
