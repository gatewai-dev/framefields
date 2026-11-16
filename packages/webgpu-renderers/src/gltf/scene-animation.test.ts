import { describe, expect, it } from "vitest";
import type { NodeRef } from "./document.js";
import {
	decompose,
	NodeMotion,
	reduceKeys,
	visibilityChannel,
} from "./scene-animation.js";

const node = { node: 0 } as NodeRef;
const TOL = { translation: 1e-4, rotation: 1e-4, scale: 1e-4 };

/** T · Ry(angle) · S, column-major. */
function trs(t: number[], angle: number, s: number[]): number[] {
	const c = Math.cos(angle);
	const n = Math.sin(angle);
	return [
		c * s[0],
		0,
		-n * s[0],
		0,
		0,
		s[1],
		0,
		0,
		n * s[2],
		0,
		c * s[2],
		0,
		t[0],
		t[1],
		t[2],
		1,
	];
}

const times = (n: number) => Float32Array.from({ length: n }, (_, i) => i / 30);

describe("decompose", () => {
	it("splits a matrix into translation, rotation and scale", () => {
		const d = decompose(trs([1, 2, 3], Math.PI / 3, [2, 0.5, 1]));
		expect(d.translation).toEqual([1, 2, 3]);
		expect(d.scale.map((v) => Number(v.toFixed(6)))).toEqual([2, 0.5, 1]);
		// About y by 60°: (0, sin 30°, 0, cos 30°).
		expect(d.rotation[1]).toBeCloseTo(0.5, 6);
		expect(d.rotation[3]).toBeCloseTo(Math.sqrt(3) / 2, 6);
		expect(d.shear).toBeLessThan(1e-9);
	});

	it("keeps a mirror as a negative x scale", () => {
		const d = decompose(trs([0, 0, 0], 0, [-1, 1, 1]));
		expect(d.scale[0]).toBeCloseTo(-1, 9);
		expect(d.rotation.map((v) => v + 0)).toEqual([0, 0, 0, 1]);
	});
});

describe("reduceKeys", () => {
	it("keeps the ends of a straight move and the corners of a bent one", () => {
		const n = 60;
		const straight = Float32Array.from({ length: n * 3 }, (_, i) =>
			i % 3 === 0 ? i / 3 : 0,
		);
		expect(
			reduceKeys("translation", times(n), straight, 1e-4).times.length,
		).toBe(2);
		// Out and back: the turn is kept.
		const bent = Float32Array.from({ length: n * 3 }, (_, i) => {
			const f = Math.floor(i / 3);
			return i % 3 === 0 ? (f < 30 ? f : 60 - f) : 0;
		});
		const kept = reduceKeys("translation", times(n), bent, 1e-4).times;
		expect(Array.from(kept)).toEqual([0, 30 / 30, 59 / 30].map(Math.fround));
	});

	it("keeps an even turn as its ends: glTF slerps between rotation keys", () => {
		const n = 90;
		const motion = new NodeMotion(
			Array.from({ length: n }, (_, f) =>
				trs([0, 0, 0], (f / (n - 1)) * Math.PI * 0.9, [1, 1, 1]),
			),
			false,
		);
		const [rotation] = motion.channels(node, times(n), TOL);
		expect(rotation.path).toBe("rotation");
		expect(rotation.times.length).toBe(2);
	});
});

describe("NodeMotion", () => {
	it("writes no channel for a node that holds still", () => {
		const m = trs([5, 0, 0], 0.3, [1, 2, 1]);
		const motion = new NodeMotion([m, m, m], false);
		expect(motion.still(TOL)).toBe(true);
		expect(motion.channels(node, times(3), TOL)).toEqual([]);
	});

	it("turns the short way across the quaternion double cover", () => {
		// 170° then 190° about y: the second decomposes to the far hemisphere.
		const a = trs([0, 0, 0], (170 * Math.PI) / 180, [1, 1, 1]);
		const b = trs([0, 0, 0], (190 * Math.PI) / 180, [1, 1, 1]);
		const [rotation] = new NodeMotion([a, b], false).channels(
			node,
			times(2),
			TOL,
		);
		const v = rotation.values as Float32Array;
		const dot = v[0] * v[4] + v[1] * v[5] + v[2] * v[6] + v[3] * v[7];
		expect(dot).toBeGreaterThan(0);
	});

	it("holds an absent node's pose at scale 0, or at its own scale for children to hide", () => {
		const a = trs([1, 0, 0], 0, [1, 1, 1]);
		const b = trs([3, 0, 0], 0, [1, 1, 1]);
		const hidden = new NodeMotion([null, a, b], true);
		const channels = hidden.channels(node, times(3), TOL);
		const scale = channels.find((c) => c.path === "scale");
		expect(Array.from(scale?.values as Float32Array)).toEqual([
			0, 0, 0, 1, 1, 1, 1, 1, 1,
		]);
		// The absent frame holds the first drawn position: no fly-in.
		const t = channels.find((c) => c.path === "translation")
			?.values as Float32Array;
		expect([t[0], t[3], t[6]]).toEqual([1, 1, 3]);
		expect(new NodeMotion([null, a, a], false).still(TOL)).toBe(true);
	});
});

describe("visibilityChannel", () => {
	it("steps, keyed half a frame before the node shows or hides", () => {
		const c = visibilityChannel(node, times(5), [
			false,
			false,
			true,
			true,
			false,
		]);
		expect(c.interpolation).toBe("step");
		const keys = Array.from(c.times);
		expect(keys).toHaveLength(3);
		[0, 1.5 / 30, 3.5 / 30].forEach((t, i) => {
			expect(keys[i]).toBeCloseTo(t, 6);
		});
		expect(Array.from(c.values)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
	});
});
