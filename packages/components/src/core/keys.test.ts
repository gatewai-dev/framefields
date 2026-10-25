import { describe, expect, it } from "vitest";
import {
	ascending,
	KeyBook,
	last,
	round,
	supersede,
	Track,
	valueAt,
} from "./keys.js";

describe("keys", () => {
	it("ascending sorts and lets the last key on a frame win", () => {
		expect(
			ascending([
				[10, 1],
				[0, 0],
				[10, 2, "power2.out"],
				[5, 3],
			]),
		).toEqual([
			[0, 0],
			[5, 3],
			[10, 2, "power2.out"],
		]);
	});

	it("supersede drops planned keys a retarget lands before", () => {
		expect(
			supersede([
				[0, 0],
				[20, 10],
				[30, 10],
				[12, 4],
				[25, 0],
			]),
		).toEqual([
			[0, 0],
			[12, 4],
			[25, 0],
		]);
	});

	it("valueAt follows eases and holds like the renderer", () => {
		const keys = [
			[0, 0],
			[10, 10],
			[20, 0, "hold"],
		] as const;
		expect(valueAt(keys, -5)).toBe(0);
		expect(valueAt(keys, 5)).toBe(5);
		expect(valueAt(keys, 15)).toBe(10);
		expect(valueAt(keys, 20)).toBe(0);
		expect(valueAt(keys, 99)).toBe(0);
		expect(
			valueAt(
				[
					[0, 0],
					[10, 1, "power2.in"],
				],
				5,
			),
		).toBeLessThan(0.5);
		expect(valueAt([], 3)).toBe(0);
	});

	it("round and last", () => {
		expect(round(1.23456)).toBe(1.235);
		expect(round(1.23456, 1)).toBe(1.2);
		expect(last([1, 2, 3])).toBe(3);
		expect(last([])).toBeUndefined();
	});

	it("Track eases between changes and steps on set()", () => {
		expect(new Track(0).to(10, 20, 1).set(30, 0).keys()).toEqual([
			[0, 0],
			[10, 0],
			[20, 1, "power2.out"],
			[30, 0, "hold"],
		]);
	});

	it("KeyBook merges keys per node and prop and animates once", () => {
		const calls: unknown[] = [];
		const node = { animate: (a: unknown) => calls.push(a) };
		new KeyBook<typeof node>()
			.key(node, "y", [[10, 5]])
			.key(node, "opacity", [[0, 0]])
			.key(node, "y", [[0, 0]])
			.apply();
		expect(calls).toHaveLength(1);
		const tracks = (
			calls[0] as {
				tracks: Array<{ prop: string; keyframes: Array<{ frame: number }> }>;
			}
		).tracks;
		const y = tracks.find((t) => t.prop === "y");
		expect(y?.keyframes.map((k) => k.frame)).toEqual([0, 10]);
		expect(tracks.map((t) => t.prop).sort()).toEqual(["opacity", "y"]);
	});
});
