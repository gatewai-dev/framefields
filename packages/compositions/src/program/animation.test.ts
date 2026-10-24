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

describe("LayerAnimation.keys", () => {
	it("adds a keyframe per tuple, rounding frames and parsing eases", () => {
		const anim = LayerAnimation.keys("scale", [
			[0, 0],
			[11.6, 1.1, "back.out"],
			[20, 1],
		]);
		expect(anim.tracks).toHaveLength(1);
		const [a, b, c] = anim.tracks[0]!.keyframes;
		expect([a!.frame, b!.frame, c!.frame]).toEqual([0, 12, 20]);
		expect(b!.value).toBe(1.1);
		expect(b!.ease).toEqual({ name: "back", dir: "out" });
		expect(a!.ease).toBeUndefined();
		expect(evaluateAnimationAtFrame(anim, 20).scale).toBe(1);
	});

	it("chains onto an existing animation and its track for the same prop", () => {
		const anim = LayerAnimation.create()
			.keyframe("opacity", 0, 0)
			.keys("opacity", [[10, 1]])
			.keys("y", [
				[0, 40],
				[10, 0],
			]);
		expect(anim.tracks.map((t) => t.prop)).toEqual(["opacity", "y"]);
		expect(anim.tracks[0]!.keyframes.map((k) => k.frame)).toEqual([0, 10]);
	});
});

describe("LayerAnimation track merging", () => {
	it("replaces a key on an occupied frame instead of duplicating it", () => {
		const anim = LayerAnimation.create().keys("y", [
			[0, 0],
			[10, 5],
			[10, 8],
		]);
		expect(anim.tracks[0].keyframes.map((k) => [k.frame, k.value])).toEqual([
			[0, 0],
			[10, 8],
		]);
	});

	it("merges behaviours authored separately into one sorted track per prop", () => {
		const enter = LayerAnimation.keys("y", [
			[0, -300],
			[20, 0],
		]);
		const press = LayerAnimation.keys("y", [
			[40, 0],
			[42, 6],
			[48, 0],
		]).keys("opacity", [[0, 1]]);
		const wave = LayerAnimation.create()
			.keys("y", [
				[48, 2],
				[60, -18],
			])
			.wiggle("x", { amplitude: 4 });
		const merged = LayerAnimation.merge(enter, press, wave);
		const y = merged.tracks.filter((t) => t.prop === "y");
		expect(y).toHaveLength(1);
		expect(y[0].keyframes.map((k) => [k.frame, k.value])).toEqual([
			[0, -300],
			[20, 0],
			[40, 0],
			[42, 6],
			[48, 2],
			[60, -18],
		]);
		expect(merged.tracks.map((t) => t.prop).sort()).toEqual([
			"opacity",
			"x",
			"y",
		]);
		// Inputs are left untouched.
		expect(enter.tracks[0].keyframes).toHaveLength(2);
	});
});

describe("LayerAnimation repeat & yoyo (looping)", () => {
	it("repeats keyframes for a finite number of iterations", () => {
		const anim = LayerAnimation.create().fromTo("opacity", 0, 1, {
			start: 0,
			end: 10,
			repeat: 1, // 1 repeat after initial cycle = 2 total cycles (0..10 and 10..20)
		});

		expect(anim.tracks[0].repeat).toBe(1);

		// Cycle 0: 0 -> 1
		expect(evaluateAnimationAtFrame(anim, 0).opacity).toBe(0);
		expect(evaluateAnimationAtFrame(anim, 5).opacity).toBe(0.5);
		expect(evaluateAnimationAtFrame(anim, 10).opacity).toBe(0); // starts cycle 1

		// Cycle 1: 0 -> 1
		expect(evaluateAnimationAtFrame(anim, 15).opacity).toBe(0.5);

		// Completed: rests at final value (1)
		expect(evaluateAnimationAtFrame(anim, 20).opacity).toBe(1);
		expect(evaluateAnimationAtFrame(anim, 50).opacity).toBe(1);
	});

	it("yoyos back and forth for finite repeats", () => {
		const anim = LayerAnimation.create().fromTo("y", 0, 100, {
			start: 0,
			end: 10,
			repeat: 1, // cycle 0 (forward), cycle 1 (reverse) -> rests at 0
			yoyo: true,
		});

		expect(anim.tracks[0].yoyo).toBe(true);

		// Cycle 0 (forward): 0 -> 100
		expect(evaluateAnimationAtFrame(anim, 0).y).toBe(0);
		expect(evaluateAnimationAtFrame(anim, 5).y).toBe(50);
		expect(evaluateAnimationAtFrame(anim, 10).y).toBe(100);

		// Cycle 1 (reverse): 100 -> 0
		expect(evaluateAnimationAtFrame(anim, 15).y).toBe(50);

		// Completed: rests at 0 because repeat was odd (cycle 1 was in reverse)
		expect(evaluateAnimationAtFrame(anim, 20).y).toBe(0);
		expect(evaluateAnimationAtFrame(anim, 30).y).toBe(0);
	});

	it("rests at end value when finite yoyo repeat is even", () => {
		const anim = LayerAnimation.create().fromTo("scale", 1, 2, {
			start: 0,
			end: 10,
			repeat: 2, // cycle 0 (fwd), cycle 1 (rev), cycle 2 (fwd) -> rests at 2
			yoyo: true,
		});

		// Cycle 2 (forward) ends at frame 30
		expect(evaluateAnimationAtFrame(anim, 25).scale).toBe(1.5);
		expect(evaluateAnimationAtFrame(anim, 30).scale).toBe(2);
		expect(evaluateAnimationAtFrame(anim, 50).scale).toBe(2);
	});

	it("loops infinitely with repeat: -1 and .loop({ yoyo: true })", () => {
		const anim = LayerAnimation.create()
			.fromTo("x", 0, 100, { start: 0, end: 10 })
			.loop({ yoyo: true });

		expect(anim.tracks[0].repeat).toBe(-1);
		expect(anim.tracks[0].yoyo).toBe(true);

		// Cycle 0 (0..10): forward
		expect(evaluateAnimationAtFrame(anim, 0).x).toBe(0);
		expect(evaluateAnimationAtFrame(anim, 5).x).toBe(50);
		expect(evaluateAnimationAtFrame(anim, 10).x).toBe(100);

		// Cycle 1 (10..20): reverse
		expect(evaluateAnimationAtFrame(anim, 15).x).toBe(50);
		expect(evaluateAnimationAtFrame(anim, 20).x).toBe(0);

		// Cycle 2 (20..30): forward
		expect(evaluateAnimationAtFrame(anim, 25).x).toBe(50);
		expect(evaluateAnimationAtFrame(anim, 30).x).toBe(100);

		// Far into the future (frame 105: cycle 10 forward at 50%)
		expect(evaluateAnimationAtFrame(anim, 105).x).toBe(50);
		// Frame 115: cycle 11 reverse at 50%
		expect(evaluateAnimationAtFrame(anim, 115).x).toBe(50);
	});

	it("applies repeat and yoyo via fluent methods before or after track addition", () => {
		// Before tracks
		const animBefore = LayerAnimation.create()
			.repeat(-1)
			.yoyo(true)
			.fromTo("opacity", 0, 1, { start: 0, end: 10 });
		expect(animBefore.tracks[0].repeat).toBe(-1);
		expect(animBefore.tracks[0].yoyo).toBe(true);

		// Prop-targeted repeat
		const animProp = LayerAnimation.create()
			.fromTo("opacity", 0, 1, { start: 0, end: 10 })
			.fromTo("scale", 1, 2, { start: 0, end: 10 })
			.repeat(3, "opacity");
		expect(animProp.tracks[0].repeat).toBe(3);
		expect(animProp.tracks[1].repeat).toBeUndefined();
	});

	it("supports repeat and yoyo in LayerAnimation.keys()", () => {
		const anim = LayerAnimation.keys(
			"y",
			[
				[0, 10],
				[10, 50],
			],
			{ repeat: -1, yoyo: true },
		);

		expect(anim.tracks[0].repeat).toBe(-1);
		expect(anim.tracks[0].yoyo).toBe(true);

		expect(evaluateAnimationAtFrame(anim, 5).y).toBe(30);
		expect(evaluateAnimationAtFrame(anim, 15).y).toBe(30);
	});

	it("respects delayed startFrame with repeat and yoyo", () => {
		const anim = LayerAnimation.create().fromTo("x", 100, 200, {
			start: 20,
			end: 40,
			repeat: -1,
			yoyo: true,
		});

		// Before startFrame (frame 0..20 holds fromValue)
		expect(evaluateAnimationAtFrame(anim, 0).x).toBe(100);
		expect(evaluateAnimationAtFrame(anim, 10).x).toBe(100);
		expect(evaluateAnimationAtFrame(anim, 20).x).toBe(100);

		// Cycle 0 (20..40): forward
		expect(evaluateAnimationAtFrame(anim, 30).x).toBe(150);
		expect(evaluateAnimationAtFrame(anim, 40).x).toBe(200);

		// Cycle 1 (40..60): reverse
		expect(evaluateAnimationAtFrame(anim, 50).x).toBe(150);
		expect(evaluateAnimationAtFrame(anim, 60).x).toBe(100);
	});

	it("handles multi-keyframe tracks during reverse yoyo playback", () => {
		const anim = LayerAnimation.keys(
			"blur",
			[
				[0, 0],
				[10, 50],
				[20, 100],
			],
			{ repeat: 1, yoyo: true },
		);

		// Cycle 0: forward
		expect(evaluateAnimationAtFrame(anim, 5).blur).toBe(25);
		expect(evaluateAnimationAtFrame(anim, 10).blur).toBe(50);
		expect(evaluateAnimationAtFrame(anim, 15).blur).toBe(75);
		expect(evaluateAnimationAtFrame(anim, 20).blur).toBe(100);

		// Cycle 1: reverse (duration 20 frames, from 20 to 40)
		// At frame 25: 5 frames in reverse -> maps to frame 15 (75)
		expect(evaluateAnimationAtFrame(anim, 25).blur).toBe(75);
		// At frame 30: 10 frames in reverse -> maps to frame 10 (50)
		expect(evaluateAnimationAtFrame(anim, 30).blur).toBe(50);
		// At frame 35: 15 frames in reverse -> maps to frame 5 (25)
		expect(evaluateAnimationAtFrame(anim, 35).blur).toBe(25);
		// At frame 40: completed -> rests at 0
		expect(evaluateAnimationAtFrame(anim, 40).blur).toBe(0);
	});

	it("supports custom cycle durationFrames with holding period", () => {
		const anim = LayerAnimation.keys(
			"scale",
			[
				[0, 1],
				[10, 2],
			],
			{ durationFrames: 15, repeat: -1 }, // active 0..10, holds 10..15, then repeats
		);

		// Forward transition
		expect(evaluateAnimationAtFrame(anim, 0).scale).toBe(1);
		expect(evaluateAnimationAtFrame(anim, 5).scale).toBe(1.5);
		expect(evaluateAnimationAtFrame(anim, 10).scale).toBe(2);

		// Holding period (10..15)
		expect(evaluateAnimationAtFrame(anim, 12).scale).toBe(2);
		expect(evaluateAnimationAtFrame(anim, 14).scale).toBe(2);

		// Next cycle starts at frame 15
		expect(evaluateAnimationAtFrame(anim, 15).scale).toBe(1);
		expect(evaluateAnimationAtFrame(anim, 20).scale).toBe(1.5);
	});
});

describe("LayerAnimation scaleX & scaleY (single-axis stretching)", () => {
	it("animates scaleX and scaleY via fluent methods and fromTo", () => {
		const anim = LayerAnimation.create()
			.scaleX(1, 3, { start: 0, end: 10 })
			.scaleY(1, 0.5, { start: 0, end: 10 });

		expect(anim.tracks).toHaveLength(2);
		expect(anim.tracks[0].prop).toBe("scaleX");
		expect(anim.tracks[1].prop).toBe("scaleY");

		const f0 = evaluateAnimationAtFrame(anim, 0);
		expect(f0.scaleX).toBe(1);
		expect(f0.scaleY).toBe(1);

		const f5 = evaluateAnimationAtFrame(anim, 5);
		expect(f5.scaleX).toBe(2);
		expect(f5.scaleY).toBe(0.75);

		const f10 = evaluateAnimationAtFrame(anim, 10);
		expect(f10.scaleX).toBe(3);
		expect(f10.scaleY).toBe(0.5);
	});

	it("supports static LayerAnimation.scaleX and LayerAnimation.scaleY factories", () => {
		const animX = LayerAnimation.scaleX(0.2, 1.8, { start: 5, end: 15 });
		expect(animX.tracks[0].prop).toBe("scaleX");
		expect(evaluateAnimationAtFrame(animX, 5).scaleX).toBe(0.2);
		expect(evaluateAnimationAtFrame(animX, 15).scaleX).toBe(1.8);

		const animY = LayerAnimation.scaleY(0, 2.5, { start: 0, end: 20 });
		expect(animY.tracks[0].prop).toBe("scaleY");
		expect(evaluateAnimationAtFrame(animY, 10).scaleY).toBe(1.25);
	});

	it("supports loop and yoyo on single-axis scale tracks (e.g. audio bar equalizer bounce)", () => {
		const anim = LayerAnimation.create()
			.scaleY(0.1, 1.0, { start: 0, end: 6 })
			.loop({ yoyo: true });

		expect(anim.tracks[0].repeat).toBe(-1);
		expect(anim.tracks[0].yoyo).toBe(true);

		// Cycle 0 forward: 0.1 -> 1.0
		expect(evaluateAnimationAtFrame(anim, 0).scaleY).toBe(0.1);
		expect(evaluateAnimationAtFrame(anim, 6).scaleY).toBe(1.0);

		// Cycle 1 reverse: 1.0 -> 0.1
		expect(evaluateAnimationAtFrame(anim, 12).scaleY).toBe(0.1);
	});
});
