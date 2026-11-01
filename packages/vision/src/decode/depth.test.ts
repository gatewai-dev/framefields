import { describe, expect, it } from "vitest";
import { decodeDepth, depthInputSize } from "./depth.js";

describe("depthInputSize", () => {
	it("keeps the frame's aspect in multiples of 14 with the short side fixed", () => {
		expect(depthInputSize(1920, 1080, 518)).toEqual([924, 518]);
		expect(depthInputSize(1080, 1920, 518)).toEqual([518, 924]);
		expect(depthInputSize(512, 512, 518)).toEqual([518, 518]);
	});
});

describe("decodeDepth", () => {
	it("maps the frame's range to 0 (far) … 1 (near), ignoring a stray extreme", () => {
		const w = 100;
		const h = 100;
		const raw = Float32Array.from(
			{ length: w * h },
			(_, i) => 2 + (i % w) / (w - 1),
		);
		raw[0] = 1000; // one hot pixel
		const { data, width, height } = decodeDepth(raw, w, h);
		expect([width, height]).toEqual([w, h]);
		expect(data[0]).toBe(1);
		expect(data[1]).toBeCloseTo(0, 1);
		expect(data[w - 1]).toBeCloseTo(1, 1);
		expect(data[w + 50]).toBeCloseTo(0.5, 1);
	});

	it("gives a flat frame zero depth instead of dividing by zero", () => {
		const { data } = decodeDepth(new Float32Array(16).fill(3), 4, 4);
		expect([...data]).toEqual(new Array(16).fill(0));
	});
});
