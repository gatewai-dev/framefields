/**
 * Live text through the real renderer: a text layer whose string is a
 * function of the frame or a signal is read each time it is drawn, from a
 * composition compiled once (as the preview player draws it).
 */
import { Signal } from "@framefields/core";
import { describe, expect, it } from "vitest";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	type LayoutNode,
	rich,
} from "./index.js";

const W = 480;
const H = 120;

/** The horizontal extent of the drawn (bright) pixels. */
function ink(rgba: Buffer): { left: number; right: number; rows: number } {
	let left = W;
	let right = -1;
	const rows = new Set<number>();
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (rgba[(y * W + x) * 4] < 128) continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			rows.add(y);
		}
	return { left, right, rows: rows.size };
}

/** Compiles `layer` once and draws frames of it, as the player does. */
async function player(layer: LayoutNode) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 100,
	});
	c.add([layer]);
	const vm = c.toVirtualMedia();
	const renderer = new HeadlessMediaRenderer();
	return async (frame: number) =>
		ink(await renderer.renderFrame(vm, { fps: 30, frame, format: "rgba" }));
}

const style = { width: W, fontSize: 64, fill: "#ffffff" } as const;

describe("live text", () => {
	it("follows state a function reads", async () => {
		let score = 7;
		const draw = await player(
			Layer.text(() => String(score), style) as LayoutNode,
		);
		const one = await draw(0);
		score = 12345;
		const five = await draw(1);
		expect(one.right).toBeGreaterThan(one.left);
		// Five digits are about five times as wide, on one line.
		expect((five.right - five.left) / (one.right - one.left)).toBeGreaterThan(
			3,
		);
		expect(five.rows).toBeLessThan(one.rows * 1.5);
		score = 7;
		expect(await draw(2)).toEqual(one);
	});

	it("reads the frame it is drawn for", async () => {
		const draw = await player(
			Layer.text((ctx) => "8".repeat(1 + (ctx.frame % 4)), style) as LayoutNode,
		);
		const widths = [];
		for (const frame of [0, 1, 2, 3]) {
			const { left, right } = await draw(frame);
			widths.push(right - left);
		}
		expect(widths[1]).toBeGreaterThan(widths[0]);
		expect(widths[2]).toBeGreaterThan(widths[1]);
		expect(widths[3]).toBeGreaterThan(widths[2]);
	});

	it("takes a string signal, and live parts of rich text", async () => {
		const label = Signal.state("A");
		let n = 1;
		const drawSignal = await player(
			Layer.text({ ...style, text: label }) as LayoutNode,
		);
		const drawRich = await player(
			Layer.text(rich`x${() => "W".repeat(n)}`, style) as LayoutNode,
		);
		const a = await drawSignal(0);
		const r1 = await drawRich(0);
		label.set("AAAA");
		n = 4;
		const aaaa = await drawSignal(1);
		const r4 = await drawRich(1);
		expect(aaaa.right - aaaa.left).toBeGreaterThan(2 * (a.right - a.left));
		expect(r4.right - r4.left).toBeGreaterThan(2 * (r1.right - r1.left));
	});
});
