import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { springTrack, toasts } from "./index.js";

describe("springTrack", () => {
	it("springs to each target and lands on it", () => {
		const v = springTrack(
			[
				[10, 100],
				[60, 0],
			],
			0,
			120,
			30,
		);
		expect(v[9]).toBe(0);
		expect(v[55]).toBeCloseTo(100, 0);
		expect(v[120]).toBeCloseTo(0, 0);
		// A retarget starts from where the value is, so nothing jumps.
		const mid = springTrack(
			[
				[0, 100],
				[5, 0],
			],
			0,
			20,
			30,
		);
		expect(Math.abs((mid[5] as number) - (mid[4] as number))).toBeLessThan(30);
	});
});

describe("Toasts", () => {
	it("cues arrivals and dismissals and leaves when the last one goes", () => {
		const t = bind(
			fakeHost(),
			toasts,
		)({
			items: [
				{ at: 0, title: "a" },
				{ at: 20, title: "b", duration: 30 },
			],
		});
		expect(t.cues.arrivals.map((a) => a.frame)).toEqual([0, 20]);
		expect(t.cues.dismissals.map((d) => d.frame)).toEqual([120, 50]);
		expect(t.span.duration).toBeGreaterThan(120);
	});

	it("rejects unknown kinds", () => {
		expect(() =>
			bind(
				fakeHost(),
				toasts,
			)({ items: [{ at: 0, title: "a", kind: "nope" as never }] }),
		).toThrow(/invalid props/);
	});
});
