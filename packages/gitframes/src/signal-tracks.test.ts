/**
 * LayerAnimation.signal accepts a signal object or the name of one registered
 * with comp.addSignal — both must drive the property frame by frame.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation, Signal } from "./index.js";

const FPS = 30;
// Opacity 0 on even frames, 1 on odd ones.
const GATE = Array.from({ length: 30 }, (_, f) => f % 2);

async function pixel(png: Buffer, x: number, y: number) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

function comp() {
	return new Composition({
		width: 200,
		height: 200,
		fps: FPS,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
}

function square(id: string, x: number, anim: LayerAnimation) {
	return Layer.box({
		id,
		position: "absolute",
		x,
		y: 0,
		width: 100,
		height: 200,
		background: "#ffffff",
	}).animate(anim);
}

async function brightness(c: Composition, frame: number, x = 50) {
	return (await pixel(await c.renderFrame({ frame }), x, 100))[0];
}

describe("signal tracks", () => {
	it("animates from a signal object (Signal.fromArray)", async () => {
		const c = comp();
		c.add(
			square(
				"a",
				0,
				LayerAnimation.create().signal("opacity", Signal.fromArray(GATE, FPS)),
			),
		);
		expect(await brightness(c, 4)).toBe(0);
		expect(await brightness(c, 5)).toBe(255);
	});

	it("animates from a signal object (Signal.builder custom fn)", async () => {
		const c = comp();
		const sig = Signal.builder({
			type: "custom",
			fn: (ctx) => (ctx.frame >= 10 ? 1 : 0),
		});
		c.add(square("a", 0, LayerAnimation.create().signal("opacity", sig)));
		expect(await brightness(c, 3)).toBe(0);
		expect(await brightness(c, 12)).toBe(255);
	});

	it("animates from a registered signal name", async () => {
		const c = comp();
		c.addSignal("gate", Signal.fromArray(GATE, FPS));
		c.add(square("a", 0, LayerAnimation.create().signal("opacity", "gate")));
		expect(await brightness(c, 4)).toBe(0);
		expect(await brightness(c, 5)).toBe(255);
	});

	it("keeps each inline signal on its own track, alongside named ones", async () => {
		const c = comp();
		c.addSignal("gate", Signal.fromArray(GATE, FPS));
		const inverted = Signal.fromArray(
			GATE.map((v) => 1 - v),
			FPS,
		);
		c.add(
			square("named", 0, LayerAnimation.create().signal("opacity", "gate")),
			// A nested child: inline signals are collected through containers.
			Layer.box({
				id: "wrap",
				position: "absolute",
				x: 100,
				y: 0,
				width: 100,
				height: 200,
				children: [
					square(
						"inline",
						0,
						LayerAnimation.create().signal("opacity", inverted),
					),
				],
			}),
		);
		expect(await brightness(c, 4, 50)).toBe(0);
		expect(await brightness(c, 4, 150)).toBe(255);
		expect(await brightness(c, 5, 50)).toBe(255);
		expect(await brightness(c, 5, 150)).toBe(0);
	});

	it("keeps the spec plain data and registers inline signals with the program", () => {
		const sig = Signal.fromArray(GATE, FPS);
		const anim = LayerAnimation.create()
			.signal("opacity", sig)
			.signal("scale", sig, { offset: 1 });
		const [a, b] = anim.tracks.map(
			(t) => (t.source as { inputHandleId: string }).inputHandleId,
		);
		// Same object → same handle, and the spec serialises without the object.
		expect(a).toBe(b);
		expect(a).toMatch(/^inline_signal_\d+$/);
		expect(JSON.parse(JSON.stringify(anim.toSpec()))).toEqual(anim.toSpec());

		const c = comp();
		c.add(square("a", 0, anim));
		const vm = c.toVirtualMedia() as {
			operation: { op: string; signals?: Record<string, unknown> };
			children?: unknown[];
		};
		const find = (n: typeof vm): typeof vm | undefined =>
			n.operation.op === "Compositor"
				? n
				: (n.children as (typeof vm)[] | undefined)?.map(find).find(Boolean);
		expect(find(vm)?.operation.signals?.[a]).toBe(sig);
	});

	it("rejects values that are neither a signal nor a name", () => {
		expect(() => LayerAnimation.create().signal("opacity", 0.5)).toThrow(
			/addSignal/,
		);
		expect(() => LayerAnimation.create().signal("opacity", undefined)).toThrow(
			/addSignal/,
		);
	});
});
