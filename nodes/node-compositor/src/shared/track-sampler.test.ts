/**
 * The shared track sampler (what physics follows a layer with) must agree
 * with the compiled GSAP timeline (what the compositor draws) frame for
 * frame, eases, layer offsets and stepped timing included.
 */
import {
	type AnimatedLayer,
	sampleLayerProp,
} from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { compileTimeline, seekTimeline } from "./compiler.js";

const FPS = 30;

function layer(extra: Partial<AnimatedLayer>): AnimatedLayer {
	return {
		id: "mover",
		x: 10,
		rotateZ: 0,
		startFrame: 6,
		durationFrames: 90,
		animation: {
			tracks: [
				{
					id: "tx",
					prop: "x",
					keyframes: [
						{ id: "a", frame: 0, value: 0 },
						{
							id: "b",
							frame: 20,
							value: 300,
							ease: { name: "power3", dir: "inOut" },
						},
						{
							id: "c",
							frame: 45,
							value: 120,
							ease: { name: "back", dir: "out" },
						},
						{
							id: "d",
							frame: 60,
							value: 500,
							ease: { name: "cubic", dir: "out", params: [0.2, 0.8, 0.3, 1] },
						},
					],
				},
				{
					id: "rz",
					prop: "rotateZ",
					keyframes: [
						{ id: "a", frame: 5, value: 0 },
						{
							id: "b",
							frame: 50,
							value: 270,
							ease: { name: "elastic", dir: "out" },
						},
					],
				},
			],
		},
		...extra,
	} as AnimatedLayer;
}

function compare(l: AnimatedLayer) {
	const vm = {
		operation: { op: "Compositor", width: 800, height: 600 },
		children: [{ operation: { op: "CompositorLayer", ...l } }],
	};
	const compiled = compileTimeline(`sampler-${Math.random()}`, vm as never, {
		fps: FPS,
		durationSec: 4,
	});
	const stub = compiled.targetsById.mover as unknown as Record<string, number>;
	for (let f = 0; f <= 100; f += 3) {
		seekTimeline(compiled, f, FPS);
		for (const prop of ["x", "rotateZ"]) {
			expect(sampleLayerProp(l, prop, f, FPS)).toBeCloseTo(stub[prop]!, 3);
		}
	}
}

describe("sampleLayerProp", () => {
	it("matches the GSAP timeline for eased keys at a layer offset", () => {
		compare(layer({}));
	});

	it("matches stepped timing", () => {
		const l = layer({});
		compare({ ...l, animation: { ...l.animation, frameStep: 4 } });
	});
});
