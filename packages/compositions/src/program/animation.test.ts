import { describe, expect, it } from "vitest";
import { LayerAnimation } from "./animation.js";
import { evaluateAnimationAtFrame } from "./evaluator.js";

describe("LayerAnimation builder & keyframe anchoring", () => {
	it("holds fromValue from frame 0 when animation has delayed start", () => {
		const anim = LayerAnimation.create().fadeIn(4, 14);

		expect(anim.tracks).toHaveLength(1);
		const track = anim.tracks[0]!;
		expect(track.prop).toBe("opacity");
		expect(track.keyframes).toEqual([
			expect.objectContaining({ frame: 0, value: 0 }),
			expect.objectContaining({ frame: 4, value: 0 }),
			expect.objectContaining({ frame: 14, value: 1 }),
		]);

		// Evaluator holds 0 from frame 0 to 4
		const frame0 = evaluateAnimationAtFrame(anim, 0, 30);
		expect(frame0.opacity).toBe(0);

		const frame2 = evaluateAnimationAtFrame(anim, 2, 30);
		expect(frame2.opacity).toBe(0);

		const frame4 = evaluateAnimationAtFrame(anim, 4, 30);
		expect(frame4.opacity).toBe(0);

		const frame14 = evaluateAnimationAtFrame(anim, 14, 30);
		expect(frame14.opacity).toBe(1);
	});

	it("merges chained fadeIn and fadeOut into a single cohesive opacity track", () => {
		const anim = LayerAnimation.create().fadeIn(4, 14).fadeOut(52, 60);

		expect(anim.tracks).toHaveLength(1);
		const track = anim.tracks[0]!;
		expect(track.prop).toBe("opacity");
		expect(track.keyframes.map((k) => ({ f: k.frame, v: k.value }))).toEqual([
			{ f: 0, v: 0 },
			{ f: 4, v: 0 },
			{ f: 14, v: 1 },
			{ f: 52, v: 1 },
			{ f: 60, v: 0 },
		]);

		// Frame 0..4: invisible
		expect(evaluateAnimationAtFrame(anim, 0, 30).opacity).toBe(0);
		expect(evaluateAnimationAtFrame(anim, 2, 30).opacity).toBe(0);

		// Frame 14..52: fully visible
		expect(evaluateAnimationAtFrame(anim, 14, 30).opacity).toBe(1);
		expect(evaluateAnimationAtFrame(anim, 30, 30).opacity).toBe(1);
		expect(evaluateAnimationAtFrame(anim, 52, 30).opacity).toBe(1);

		// Frame 60: faded out
		expect(evaluateAnimationAtFrame(anim, 60, 30).opacity).toBe(0);
	});

	it("holds initial position and scale from frame 0 for slide and scale animations", () => {
		const anim = LayerAnimation.create()
			.slideInY(198, 182, 4, 14)
			.fromTo("scale", 0.05, 1.0, { from: 4, to: 18 });

		expect(anim.tracks).toHaveLength(2);

		// Frame 0..4 holds initial transform values
		const f0 = evaluateAnimationAtFrame(anim, 0, 30);
		expect(f0.y).toBe(198);
		expect(f0.scale).toBe(0.05);

		const f4 = evaluateAnimationAtFrame(anim, 4, 30);
		expect(f4.y).toBe(198);
		expect(f4.scale).toBe(0.05);

		// Frame 14 (y completed)
		const f14 = evaluateAnimationAtFrame(anim, 14, 30);
		expect(f14.y).toBe(182);

		// Frame 18 (scale completed)
		const f18 = evaluateAnimationAtFrame(anim, 18, 30);
		expect(f18.scale).toBe(1.0);
	});

	it("builds 3D perspective transforms with rotateX, rotateY, translateZ and tilt3D", () => {
		const anim = LayerAnimation.create()
			.rotateX(0, 25, { fromFrame: 10, toFrame: 30 })
			.rotateY(0, -15, { fromFrame: 10, toFrame: 30 })
			.translateZ(-100, 50, { fromFrame: 10, toFrame: 30 })
			.perspective(0, 1000, { fromFrame: 0, toFrame: 10 });

		expect(anim.tracks).toHaveLength(4);

		// Frame 0..10 holds initial values
		const f0 = evaluateAnimationAtFrame(anim, 0, 30);
		expect(f0.rotateX).toBe(0);
		expect(f0.rotateY).toBe(0);
		expect(f0.translateZ).toBe(-100);

		// Compound tilt3D helper
		const compoundAnim = LayerAnimation.create().tilt3D({
			from: { rotateX: 0, rotateY: 0, translateZ: -200, perspective: 800 },
			to: { rotateX: 20, rotateY: -25, translateZ: 0, perspective: 1200 },
			fromFrame: 5,
			toFrame: 25,
			ease: "power2.out",
		});

		expect(compoundAnim.tracks).toHaveLength(4);
		const trackProps = compoundAnim.tracks.map((t) => t.prop).sort();
		expect(trackProps).toEqual([
			"perspective",
			"rotateX",
			"rotateY",
			"translateZ",
		]);

		const cf0 = evaluateAnimationAtFrame(compoundAnim, 0, 30);
		expect(cf0.rotateX).toBe(0);
		expect(cf0.rotateY).toBe(0);
		expect(cf0.translateZ).toBe(-200);
		expect(cf0.perspective).toBe(800);

		const cf25 = evaluateAnimationAtFrame(compoundAnim, 25, 30);
		expect(cf25.rotateX).toBe(20);
		expect(cf25.rotateY).toBe(-25);
		expect(cf25.translateZ).toBe(0);
		expect(cf25.perspective).toBe(1200);
	});
});
