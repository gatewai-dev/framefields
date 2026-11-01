import {
	effectMaxPixelScale,
	effectReach,
	registerWebGPURenderer,
} from "@framefields/node-sdk";
import { describe, expect, it } from "vitest";
import {
	layerStyleMaxPixelScale,
	layerStyleReach,
	WebGPURenderer,
} from "./webgpu-renderer.js";

const signal = <T>(value: T) => ({ _value: value, _subscribers: {} });

describe("LayerStyle reach", () => {
	it("covers the shadow's offset plus its blur, capped like the shader", () => {
		expect(
			layerStyleReach({
				op: "LayerStyle",
				dropShadow: { enabled: true, distance: 10, size: 20 },
			}),
		).toBe(10 + 20 + 2);
		// The shader's kernels stop at 24 px.
		expect(
			layerStyleReach({
				op: "LayerStyle",
				dropShadow: { enabled: true, distance: 0, size: 80 },
			}),
		).toBe(24 + 2);
	});

	it("takes the farthest of shadow, glow and an outside stroke; inside strokes don't reach", () => {
		expect(
			layerStyleReach({
				op: "LayerStyle",
				dropShadow: signal({ enabled: true, distance: 2, size: 4 }),
				outerGlow: signal({ enabled: true, size: 16 }),
				stroke: signal({ enabled: true, size: 30, position: "inside" }),
			}),
		).toBe(16 + 2);
	});

	it("is unknown when a size is driven by a connected signal", () => {
		expect(
			layerStyleReach({
				op: "LayerStyle",
				dropShadow: { enabled: true, distance: 4, size: 4 },
				dropShadowDistanceHandleId: "h1",
				inputs: { h1: { connectionValid: true } },
			}),
		).toBeNull();
	});
});

describe("effectReach", () => {
	it("asks the registered renderer, and is unknown without one", () => {
		registerWebGPURenderer("LayerStyle", WebGPURenderer);
		expect(
			effectReach({
				op: "LayerStyle",
				dropShadow: { enabled: true, distance: 6, size: 6 },
			}),
		).toBe(14);
		expect(effectReach({ op: "SomeMirror" })).toBeNull();
		registerWebGPURenderer("NoReach", async () => {});
		expect(effectReach({ op: "NoReach" })).toBeNull();
	});
});

describe("LayerStyle maxPixelScale", () => {
	it("is unlimited when no style samples a kernel", () => {
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				colorOverlay: { enabled: true, color: "#ff0000" },
				bevelEmboss: { enabled: true, size: 40 },
				dropShadow: { enabled: false, size: 200 },
			}),
		).toBe(Number.POSITIVE_INFINITY);
	});

	it("stops where a scaled kernel would pass the shader's cap", () => {
		// Outer kernels stop at 24 px, inner ones at 16.
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				dropShadow: { enabled: true, distance: 40, size: 8 },
			}),
		).toBe(3);
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				dropShadow: signal({ enabled: true, size: 4 }),
				innerShadow: { enabled: true, size: 8 },
			}),
		).toBe(2);
		// A centred stroke reaches half its size each way.
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				stroke: { enabled: true, size: 12, position: "center" },
			}),
		).toBe(4);
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				stroke: { enabled: true, size: 12, position: "outside" },
			}),
		).toBe(2);
	});

	it("measures a style that leaves its size out at the renderer's default", () => {
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				outerGlow: { enabled: true },
			}),
		).toBe(24 / 15);
	});

	it("is 1 when a size is driven by a connected signal", () => {
		expect(
			layerStyleMaxPixelScale({
				op: "LayerStyle",
				innerGlow: { enabled: true, size: 2 },
				innerGlowSizeHandleId: "h1",
				inputs: { h1: { connectionValid: true } },
			}),
		).toBe(1);
	});
});

describe("effectMaxPixelScale", () => {
	it("asks the registered renderer, and is 1 without an answer", () => {
		registerWebGPURenderer("LayerStyle", WebGPURenderer);
		expect(
			effectMaxPixelScale({
				op: "LayerStyle",
				dropShadow: { enabled: true, size: 6 },
			}),
		).toBe(4);
		expect(effectMaxPixelScale({ op: "SomeMirror" })).toBe(1);
		registerWebGPURenderer("NoScale", async () => {});
		expect(effectMaxPixelScale({ op: "NoScale" })).toBe(1);
	});
});
