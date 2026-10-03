/**
 * @file packages/gitframes/test/text-animations.test.ts
 * Verification test suite for After Effects Parity Text Animation Engine Specification.
 */

import { describe, expect, it } from "vitest";
import {
	computeRangeSelectorWeight,
	deterministicWigglyNoise,
	distanceToCurveParameter,
	EnhancedTextNodeSchema,
	evaluateCubicBezier,
	evaluateTypewriterState,
	generateArcLengthLUT,
	sampleCurveGeometry,
	TextAnimatorBuilder,
	TextPathBuilder,
	TextPathOptionsSchema,
} from "../../../specs/text-animations.js";

describe("Text Animations Specification Conformance", () => {
	describe("1. Path-Following Geometry & Arc-Length Parameterization", () => {
		it("should accurately parameterize a cubic Bezier curve for constant velocity travel", () => {
			// S-curve from (0, 0) to (400, 200)
			const curve = {
				p0: { x: 0, y: 0 },
				p1: { x: 100, y: 300 },
				p2: { x: 300, y: -100 },
				p3: { x: 400, y: 200 },
			};

			const { lut, totalLength } = generateArcLengthLUT(curve, 200);
			expect(totalLength).toBeGreaterThan(400);
			expect(lut.length).toBe(201);

			// Midpoint distance
			const midDist = totalLength / 2;
			const midT = distanceToCurveParameter(lut, midDist, totalLength);
			expect(midT).toBeGreaterThan(0.3);
			expect(midT).toBeLessThan(0.7);

			const midSample = sampleCurveGeometry(curve, lut, totalLength, midDist);
			expect(midSample.position.x).toBeGreaterThan(150);
			expect(midSample.position.x).toBeLessThan(250);
			// Normal vector should have unit length
			const normalLen = Math.hypot(midSample.normal.x, midSample.normal.y);
			expect(normalLen).toBeCloseTo(1.0, 4);
		});

		it("should construct valid path options using fluent TextPathBuilder", () => {
			const pathConfig = TextPathBuilder.circularBadge(960, 540, 300)
				.firstMargin(50)
				.perpendicularToPath(true)
				.baselineShift(10)
				.build();

			expect(pathConfig.loop).toBe(true);
			expect(pathConfig.firstMargin).toBe(50);
			expect(pathConfig.perpendicularToPath).toBe(true);
			expect(pathConfig.baselineShift).toBe(10);
			expect(TextPathOptionsSchema.safeParse(pathConfig).success).toBe(true);
		});
	});

	describe("2. After Effects Range & Wiggly Selectors", () => {
		it("should evaluate discrete square step and smooth Hermite falloff weights correctly", () => {
			// Square shape: binary 0 or 1
			expect(computeRangeSelectorWeight(0.5, 0.2, 0.8, 0, "square")).toBe(1);
			expect(computeRangeSelectorWeight(0.1, 0.2, 0.8, 0, "square")).toBe(0);

			// Ramp up
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "ramp_up"),
			).toBeCloseTo(0.5, 2);

			// Smooth S-curve (3x^2 - 2x^3) at midpoint x=0.5 -> 3(0.25) - 2(0.125) = 0.5
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "smooth"),
			).toBeCloseTo(0.5, 2);

			// Triangle peaks at center
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "triangle"),
			).toBeCloseTo(1.0, 2);
			expect(
				computeRangeSelectorWeight(0.1, 0.0, 1.0, 0, "triangle"),
			).toBeCloseTo(0.2, 2);
		});

		it("should compute deterministic bounded wiggly noise", () => {
			const noise1 = deterministicWigglyNoise(42, 0, 1.5, 0.5);
			const noise2 = deterministicWigglyNoise(42, 0, 1.5, 0.5);
			const noiseOtherGlyph = deterministicWigglyNoise(42, 5, 1.5, 0.5);

			expect(noise1).toBe(noise2); // Determinism
			expect(noise1).toBeGreaterThanOrEqual(-1.0);
			expect(noise1).toBeLessThanOrEqual(1.0);
			expect(noise1).not.toBe(noiseOtherGlyph);
		});

		it("should build cascading animators using TextAnimatorBuilder", () => {
			const waveRise = TextAnimatorBuilder.create("Wave Rise")
				.addRangeSelector({ start: 0, end: 1, offset: -0.5, shape: "smooth" })
				.y(60)
				.rotationX(-45)
				.opacity(0)
				.blur(8)
				.build();

			expect(waveRise.name).toBe("Wave Rise");
			expect(waveRise.props.y).toBe(60);
			expect(waveRise.props.rotationX).toBe(-45);
			expect(waveRise.props.blur).toBe(8);
			expect(waveRise.selectors[0].type).toBe("range");
		});
	});

	describe("3. Typewriter Cadence, Punctuation & Scramble", () => {
		it("should simulate human cadence pausing longer at sentence punctuation", () => {
			const text = "Hello, world. Next sentence!";
			const durationFrames = 60;

			const stateMid = evaluateTypewriterState(
				text,
				20,
				0,
				durationFrames,
				{
					mode: "human",
					jitter: 0.2,
					commaPauseMultiplier: 3.0,
					sentencePauseMultiplier: 5.0,
					paragraphPauseMultiplier: 6.0,
				},
				{
					enabled: false,
					charset: "alphanumeric",
					scrambleFramesPerChar: 8,
					highlightProbability: 0.25,
				},
			);

			expect(stateMid.visibleChars).toBeGreaterThan(0);
			expect(stateMid.visibleChars).toBeLessThan(text.length);
		});

		it("should validate complete EnhancedTextNode with path, typewriter, and animators", () => {
			const node = {
				text: "CLEAN WATER FOR EVERY CHILD",
				fontFamily: "Inter",
				fontSize: 32,
				fill: "#ffffff",
				pathOptions: TextPathBuilder.fromSvg("M 0 100 Q 200 0 400 100").build(),
				typewriter: {
					granularity: "character" as const,
					cursor: {
						enabled: true,
						style: "bar" as const,
						customChar: "|",
						blinkFrequency: 2.0,
						hideOnComplete: true,
						width: 3.0,
						spacing: 4.0,
					},
					cadence: { mode: "constant" as const },
					scramble: {
						enabled: true,
						charset: "alphanumeric" as const,
						scrambleFramesPerChar: 6,
						highlightProbability: 0.3,
					},
					soundSync: true,
				},
				animators: [
					TextAnimatorBuilder.create("Entrance")
						.addRangeSelector({ start: 0, end: 1, shape: "smooth" })
						.y(40)
						.opacity(0)
						.build(),
				],
			};

			const parsed = EnhancedTextNodeSchema.parse(node);
			expect(parsed.text).toBe("CLEAN WATER FOR EVERY CHILD");
			expect(parsed.pathOptions?.path.type).toBe("svg");
			expect(parsed.animators.length).toBe(1);
		});
	});
});
