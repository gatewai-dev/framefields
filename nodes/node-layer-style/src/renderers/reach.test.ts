import { effectReach, registerWebGPURenderer } from "@framefields/node-sdk";
import { describe, expect, it } from "vitest";
import { layerStyleReach, WebGPURenderer } from "./webgpu-renderer.js";

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
