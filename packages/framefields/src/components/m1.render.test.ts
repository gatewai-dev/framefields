import { describe, expect, it } from "vitest";
import { Composition, Layer } from "../index.js";
import { decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { AppFrame, FocusZoom, MousePointer } from "./testing.js";

/**
 * Render tests for the M1 components (spec §7.1, §7.2, §7.7): what the
 * components promise in numbers (cues, rects, toScreen) must match pixels.
 */
const W = 640;
const H = 360;

function comp(
	nodes: Parameters<Composition["add"]>[0],
	background = "#ffffff",
) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationMs: 4000,
		backgroundColor: background,
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));
const dark = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b < 120;

describe("MousePointer (render)", () => {
	it("is on its target, pressed, on the click frame", async () => {
		const pointer = MousePointer({
			path: [{ to: [120, 120] }, { to: [420, 200], click: true }],
			area: { width: W, height: H },
			shadow: false,
			ripple: false,
		});
		const click = pointer.cues.clicks[0]?.frame ?? 0;
		const img = await frame(comp(pointer), click);
		// Inside the arrow, just below and right of the hotspot (glyph is ~44 px).
		expect(dark(getPixel(img, 424, 214))).toBe(true);
		// Up-left of the hotspot is outside the arrow.
		expect(dark(getPixel(img, 410, 190))).toBe(false);
		// Nothing where it started.
		expect(dark(getPixel(img, 124, 134))).toBe(false);
	});

	it("leaves a ripple ring where it clicked", async () => {
		const pointer = MousePointer({
			path: [{ to: [300, 180], click: true }],
			area: { width: W, height: H },
			accent: "#ff0000",
			shadow: false,
		});
		const click = pointer.cues.clicks[0]?.frame ?? 0;
		const img = await frame(comp(pointer), click + 10);
		// Somewhere on the ring left of the click point is red.
		const reds = Array.from({ length: 50 }, (_, i) =>
			getPixel(img, 300 - 20 - i, 180),
		).filter((p) => p.r > 200 && p.g < 140 && p.b < 140);
		expect(reds.length).toBeGreaterThan(0);
	});
});

describe("AppFrame (render)", () => {
	it("draws content exactly in contentRect", async () => {
		const f = AppFrame({
			kind: "window",
			x: 40,
			y: 30,
			width: 560,
			height: 300,
			contentBackground: "#00ff00",
			elevation: 0,
			enter: false,
		});
		const r = f.contentRect;
		const img = await frame(comp(f, "#000000"), 0);
		const inside = getPixel(img, r.x + r.width / 2, r.y + r.height / 2);
		expect(inside.g).toBeGreaterThan(240);
		expect(inside.r).toBeLessThan(20);
		// The title bar above the content is chrome, not content.
		const bar = getPixel(img, r.x + r.width / 2, r.y - 10);
		expect(bar.g).toBeLessThan(100);
		// Content placed with at() lands where at() says.
		f.fill(
			Layer.box({
				position: "absolute",
				x: 100,
				y: 100,
				width: 20,
				height: 20,
				background: "#ff00ff",
			}),
		);
		const [mx, my] = f.at(110, 110);
		const img2 = await frame(comp(f, "#000000"), 0);
		const m = getPixel(img2, mx, my);
		expect(m.r).toBeGreaterThan(240);
		expect(m.b).toBeGreaterThan(240);
	});
});

describe("FocusZoom (render)", () => {
	it("draws content where toScreen says, zoomed", async () => {
		const target = { x: 500, y: 90, width: 40, height: 40 };
		const camera = FocusZoom({
			width: W,
			height: H,
			content: [
				Layer.box({ position: "absolute", ...target, background: "#ff0000" }),
			],
			shots: [{ at: 0, target, zoom: 2 }],
			smear: false,
			length: 90,
		});
		const settled = camera.cues.shots[0]?.settled ?? 0;
		expect(settled).toBeLessThan(60);
		const n = settled + 10;
		expect(camera.cameraAt(n).zoom).toBeCloseTo(2, 1);
		const [sx, sy] = camera.toScreen([target.x + 20, target.y + 20], n);
		const img = await frame(comp(camera, "#000000"), n);
		const hit = getPixel(img, sx, sy);
		expect(hit.r).toBeGreaterThan(240);
		// Zoomed 2×: the square is ~80 px wide on screen.
		expect(getPixel(img, sx + 34, sy).r).toBeGreaterThan(200);
		expect(getPixel(img, sx + 46, sy).r).toBeLessThan(40);
	});
});
