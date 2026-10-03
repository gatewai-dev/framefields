/**
 * @file packages/gitframes/test/advanced-text-animations.test.ts
 * Comprehensive test suite verifying the Advanced Motion Design & After Effects Extended Typography Engine:
 * - Closed-form Inertial Spring & Elastic Overshoot Physics
 * - Directional Skew & Arbitrary Skew Axis Matrix
 * - Anchor Point Grouping & Custom Pivot Alignments
 * - Accordion Line Spacing & Dynamic Leading
 * - Sandboxed Expression Selector Evaluation
 * - 3D Volumetric Formations (Cylinder, Vortex, Helix)
 * - Infinite Kinetic Marquee & Slot-Machine Snapping
 * - Audio Spectrum Equalizer Typography Mapping
 * - Fluent Builder API & Specification Recipes Conformance
 */

import { describe, expect, it } from "vitest";
import {
	AdvancedTextAnimatorBuilder,
	computeAnchorPivotOffset,
	computeLineLeadingDisplacement,
	evaluateExpressionSelector,
	evaluateMarqueeOffset,
	evaluateSkewMatrix,
	evaluateSpringProgress,
	evaluateVolumetricFormation,
	sampleAudioSpectrumScale,
} from "../src/index.js";

describe("Advanced Motion Design Typography Engine Conformance", () => {
	describe("1. Closed-Form Inertial Spring & Elastic Overshoot Physics", () => {
		it("evaluates underdamped harmonic oscillator with elastic overshoot and smooth settling", () => {
			// Underdamped system: k = 220, c = 14, m = 1.0 (zeta = 14 / (2 * sqrt(220)) ≈ 0.47 < 1.0)
			const atStart = evaluateSpringProgress(0, 220, 14, 1.0);
			expect(atStart).toBe(0);

			// Track progression and assert overshoot (> 1.0)
			let maxProgress = 0;
			let overshootObserved = false;
			for (let t = 0.01; t <= 1.0; t += 0.01) {
				const p = evaluateSpringProgress(t, 220, 14, 1.0);
				if (p > maxProgress) maxProgress = p;
				if (p > 1.0) overshootObserved = true;
			}

			expect(overshootObserved).toBe(true);
			expect(maxProgress).toBeGreaterThan(1.15); // Clear elastic rebound overshoot

			// Asserts settling to 1.0 after 1.5 seconds
			const atEnd = evaluateSpringProgress(1.5, 220, 14, 1.0);
			expect(atEnd).toBeCloseTo(1.0, 2);
		});

		it("evaluates critically damped and overdamped systems without overshoot", () => {
			// Critically damped: k = 100, c = 20, m = 1.0 (zeta = 20 / 20 = 1.0)
			for (let t = 0; t <= 1.0; t += 0.05) {
				const p = evaluateSpringProgress(t, 100, 20, 1.0);
				expect(p).toBeLessThanOrEqual(1.0001);
				expect(p).toBeGreaterThanOrEqual(0);
			}

			// Overdamped: k = 100, c = 40, m = 1.0 (zeta = 40 / 20 = 2.0 > 1.0)
			for (let t = 0; t <= 1.0; t += 0.05) {
				const p = evaluateSpringProgress(t, 100, 40, 1.0);
				expect(p).toBeLessThanOrEqual(1.0);
				expect(p).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("2. Directional Skew & Skew Axis Matrix", () => {
		it("evaluates pure horizontal shear when skewAxis is 0 degrees", () => {
			// 45 degree skew, 0 degree axis
			const [m00, m01, m10, m11] = evaluateSkewMatrix(45, 0);
			expect(m00).toBeCloseTo(1.0, 4);
			expect(m01).toBeCloseTo(1.0, 4); // tan(45) = 1.0
			expect(m10).toBeCloseTo(0.0, 4);
			expect(m11).toBeCloseTo(1.0, 4);
		});

		it("evaluates vertical shear when skewAxis is 90 degrees", () => {
			// 45 degree skew, 90 degree axis
			const [m00, m01, m10, m11] = evaluateSkewMatrix(45, 90);
			expect(m00).toBeCloseTo(1.0, 4);
			expect(m01).toBeCloseTo(0.0, 4);
			expect(m10).toBeCloseTo(-1.0, 4);
			expect(m11).toBeCloseTo(1.0, 4);
		});

		it("evaluates identity matrix when skew is 0 degrees", () => {
			const [m00, m01, m10, m11] = evaluateSkewMatrix(0, 45);
			expect(m00).toBe(1);
			expect(m01).toBe(0);
			expect(m10).toBe(0);
			expect(m11).toBe(1);
		});
	});

	describe("3. Anchor Point Centroid Offsets", () => {
		const bbox = { width: 100, height: 100, ascender: 80, descender: -20 };

		it("computes center pivot at (0, 0) relative to quad center", () => {
			const pivot = computeAnchorPivotOffset(bbox, {
				grouping: "character",
				preset: "center",
				anchorX: 0.5,
				anchorY: 0.5,
				offsetX: 0,
				offsetY: 0,
			});
			expect(pivot.px).toBeCloseTo(0, 4);
			expect(pivot.py).toBeCloseTo(0, 4);
		});

		it("computes baseline pivot offset accurately using font metrics", () => {
			const pivot = computeAnchorPivotOffset(bbox, {
				grouping: "character",
				preset: "baseline",
				anchorX: 0.5,
				anchorY: 0.5,
				offsetX: 0,
				offsetY: 0,
			});
			// normY = 80 / 100 = 0.8, py = (0.8 - 0.5) * 100 = 30
			expect(pivot.px).toBeCloseTo(0, 4);
			expect(pivot.py).toBeCloseTo(30, 4);
		});

		it("computes corner and edge presets correctly", () => {
			// bottom_left: normX=0, normY=1 => px=-50, py=50
			const bl = computeAnchorPivotOffset(bbox, {
				grouping: "character",
				preset: "bottom_left",
				anchorX: 0.5,
				anchorY: 0.5,
				offsetX: 0,
				offsetY: 0,
			});
			expect(bl.px).toBeCloseTo(-50, 4);
			expect(bl.py).toBeCloseTo(50, 4);

			// top_center: normX=0.5, normY=0 => px=0, py=-50
			const tc = computeAnchorPivotOffset(bbox, {
				grouping: "character",
				preset: "top_center",
				anchorX: 0.5,
				anchorY: 0.5,
				offsetX: 0,
				offsetY: 0,
			});
			expect(tc.px).toBeCloseTo(0, 4);
			expect(tc.py).toBeCloseTo(-50, 4);
		});
	});

	describe("4. Dynamic Line Spacing (Leading) & Accordion Line Anchors", () => {
		it("computes top line anchored leading expansion (lineAnchor = 0.0)", () => {
			const lineCount = 3;
			const extraLeading = 24;

			expect(
				computeLineLeadingDisplacement(0, lineCount, extraLeading, 0.0),
			).toBe(0);
			expect(
				computeLineLeadingDisplacement(1, lineCount, extraLeading, 0.0),
			).toBe(24);
			expect(
				computeLineLeadingDisplacement(2, lineCount, extraLeading, 0.0),
			).toBe(48);
		});

		it("computes center line anchored accordion leading expansion (lineAnchor = 0.5)", () => {
			const lineCount = 3;
			const extraLeading = 20;

			// Center line remains stationary; upper line moves up, lower line moves down
			expect(
				computeLineLeadingDisplacement(0, lineCount, extraLeading, 0.5),
			).toBe(-20);
			expect(
				computeLineLeadingDisplacement(1, lineCount, extraLeading, 0.5),
			).toBe(0);
			expect(
				computeLineLeadingDisplacement(2, lineCount, extraLeading, 0.5),
			).toBe(20);
		});

		it("computes bottom line anchored leading expansion (lineAnchor = 1.0)", () => {
			const lineCount = 3;
			const extraLeading = 30;

			expect(
				computeLineLeadingDisplacement(0, lineCount, extraLeading, 1.0),
			).toBe(-60);
			expect(
				computeLineLeadingDisplacement(1, lineCount, extraLeading, 1.0),
			).toBe(-30);
			expect(
				computeLineLeadingDisplacement(2, lineCount, extraLeading, 1.0),
			).toBe(0);
		});
	});

	describe("5. Expression Selectors (Programmatic Per-Glyph Evaluation)", () => {
		it("evaluates mathematical expressions with standard functions and per-glyph metrics", () => {
			const ctx = {
				charIndex: 5,
				wordIndex: 1,
				lineIndex: 0,
				totalChars: 10,
				totalWords: 2,
				totalLines: 1,
				frame: 30,
				fps: 30,
				time: 1.0,
			};

			const expr1 = "Math.sin(time * Math.PI)";
			expect(evaluateExpressionSelector(expr1, ctx)).toBeCloseTo(0, 4);

			const expr2 = "textIndex / textTotal";
			expect(evaluateExpressionSelector(expr2, ctx)).toBeCloseTo(0.5, 4);

			const expr3 = "clamp(time * 0.5, 0, 1)";
			expect(evaluateExpressionSelector(expr3, ctx)).toBeCloseTo(0.5, 4);
		});

		it("handles invalid or error-throwing formulas gracefully by returning 0", () => {
			const ctx = {
				charIndex: 0,
				wordIndex: 0,
				lineIndex: 0,
				totalChars: 1,
				totalWords: 1,
				totalLines: 1,
				frame: 0,
				fps: 30,
				time: 0,
			};

			const badExpr = "undefinedFunction(unknownVar)";
			expect(evaluateExpressionSelector(badExpr, ctx)).toBe(0);
		});
	});

	describe("6. 3D Volumetric Formations (Cylinder, Vortex, Helix)", () => {
		it("evaluates 3D cylindrical drum formation with radial yaw and depth", () => {
			const config = {
				mode: "cylinder" as const,
				radius: 300,
				pitch: 120,
				totalAngle: 360,
				axis: "y" as const,
				perspective: 1200,
			};

			// At index 0 (0 degrees)
			const c0 = evaluateVolumetricFormation(0, 4, config);
			expect(c0.z).toBeCloseTo(0, 1);
			expect(c0.rotY).toBeCloseTo(0, 1);

			// At quarter turn (90 degrees, index 1 of 4)
			const c1 = evaluateVolumetricFormation(1, 5, config);
			expect(c1.x).toBeGreaterThan(0);
			expect(c1.rotY).toBeCloseTo(90, 1);
		});

		it("evaluates logarithmic vortex spiral with depth displacement", () => {
			const config = {
				mode: "vortex" as const,
				radius: 200,
				pitch: 50,
				totalAngle: 720,
				axis: "z" as const,
				perspective: 1200,
			};

			const v0 = evaluateVolumetricFormation(0, 10, config);
			const v9 = evaluateVolumetricFormation(9, 10, config);

			expect(v0.z).toBe(0);
			expect(v9.z).toBeLessThan(v0.z); // Spiraling into screen
		});
	});

	describe("7. Infinite Kinetic Marquee & Looping Ribbon", () => {
		it("evaluates continuous wrapping within container span", () => {
			const config = {
				direction: "left" as const,
				velocity: 100, // 100 px/sec
				loop: true,
				repeatGap: 50,
			};

			const pos0 = evaluateMarqueeOffset(0, 800, 300, config, 0);
			expect(pos0).toBe(0);

			const pos1 = evaluateMarqueeOffset(0, 800, 300, config, 1.0);
			expect(pos1).toBe(-100);
		});
	});

	describe("8. Multi-Band Audio Spectrum Equalizer Typography", () => {
		it("samples audio FFT bands and scales characters proportionally", () => {
			const config = {
				signalChannel: "fft_spectrum",
				minFreqHz: 60,
				maxFreqHz: 16000,
				scaleAxis: "scaleY" as const,
				minScale: 0.5,
				maxScale: 3.0,
				peakDecay: 0.8,
			};

			const signals = {
				fft_spectrum: {
					samples: [0.1, 0.4, 0.9, 0.2],
				},
			};

			const scale0 = sampleAudioSpectrumScale(0, 4, config, signals, 0, 30);
			const scale2 = sampleAudioSpectrumScale(2, 4, config, signals, 0, 30);

			expect(scale0).toBeGreaterThanOrEqual(0.5);
			expect(scale2).toBeGreaterThan(scale0); // Higher magnitude bin gives higher scale
		});
	});

	describe("9. Fluent Builder API & Specification Recipes Conformance", () => {
		it("4.1 Elastic Drop recipe builds correct properties", () => {
			const springAnimator = AdvancedTextAnimatorBuilder.create("Elastic Drop")
				.anchor("baseline")
				.y(-120)
				.scale(0.4)
				.opacity(0)
				.spring(220, 14, 1.0)
				.build();

			expect(springAnimator.name).toBe("Elastic Drop");
			expect(springAnimator.props.y).toBe(-120);
			expect(springAnimator.props.scale).toBe(0.4);
			expect(springAnimator.props.opacity).toBe(0);
			expect(springAnimator.props.anchor?.preset).toBe("baseline");
			expect(springAnimator.props.spring?.stiffness).toBe(220);
			expect(springAnimator.props.spring?.damping).toBe(14);
		});

		it("4.2 Speed Rush recipe builds directional skew correctly", () => {
			const speedAnimator = AdvancedTextAnimatorBuilder.create("Speed Rush")
				.x(-200)
				.skew(35, 45)
				.opacity(0)
				.build();

			expect(speedAnimator.name).toBe("Speed Rush");
			expect(speedAnimator.props.x).toBe(-200);
			expect(speedAnimator.props.skew).toBe(35);
			expect(speedAnimator.props.skewAxis).toBe(45);
		});

		it("4.3 Hanging Pendulum recipe builds top-center pivot correctly", () => {
			const pendulumAnimator = AdvancedTextAnimatorBuilder.create(
				"Hanging Pendulum",
			)
				.anchor("top_center")
				.rotation(-90)
				.opacity(0)
				.spring(160, 10, 1.2)
				.build();

			expect(pendulumAnimator.name).toBe("Hanging Pendulum");
			expect(pendulumAnimator.props.anchor?.preset).toBe("top_center");
			expect(pendulumAnimator.props.rotation).toBe(-90);
			expect(pendulumAnimator.props.spring?.mass).toBe(1.2);
		});

		it("4.4 Cyber Glitch recipe builds chromatic aberration correctly", () => {
			const glitchAnimator = AdvancedTextAnimatorBuilder.create("Cyber Glitch")
				.chromaticGlitch(8, 0, -8, 0)
				.fillColor("#00ffcc")
				.build();

			expect(glitchAnimator.name).toBe("Cyber Glitch");
			expect(glitchAnimator.props.chromaticGlitch?.redShiftX).toBe(8);
			expect(glitchAnimator.props.chromaticGlitch?.blueShiftX).toBe(-8);
			expect(glitchAnimator.props.fillColor).toBe("#00ffcc");
		});

		it("4.5 Equalizer Typography recipe builds audio spectrum correctly", () => {
			const eqAnimator = AdvancedTextAnimatorBuilder.create(
				"Equalizer Typography",
			)
				.anchor("bottom_center")
				.audioSpectrum("music_fft", 60, 16000, 3.0)
				.fillColor("#f59e0b")
				.build();

			expect(eqAnimator.name).toBe("Equalizer Typography");
			expect(eqAnimator.props.anchor?.preset).toBe("bottom_center");
			expect(eqAnimator.props.audioSpectrum?.signalChannel).toBe("music_fft");
			expect(eqAnimator.props.audioSpectrum?.maxScale).toBe(3.0);
		});
	});
});
