import { describe, expect, it } from "vitest";
import { resolveGi, resolveSsr } from "./environment3d.js";
import { LIGHT_UNIFORM_SIZE_BYTES, Light3D, MAX_LIGHTS } from "./light3d.js";

/** First float of `LightsUniforms.indirect`. */
const INDIRECT = 8 + MAX_LIGHTS * 16 + 88;

describe("screen-space indirect settings", () => {
	it("resolves defaults and clamps ssr / gi settings", () => {
		expect(resolveSsr(undefined)).toBeUndefined();
		expect(resolveSsr(false)).toBeUndefined();
		expect(resolveSsr(true)).toEqual({
			intensity: 0.85,
			maxRoughness: 0.6,
			thickness: 120,
			steps: 32,
		});
		expect(
			resolveSsr({ intensity: 3, maxRoughness: -1, thickness: 0, steps: 200 }),
		).toEqual({ intensity: 1, maxRoughness: 0, thickness: 1, steps: 64 });
		expect(resolveGi(true)).toEqual({ intensity: 1, radius: 400, samples: 6 });
		expect(resolveGi({ intensity: 9, radius: -5, samples: 2.6 })).toEqual({
			intensity: 4,
			radius: 1,
			samples: 4,
		});
	});

	it("packs the pass mode and strengths after the SH block", () => {
		expect(INDIRECT * 4 + 16).toBe(LIGHT_UNIFORM_SIZE_BYTES);
		const env = { ssr: { intensity: 0.5, maxRoughness: 0.3 }, gi: true };
		const at = (b: Float32Array) =>
			Array.from(b.subarray(INDIRECT, INDIRECT + 4));
		const pack = (pass?: "radiance" | "apply", reflection = false) =>
			at(
				Light3D.packLightsUniforms([], env, null, reflection, undefined, pass),
			);
		expect(pack()).toEqual([0, -1, -1, 0]);
		expect(pack("radiance")[0]).toBe(1);
		expect(pack("apply").map((v) => +v.toFixed(3))).toEqual([2, 0.5, 1, 0.3]);
		// The planar floor reflection never reads traced light.
		expect(pack("apply", true)).toEqual([0, -1, -1, 0]);
		// Without gi, its strength reads as off.
		const ssrOnly = Light3D.packLightsUniforms(
			[],
			{ ssr: true },
			null,
			false,
			undefined,
			"apply",
		);
		expect(at(ssrOnly)[2]).toBe(-1);
	});
});
