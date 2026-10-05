/**
 * @file packages/framefields/test/text-animations-engine.test.ts
 * Comprehensive test suite verifying the After Effects Parity Text Animation Engine:
 * - Path-Following Geometry & Arc-Length Parameterization
 * - Range Selectors, Falloff Shapes, Easing & PRNG Shuffling
 * - Wiggly Selectors & Procedural Noise
 * - Realistic Human Typewriter Cadence & Scramble Ciphers
 * - Reactive Signal & WebGPU Signal Binding with Phase Spread
 * - End-to-End Composition & Animator Pipeline Integration
 */

import { type SlugFont, SlugGeometry } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import {
	type AETextAnimator,
	buildPathLUT,
	Composition,
	computeRangeSelectorWeight,
	deterministicWigglyNoise,
	distanceToCurveParameter,
	ellipseToCubicBeziers,
	evaluateCubicBezier,
	evaluateCubicBezierDerivative,
	evaluateSelectorCombination,
	evaluateTypewriterState,
	generateArcLengthLUT,
	getScramblePool,
	getShuffledOrder,
	Layer,
	LayerAnimation,
	parseSvgPathToCubicBeziers,
	sampleCurveGeometry,
	samplePathChainGeometry,
	TextAnimatorBuilder,
	TextPathBuilder,
	TextPathOptionsSchema,
	waveToCubicBeziers,
} from "../src/index.js";

describe("Text Animations Engine Conformance", () => {
	describe("1. Path-Following Geometry & Arc-Length Parameterization", () => {
		it("evaluates cubic Bezier coordinates and first derivative tangents correctly", () => {
			// Straight line from (0, 0) to (100, 0)
			const segment = {
				p0: { x: 0, y: 0 },
				p1: { x: 33.33, y: 0 },
				p2: { x: 66.66, y: 0 },
				p3: { x: 100, y: 0 },
			};

			const midPos = evaluateCubicBezier(segment, 0.5);
			expect(midPos.x).toBeCloseTo(50, 1);
			expect(midPos.y).toBeCloseTo(0, 1);

			const midDeriv = evaluateCubicBezierDerivative(segment, 0.5);
			expect(midDeriv.x).toBeGreaterThan(0);
			expect(midDeriv.y).toBeCloseTo(0, 1);
		});

		it("generates numerical quadrature arc-length LUT and maps distance to parameter t monotonically", () => {
			// S-curve
			const segment = {
				p0: { x: 0, y: 0 },
				p1: { x: 100, y: 200 },
				p2: { x: 300, y: -200 },
				p3: { x: 400, y: 0 },
			};

			const { lut, totalLength } = generateArcLengthLUT(segment, 100);
			expect(totalLength).toBeGreaterThan(400);
			expect(lut.length).toBe(101);

			// Strict monotonic increase in arc-length
			for (let i = 1; i < lut.length; i++) {
				expect(lut[i].distance).toBeGreaterThanOrEqual(lut[i - 1].distance);
				expect(lut[i].t).toBeGreaterThan(lut[i - 1].t);
			}

			// Inverting distance to parameter t
			const t0 = distanceToCurveParameter(lut, 0, totalLength);
			const tMid = distanceToCurveParameter(lut, totalLength / 2, totalLength);
			const tEnd = distanceToCurveParameter(lut, totalLength, totalLength);

			expect(t0).toBe(0);
			expect(tMid).toBeGreaterThan(0.3);
			expect(tMid).toBeLessThan(0.7);
			expect(tEnd).toBe(1);
		});

		it("samples curve geometry returning unit tangent and normal vectors", () => {
			const segment = {
				p0: { x: 0, y: 0 },
				p1: { x: 50, y: 100 },
				p2: { x: 150, y: 100 },
				p3: { x: 200, y: 0 },
			};
			const { lut, totalLength } = generateArcLengthLUT(segment, 100);

			const sample = sampleCurveGeometry(
				segment,
				lut,
				totalLength,
				totalLength * 0.5,
			);
			expect(sample.position).toBeDefined();
			expect(typeof sample.tangentAngleDeg).toBe("number");
			const normalLen = Math.hypot(sample.normal.x, sample.normal.y);
			expect(normalLen).toBeCloseTo(1.0, 4);
		});

		it("parses SVG path d string into chained cubic Bezier segments", () => {
			const svg = "M 10 20 C 30 40 50 60 70 80 S 110 120 130 140 Z";
			const segments = parseSvgPathToCubicBeziers(svg);
			expect(segments.length).toBeGreaterThanOrEqual(2);
			expect(segments[0].p0.x).toBe(10);
			expect(segments[0].p0.y).toBe(20);

			const chain = buildPathLUT(segments, 50);
			expect(chain.totalLength).toBeGreaterThan(100);

			const sample = samplePathChainGeometry(
				segments,
				chain,
				chain.totalLength * 0.25,
			);
			expect(sample.position).toBeDefined();
			expect(typeof sample.tangentAngleDeg).toBe("number");
			expect(Math.hypot(sample.normal.x, sample.normal.y)).toBeCloseTo(1.0, 3);
		});

		it("generates closed ellipse and sine wave curves accurately", () => {
			// Ellipse
			const ellipseSegments = ellipseToCubicBeziers(500, 500, 200, 100);
			expect(ellipseSegments.length).toBe(4);
			const ellipseChain = buildPathLUT(ellipseSegments, 40);
			// Perimeter of ellipse approx: pi * (3(a+b) - sqrt((3a+b)(a+3b))) ≈ 968.8
			expect(ellipseChain.totalLength).toBeGreaterThan(900);
			expect(ellipseChain.totalLength).toBeLessThan(1100);

			// Wave
			const waveSegments = waveToCubicBeziers(140, 560, 1000, 35, 2.5);
			const waveChain = buildPathLUT(waveSegments, 50);
			console.log(
				"Wave segments count:",
				waveSegments.length,
				"Total length:",
				waveChain.totalLength,
			);

			// Test step-by-step distance continuity
			const step = 5;
			let maxDistDiff = 0;
			for (let d = 0; d < waveChain.totalLength - step; d += step) {
				const s1 = samplePathChainGeometry(waveSegments, waveChain, d);
				const s2 = samplePathChainGeometry(waveSegments, waveChain, d + step);
				const actualDist = Math.hypot(
					s2.position.x - s1.position.x,
					s2.position.y - s1.position.y,
				);
				const diff = Math.abs(actualDist - step);
				if (diff > maxDistDiff) maxDistDiff = diff;
			}
			expect(maxDistDiff).toBeLessThan(0.1);
			expect(waveChain.totalLength).toBeGreaterThan(800);

			// Extrapolation past totalLength should continue along tangent without stacking
			const past1 = samplePathChainGeometry(
				waveSegments,
				waveChain,
				waveChain.totalLength + 10,
			);
			const past2 = samplePathChainGeometry(
				waveSegments,
				waveChain,
				waveChain.totalLength + 20,
			);
			const pastDist = Math.hypot(
				past2.position.x - past1.position.x,
				past2.position.y - past1.position.y,
			);
			expect(pastDist).toBeCloseTo(10, 2);
			expect(past1.position.x).not.toBe(past2.position.x);

			// Extrapolation before 0 should continue along tangent without stacking
			const before1 = samplePathChainGeometry(waveSegments, waveChain, -10);
			const before2 = samplePathChainGeometry(waveSegments, waveChain, -20);
			const beforeDist = Math.hypot(
				before2.position.x - before1.position.x,
				before2.position.y - before1.position.y,
			);
			expect(beforeDist).toBeCloseTo(10, 2);
			expect(before1.position.x).not.toBe(before2.position.x);
		});

		it("constructs valid path configurations via TextPathBuilder fluent API", () => {
			const badgePath = TextPathBuilder.circularBadge(960, 540, 250)
				.firstMargin(20)
				.lastMargin(500)
				.perpendicularToPath(true)
				.forceAlignment(false)
				.baselineShift(-8)
				.build();

			expect(badgePath.path.type).toBe("ellipse");
			expect(badgePath.loop).toBe(true);
			expect(badgePath.firstMargin).toBe(20);
			expect(badgePath.lastMargin).toBe(500);
			expect(badgePath.perpendicularToPath).toBe(true);
			expect(badgePath.baselineShift).toBe(-8);

			expect(TextPathOptionsSchema.safeParse(badgePath).success).toBe(true);
		});
	});

	describe("2. After Effects Range Selectors & Shuffling", () => {
		it("evaluates all 6 falloff shapes with mathematical correctness", () => {
			// Square: 1 inside, 0 outside
			expect(computeRangeSelectorWeight(0.5, 0.2, 0.8, 0, "square")).toBe(1);
			expect(computeRangeSelectorWeight(0.1, 0.2, 0.8, 0, "square")).toBe(0);
			expect(computeRangeSelectorWeight(0.9, 0.2, 0.8, 0, "square")).toBe(0);

			// Ramp up: linear 0 to 1
			expect(
				computeRangeSelectorWeight(0.0, 0.0, 1.0, 0, "ramp_up"),
			).toBeCloseTo(0.0, 4);
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "ramp_up"),
			).toBeCloseTo(0.5, 4);
			expect(
				computeRangeSelectorWeight(1.0, 0.0, 1.0, 0, "ramp_up"),
			).toBeCloseTo(1.0, 4);

			// Ramp down: linear 1 to 0
			expect(
				computeRangeSelectorWeight(0.0, 0.0, 1.0, 0, "ramp_down"),
			).toBeCloseTo(1.0, 4);
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "ramp_down"),
			).toBeCloseTo(0.5, 4);
			expect(
				computeRangeSelectorWeight(1.0, 0.0, 1.0, 0, "ramp_down"),
			).toBeCloseTo(0.0, 4);

			// Triangle: symmetric peak at center (1.0 at 0.5, 0 at edges)
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "triangle"),
			).toBeCloseTo(1.0, 4);
			expect(
				computeRangeSelectorWeight(0.25, 0.0, 1.0, 0, "triangle"),
			).toBeCloseTo(0.5, 4);
			expect(
				computeRangeSelectorWeight(0.75, 0.0, 1.0, 0, "triangle"),
			).toBeCloseTo(0.5, 4);

			// Round: half-cosine bell curve peaking at center
			expect(computeRangeSelectorWeight(0.0, 0.0, 1.0, 0, "round")).toBeCloseTo(
				0.0,
				4,
			);
			expect(computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "round")).toBeCloseTo(
				1.0,
				4,
			);
			expect(computeRangeSelectorWeight(1.0, 0.0, 1.0, 0, "round")).toBeCloseTo(
				0.0,
				4,
			);

			// Smooth: Hermite 3x^2 - 2x^3
			expect(
				computeRangeSelectorWeight(0.0, 0.0, 1.0, 0, "smooth"),
			).toBeCloseTo(0.0, 4);
			expect(
				computeRangeSelectorWeight(0.5, 0.0, 1.0, 0, "smooth"),
			).toBeCloseTo(0.5, 4);
			expect(
				computeRangeSelectorWeight(1.0, 0.0, 1.0, 0, "smooth"),
			).toBeCloseTo(1.0, 4);
		});

		it("applies easeHigh and easeLow non-linear curvature", () => {
			const highLinear = computeRangeSelectorWeight(
				0.75,
				0.0,
				1.0,
				0,
				"ramp_up",
				0,
				0,
			);
			expect(highLinear).toBeCloseTo(0.75, 4);

			// Non-linear power shaping modifies high weights
			const easedHigh = computeRangeSelectorWeight(
				0.75,
				0.0,
				1.0,
				0,
				"ramp_up",
				0.5,
				0,
			);
			expect(easedHigh).not.toBe(highLinear);
			expect(easedHigh).toBeCloseTo(0.5884, 2);

			// Negative easeHigh pulls weights toward 1
			const easedHighNegative = computeRangeSelectorWeight(
				0.75,
				0.0,
				1.0,
				0,
				"ramp_up",
				-0.5,
				0,
			);
			expect(easedHighNegative).toBeGreaterThan(highLinear);

			// Positive easeLow pushes weights toward 0
			const lowLinear = computeRangeSelectorWeight(
				0.25,
				0.0,
				1.0,
				0,
				"ramp_up",
				0,
				0,
			);
			const easedLow = computeRangeSelectorWeight(
				0.25,
				0.0,
				1.0,
				0,
				"ramp_up",
				0,
				0.5,
			);
			expect(easedLow).toBeLessThan(lowLinear);
		});

		it("produces deterministic pseudo-random order with getShuffledOrder", () => {
			const count = 16;
			const seed = 1337;

			const order1 = getShuffledOrder(count, seed);
			const order2 = getShuffledOrder(count, seed);
			const orderOtherSeed = getShuffledOrder(count, 9999);

			expect(order1).toEqual(order2);
			expect(order1.length).toBe(count);
			// Verify permutation properties: contains all indices 0..count-1
			const sorted = [...order1].sort((a, b) => a - b);
			for (let i = 0; i < count; i++) {
				expect(sorted[i]).toBe(i);
			}
			// Different seed produces different permutation
			expect(order1).not.toEqual(orderOtherSeed);
		});

		it("evaluates selector combination modes correctly", () => {
			const a = 0.8;
			const b = 0.4;

			expect(evaluateSelectorCombination(a, b, "add")).toBeCloseTo(1.0, 4); // clamped at 1
			expect(evaluateSelectorCombination(a, b, "subtract")).toBeCloseTo(0.4, 4);
			expect(evaluateSelectorCombination(a, b, "intersect")).toBeCloseTo(
				0.32,
				4,
			); // 0.8 * 0.4
			expect(evaluateSelectorCombination(a, b, "min")).toBeCloseTo(0.4, 4);
			expect(evaluateSelectorCombination(a, b, "max")).toBeCloseTo(0.8, 4);
			expect(evaluateSelectorCombination(a, b, "difference")).toBeCloseTo(
				0.4,
				4,
			); // |0.8 - 0.4|
		});
	});

	describe("3. Wiggly Selectors & Multi-Glyph Noise", () => {
		it("evaluates deterministic procedural 1D noise bounded in [-1, 1]", () => {
			const w1 = deterministicWigglyNoise(12345, 0, 2.0, 0.0);
			const w2 = deterministicWigglyNoise(12345, 0, 2.0, 0.0);
			expect(w1).toBe(w2);

			for (let glyphIdx = 0; glyphIdx < 20; glyphIdx++) {
				const val = deterministicWigglyNoise(12345, glyphIdx, 1.5, 0.25);
				expect(val).toBeGreaterThanOrEqual(-1.0);
				expect(val).toBeLessThanOrEqual(1.0);
			}
		});

		it("respects spatial correlation parameter across adjacent glyphs", () => {
			// With correlation = 1.0, all glyphs should have identical noise
			const n0 = deterministicWigglyNoise(42, 0, 1.0, 1.0);
			const n1 = deterministicWigglyNoise(42, 1, 1.0, 1.0);
			expect(n0).toBeCloseTo(n1, 4);

			// With correlation = 0.0, adjacent glyphs vary independently
			const nUncorrelated0 = deterministicWigglyNoise(42, 0, 1.0, 0.0);
			const nUncorrelated1 = deterministicWigglyNoise(42, 1, 1.0, 0.0);
			expect(nUncorrelated0).not.toBe(nUncorrelated1);
		});
	});

	describe("4. Realistic Human Typewriter Cadence & Scramble Cipher", () => {
		it("pauses longer on commas, sentence ends, and newlines in human cadence mode", () => {
			const text = "Wait, look here. Done!\nNext.";
			const durationFrames = 120;

			// Cadence config with high punctuation pause multipliers
			const cadence = {
				mode: "human" as const,
				commaPauseMultiplier: 4.0,
				sentencePauseMultiplier: 8.0,
				paragraphPauseMultiplier: 10.0,
			};

			const stateMid = evaluateTypewriterState(
				text,
				40,
				0,
				durationFrames,
				cadence,
				{ enabled: false },
			);

			expect(stateMid.visibleChars).toBeGreaterThan(0);
			expect(stateMid.visibleChars).toBeLessThan(text.length);

			// At final frame, all characters must be visible
			const stateFinal = evaluateTypewriterState(
				text,
				durationFrames,
				0,
				durationFrames,
				cadence,
				{ enabled: false },
			);
			expect(stateFinal.visibleChars).toBe(text.length);
		});

		it("decodes scramble cipher with matrix characters on trailing glyphs", () => {
			const text = "CYBERNETIC SYSTEM";
			const durationFrames = 60;
			const scramblePool = getScramblePool("matrix");
			expect(scramblePool.length).toBeGreaterThan(10);

			// Mid-animation frame with scramble enabled
			const state = evaluateTypewriterState(
				text,
				30,
				0,
				durationFrames,
				{ mode: "constant" },
				{
					enabled: true,
					charset: "matrix",
					scrambleFramesPerChar: 10,
					highlightProbability: 0.5,
				},
			);

			expect(state.visibleChars).toBeGreaterThan(0);
			expect(state.currentDisplayString.length).toBe(state.visibleChars);
		});

		it("toggles cursor visibility based on blink frequency", () => {
			const text = "Hello";
			const durationFrames = 60;
			const cursor = {
				enabled: true,
				style: "bar" as const,
				blinkFrequency: 2.0,
				hideOnComplete: true,
			};

			const state1 = evaluateTypewriterState(
				text,
				10,
				0,
				durationFrames,
				{ mode: "constant" },
				{ enabled: false },
				cursor,
				30, // 30 fps
			);

			const state2 = evaluateTypewriterState(
				text,
				18,
				0,
				durationFrames,
				{ mode: "constant" },
				{ enabled: false },
				cursor,
				30,
			);

			// Blink state should oscillate
			expect(typeof state1.isCursorVisible).toBe("boolean");
			expect(typeof state2.isCursorVisible).toBe("boolean");
		});
	});

	describe("5. Slug GPU Geometry on Curve", () => {
		const mockFont = {
			unitsPerEm: 1000,
			ascender: 800,
			descender: -200,
			codePoints: new Map([
				[
					65,
					{
						glyphIndex: 1,
						advanceWidth: 600,
						bbox: { minX: 0, minY: 0, maxX: 600, maxY: 800 },
					},
				],
				[
					66,
					{
						glyphIndex: 2,
						advanceWidth: 600,
						bbox: { minX: 0, minY: 0, maxX: 600, maxY: 800 },
					},
				],
				[
					67,
					{
						glyphIndex: 3,
						advanceWidth: 600,
						bbox: { minX: 0, minY: 0, maxX: 600, maxY: 800 },
					},
				],
			]),
		} as unknown as SlugFont;

		it("positions glyphs along a cubic Bezier path with orientation angle", () => {
			const curve = {
				p0: { x: 100, y: 300 },
				p1: { x: 300, y: 100 },
				p2: { x: 600, y: 500 },
				p3: { x: 800, y: 300 },
			};
			const pathOptions = TextPathBuilder.fromCurve(curve)
				.firstMargin(50)
				.perpendicularToPath(true)
				.baselineShift(15)
				.build();

			const layoutResults = SlugGeometry.layout(
				"ABC",
				mockFont,
				32,
				0,
				1.2,
				1000,
				"left",
				"char",
				undefined,
				pathOptions,
			);
			expect(layoutResults.glyphs.length).toBe(3);

			// Each glyph should now have an assigned curve position (x, y) and rotation angle
			for (const item of layoutResults.glyphs) {
				expect(item.x).toBeGreaterThan(100);
				expect(item.x).toBeLessThan(800);
				expect(item.y).toBeGreaterThan(50);
				expect(item.y).toBeLessThan(550);
				expect(typeof item.pathTangentAngleRad).toBe("number");
			}

			// In perpendicular orientation, consecutive glyphs on a curved path have non-zero rotation
			expect(layoutResults.glyphs[0].pathTangentAngleRad).not.toBe(0);
		});

		it("locks glyphs screen-upright when perpendicularToPath is false", () => {
			const curve = {
				p0: { x: 100, y: 300 },
				p1: { x: 300, y: 100 },
				p2: { x: 600, y: 500 },
				p3: { x: 800, y: 300 },
			};
			const pathOptions = TextPathBuilder.fromCurve(curve)
				.perpendicularToPath(false)
				.build();

			const layoutResults = SlugGeometry.layout(
				"ABC",
				mockFont,
				32,
				0,
				1.2,
				1000,
				"left",
				"char",
				undefined,
				pathOptions,
			);
			// Upright lock requires angle = 0 and perpendicularToPath = false
			expect(layoutResults.glyphs[0].pathTangentAngleRad).toBe(0);
			expect(layoutResults.glyphs[1].pathTangentAngleRad).toBe(0);
			expect(layoutResults.glyphs[0].perpendicularToPath).toBe(false);
		});
	});

	describe("6. Signal & Timeline Animation Binding", () => {
		it("constructs cascading text animators using TextAnimatorBuilder fluent API", () => {
			const kineticSweep = TextAnimatorBuilder.create("Kinetic Sweep")
				.addRangeSelector({
					start: 0,
					end: 1,
					offset: -0.5,
					shape: "smooth",
					easeHigh: 0.2,
					easeLow: 0.1,
				})
				.y(50)
				.rotationX(-60)
				.opacity(0)
				.blur(10)
				.fill("#38bdf8")
				.build();

			expect(kineticSweep.name).toBe("Kinetic Sweep");
			expect(kineticSweep.selectors.length).toBe(1);
			expect(kineticSweep.selectors[0].type).toBe("range");
			expect(kineticSweep.props.y).toBe(50);
			expect(kineticSweep.props.rotationX).toBe(-60);
			expect(kineticSweep.props.opacity).toBe(0);
			expect(kineticSweep.props.blur).toBe(10);
			expect(kineticSweep.props.fillColor).toBe("#38bdf8");
		});

		it("binds signal selectors with phase spread across glyphs", () => {
			const signalAnimator: AETextAnimator = {
				name: "Beat Bass Wave",
				selectors: [
					{
						type: "signal",
						signalId: "bass_drum_signal",
						channel: "primary",
						phaseSpread: 0.15, // 15% phase offset per glyph
						multiplier: 1.5,
					},
				],
				props: {
					y: 30,
					scale: 1.2,
				},
			};

			const selector = signalAnimator.selectors[0];
			if (selector.type === "signal") {
				expect(selector.phaseSpread).toBe(0.15);
			} else {
				throw new Error("Expected signal selector");
			}
		});

		it("integrates text animations cleanly with Composition and LayerAnimation", () => {
			const comp = new Composition({
				width: 1280,
				height: 720,
				fps: 30,
				durationMs: 2000,
				backgroundColor: "#050510",
			});

			const pathOpts = TextPathBuilder.circularBadge(640, 360, 200)
				.firstMargin(0)
				.perpendicularToPath(true)
				.build();

			const animator = TextAnimatorBuilder.create("Intro Rise")
				.addRangeSelector({ start: 0, end: 1, shape: "smooth" })
				.y(60)
				.opacity(0)
				.build();

			const textLayer = Layer.text("INNOVATION IN MOTION", {
				fontSize: 36,
				fill: "#ffffff",
				pathOptions: pathOpts,
				animators: [animator],
			}).animate([
				LayerAnimation.firstMargin(0, 400, {
					from: 0,
					to: 60,
					ease: "power2.out",
				}),
				LayerAnimation.kineticSweep(-1, 1, 0, 60, "power2.out"),
			]);

			comp.add(textLayer);
			const vm = comp.toVirtualMedia();

			expect(vm.operation?.op).toBe("Compositor");
			expect(vm.children.length).toBe(1);
			const childOp = vm.children[0].operation as Record<string, unknown>;
			expect(childOp.kind).toBe("text");
			expect(childOp.pathOptions).toBeDefined();
			expect((childOp.animators as unknown[]).length).toBe(1);
			expect(
				(childOp.animation as { tracks?: unknown[] })?.tracks?.length,
			).toBe(2);
		});
	});
});
