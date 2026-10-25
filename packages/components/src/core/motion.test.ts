import { describe, expect, it } from "vitest";
import { enterAnimation, exitAnimation, resolveMotion } from "./motion.js";
import { themes } from "./theme.js";

const keysOf = (
	anim: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{ frame: number; value: unknown }>;
		}>;
	},
	prop: string,
) =>
	anim.tracks
		.find((t) => t.prop === prop)
		?.keyframes.map((k) => [k.frame, k.value]);

describe("motion presets", () => {
	it("resolves defaults from the theme and fps", () => {
		const m = resolveMotion("rise", "enter", themes.graphite, 60);
		expect(m).toMatchObject({
			preset: "rise",
			duration: 32,
			ease: "expo.out",
			distance: 40,
		});
		expect(resolveMotion("pop", "enter", themes.graphite)?.ease).toBe(
			themes.graphite.motion.ease.snap,
		);
		expect(resolveMotion(false, "enter", themes.graphite)).toBeNull();
		expect(resolveMotion("none", "enter", themes.graphite)).toBeNull();
		expect(() =>
			resolveMotion("spin" as never, "enter", themes.graphite),
		).toThrow(/Unknown motion preset/);
	});

	it("blurs slides by default, and anything on request", () => {
		const g = themes.graphite;
		expect(resolveMotion("slide-left", "enter", g)?.blur).toBe(90);
		expect(resolveMotion("rise", "enter", g)?.blur).toBe(0);
		expect(resolveMotion({ preset: "rise", blur: 45 }, "enter", g)?.blur).toBe(
			45,
		);
		expect(
			resolveMotion({ preset: "slide-up", blur: false }, "enter", g)?.blur,
		).toBe(0);
	});

	it("enters from an offset and settles at zero", () => {
		const m = resolveMotion(
			{ preset: "rise", duration: 10, delay: 2 },
			"enter",
			themes.graphite,
		)!;
		const anim = enterAnimation(m);
		expect(keysOf(anim, "y")).toEqual([
			[2, 40],
			[12, 0],
		]);
		expect(keysOf(anim, "opacity")).toEqual([
			[2, 0],
			[12, 1],
		]);
	});

	it("exits the way it would have entered", () => {
		const m = resolveMotion(
			{ preset: "rise", duration: 10 },
			"exit",
			themes.graphite,
		)!;
		const anim = exitAnimation(m, 100);
		expect(keysOf(anim, "y")).toEqual([
			[90, 0],
			[100, -40],
		]);
		const slide = resolveMotion(
			{ preset: "slide-left", duration: 10 },
			"exit",
			themes.graphite,
		)!;
		expect(keysOf(exitAnimation(slide, 50), "x")).toEqual([
			[40, 0],
			[50, -120],
		]);
	});
});
