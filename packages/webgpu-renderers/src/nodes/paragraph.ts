import { GetFontAssetUrl } from "@gitframes/client-utils";
import { parseColor } from "../color.js";
import type { RenderContextValue } from "../render-context.js";
import type { Color } from "../renderer2d/index.js";
import { signalRegistry } from "../signals/signal-registry.js";
import { parseFontWeight, SlugFontCache } from "../slug/slug-font-cache.js";
import {
	SlugGeometry,
	type SlugGlyphLayout,
	type SlugLayoutResult,
} from "../slug/slug-geometry.js";
import type { SlugFont } from "../slug/slug-loader.js";
import {
	type AdvancedTextAnimator,
	type AETextAnimator,
	computeAnchorPivotOffset,
	computeLineLeadingDisplacement,
	computeRangeSelectorWeight,
	deterministicWigglyNoise,
	type ExpressionEvaluationContext,
	type ExpressionSelector,
	type ExtendedGlyphProperties,
	evaluateExpressionSelector,
	evaluateMarqueeOffset,
	evaluateSelectorCombination,
	evaluateSkewMatrix,
	evaluateSpringProgress,
	evaluateTypewriterState,
	evaluateVolumetricFormation,
	getShuffledOrder,
	type LongShadowConfig,
	type SelectorMode,
	type SelectorShape,
	sampleAudioSpectrumScale,
	type TextAnchorConfig,
} from "../text-animations/index.js";
import type { ParagraphNodeProps, TextAnimator } from "./types.js";

function sampleSignalValue(
	signals: Record<string, unknown> | undefined,
	signalId: string,
	frame: number,
	fps: number,
	phaseSpread = 0,
	glyphIndex = 0,
): number {
	const regSamples = signalRegistry.getChannelSamples(signalId, "primary");
	if (regSamples && regSamples.length > 0) {
		const compFps = fps > 0 ? fps : 24;
		const t = frame / compFps;
		const phaseOffsetSec =
			phaseSpread !== 0 ? (glyphIndex * phaseSpread) / (2 * Math.PI) : 0;
		const effT = Math.max(0, t + phaseOffsetSec);
		const idx = Math.max(
			0,
			Math.min(regSamples.length - 1, Math.round(effT * compFps)),
		);
		return Number(regSamples[idx]) || 0;
	}

	if (!signals) return 0;
	const sig = signals[signalId];
	if (sig === undefined || sig === null) return 0;

	if (typeof sig === "number") return sig;
	if (typeof sig === "function") {
		return Number(sig(frame, fps)) || 0;
	}
	if (typeof sig === "object") {
		const sObj = sig as Record<string, unknown>;
		if (typeof sObj.get === "function") {
			const time = fps > 0 ? frame / fps : 0;
			const phaseOffsetSec =
				phaseSpread !== 0 ? (glyphIndex * phaseSpread) / (2 * Math.PI) : 0;
			return (
				Number(
					(sObj.get as (ctx: unknown) => unknown)({
						frame,
						fps,
						time: time + phaseOffsetSec,
					}),
				) || 0
			);
		}
		if (Array.isArray(sObj.samples) || ArrayBuffer.isView(sObj.samples)) {
			const arr = sObj.samples as ArrayLike<number>;
			const idx = Math.max(0, Math.min(arr.length - 1, Math.round(frame)));
			return Number(arr[idx]) || 0;
		}
	}
	return 0;
}

function easeInOutQuad(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function seededRandom(str: string) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash);
	}
	return () => {
		const x = Math.sin(hash++) * 10000;
		return x - Math.floor(x);
	};
}

function getShuffleOrder(n: number, seed: string): number[] {
	const rand = seededRandom(seed);
	const arr = Array.from({ length: n }, (_, i) => i);
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const temp = arr[i];
		arr[i] = arr[j];
		arr[j] = temp;
	}
	return arr;
}

function getOrCreateEmojiTexture(
	device: GPUDevice,
	char: string,
	fontSize: number,
): GPUTexture {
	const key = `${char}-${fontSize}`;
	let tex = SlugFontCache.emojiTextureCache.get(key);
	if (tex) {
		return tex;
	}

	const resolutionScale = 4.0;
	const emojiSize = Math.max(16, Math.ceil(fontSize * 1.5 * resolutionScale));
	const size = Math.ceil(emojiSize / 4) * 4;

	const isNode =
		!!(globalThis as Record<string, unknown>).__IS_HEADLESS_RENDERER__ ||
		typeof window === "undefined" ||
		typeof globalThis.document === "undefined";

	if (isNode) {
		console.warn(
			`[getOrCreateEmojiTexture] Emoji "${char}" not preloaded. Returning fallback dummy texture.`,
		);
		tex = device.createTexture({
			label: `Emoji-Dummy-${char}`,
			size: [1, 1],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});
		SlugFontCache.emojiTextureCache.set(key, tex);
		return tex;
	}

	const canvas = new OffscreenCanvas(size, size);
	const c2d = canvas.getContext("2d");
	if (c2d) {
		c2d.font = `${fontSize * resolutionScale}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "NotoColorEmoji", sans-serif`;
		c2d.textBaseline = "middle";
		c2d.textAlign = "center";
		c2d.fillText(char, size / 2, size / 2);
	}

	tex = device.createTexture({
		label: `Emoji-${char}`,
		size: [size, size],
		format: "rgba8unorm",
		usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_DST |
			GPUTextureUsage.RENDER_ATTACHMENT,
	});

	device.queue.copyExternalImageToTexture(
		{ source: canvas },
		{ texture: tex, premultipliedAlpha: true },
		[size, size],
	);

	SlugFontCache.emojiTextureCache.set(key, tex);
	return tex;
}

interface UnitProgress {
	p_in: number;
	p_out: number;
}

function computeUnitProgress(
	elapsed: number,
	duration: number,
	entranceMs: number,
	exitMs: number,
	idx_i: number,
	totalUnits: number,
	isVideoMode: boolean,
): UnitProgress {
	if (!isVideoMode) {
		return { p_in: 1, p_out: 1 };
	}

	let p_in = 1;
	if (entranceMs > 0) {
		const D_unit = entranceMs * 0.5;
		const t_stagger =
			totalUnits > 1 ? (entranceMs * 0.5) / (totalUnits - 1) : 0;
		const s_i = idx_i * t_stagger;
		const e_i = s_i + D_unit;
		if (elapsed < s_i) p_in = 0;
		else if (elapsed > e_i) p_in = 1;
		else p_in = (elapsed - s_i) / (e_i - s_i);
	}

	let p_out = 1;
	if (exitMs > 0) {
		const t_exit_start = duration - exitMs;
		if (elapsed > t_exit_start) {
			const D_unit = exitMs * 0.5;
			const t_stagger = totalUnits > 1 ? (exitMs * 0.5) / (totalUnits - 1) : 0;
			const s_i = t_exit_start + idx_i * t_stagger;
			const e_i = s_i + D_unit;
			if (elapsed < s_i) p_out = 1;
			else if (elapsed > e_i) p_out = 0;
			else p_out = 1 - (elapsed - s_i) / (e_i - s_i);
		}
	}

	return { p_in, p_out };
}

interface AnimationEffectsResult {
	opacity: number;
	transX: number;
	transY: number;
	rot: number;
	scale: number;
	blurAmount: number;
	visible: boolean;
}

function applyAnimationEffects(
	p_in: number,
	p_out: number,
	smoothing: boolean,
	transitionIn: string,
	transitionOut: string,
	kinetic: string,
	elapsed: number,
	duration: number,
	entranceMs: number,
	exitMs: number,
	idx_i: number,
	baseOpacity: number,
	isEmoji: boolean,
): AnimationEffectsResult {
	const ep_in = smoothing ? easeInOutQuad(p_in) : p_in;
	const ep_out = smoothing ? easeInOutQuad(p_out) : p_out;
	const ep_i = ep_in * ep_out;

	// Check visibility early if not blurring
	if (
		(ep_in <= 0 && transitionIn !== "blur") ||
		(ep_out <= 0 && transitionOut !== "blur")
	) {
		return {
			opacity: 0,
			transX: 0,
			transY: 0,
			rot: 0,
			scale: 1,
			blurAmount: 0,
			visible: false,
		};
	}

	let opacity = baseOpacity;

	// In-transition
	if (
		transitionIn === "fade" ||
		transitionIn === "slideUp" ||
		transitionIn === "blur"
	) {
		opacity *= ep_in;
	} else if (transitionIn === "appear") {
		if (ep_in < 0.5) opacity = 0;
	}

	// Out-transition
	if (
		transitionOut === "fade" ||
		transitionOut === "slideUp" ||
		transitionOut === "blur"
	) {
		opacity *= ep_out;
	} else if (transitionOut === "appear") {
		if (ep_out < 0.5) opacity = 0;
	}

	if (opacity < 0.001) {
		return {
			opacity: 0,
			transX: 0,
			transY: 0,
			rot: 0,
			scale: 1,
			blurAmount: 0,
			visible: false,
		};
	}

	let transX = 0;
	let transY = 0;
	let rot = 0;
	let scale = 1.0;

	// Slide-up transitions
	if (transitionIn === "slideUp" && elapsed < entranceMs) {
		transY += (1 - ep_in) * 30;
	}
	if (transitionOut === "slideUp" && elapsed > duration - exitMs) {
		transY -= (1 - ep_out) * 30;
	}

	// Kinetic effects
	const rotScale = isEmoji ? 1 : Math.PI / 180;

	if (kinetic === "stack") {
		scale = 0.8 + 0.2 * ep_i;
		rot = (1 - ep_i) * 15 * rotScale;
	} else if (kinetic === "wave") {
		transY += 10 * Math.sin(elapsed * 0.005 - idx_i * 0.5);
	} else if (kinetic === "wiggle") {
		transX += 5 * Math.sin(elapsed * 0.008 + idx_i * 1.7);
		transY += 5 * Math.cos(elapsed * 0.006 + idx_i * 1.3);
		rot += 4 * Math.sin(elapsed * 0.005 + idx_i * 2.1) * rotScale;
	} else if (kinetic === "shuffle") {
		transX += 3 * Math.sin(elapsed * 0.015 + idx_i * 3.1);
		transY += 3 * Math.cos(elapsed * 0.012 + idx_i * 2.3);
		rot += 8 * Math.sin(elapsed * 0.02 + idx_i * 1.1) * rotScale;
	}

	let blurAmount = 0.0;
	if (transitionIn === "blur") {
		blurAmount = Math.max(blurAmount, (1.0 - ep_in) * 20.0);
	}
	if (transitionOut === "blur") {
		blurAmount = Math.max(blurAmount, (1.0 - ep_out) * 20.0);
	}

	return {
		opacity,
		transX,
		transY,
		rot,
		scale,
		blurAmount,
		visible: true,
	};
}

type EasingFn = (t: number) => number;

const KINETIC_EASING_MAP: Record<string, EasingFn> = {
	linear: (t) => t,
	none: (t) => t,
	smoothstep: (t) => t,
	"power1.out": (t) => 1 - (1 - t) ** 2,
	"quad.out": (t) => 1 - (1 - t) ** 2,
	"power1.in": (t) => t ** 2,
	"quad.in": (t) => t ** 2,
	"power1.inout": (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
	"quad.inout": (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
	"power2.out": (t) => 1 - (1 - t) ** 3,
	"cubic.out": (t) => 1 - (1 - t) ** 3,
	"power2.in": (t) => t ** 3,
	"cubic.in": (t) => t ** 3,
	"power2.inout": (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
	"cubic.inout": (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
	"power3.out": (t) => 1 - (1 - t) ** 4,
	"quart.out": (t) => 1 - (1 - t) ** 4,
	"power3.in": (t) => t ** 4,
	"quart.in": (t) => t ** 4,
	"power3.inout": (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
	"quart.inout": (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
	"power4.out": (t) => 1 - (1 - t) ** 5,
	"quint.out": (t) => 1 - (1 - t) ** 5,
	"power4.in": (t) => t ** 5,
	"quint.in": (t) => t ** 5,
	"sine.out": (t) => Math.sin((t * Math.PI) / 2),
	"sine.in": (t) => 1 - Math.cos((t * Math.PI) / 2),
	"sine.inout": (t) => -(Math.cos(Math.PI * t) - 1) / 2,
	"expo.out": (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
	"back.out": (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

export function evaluateEasing(ease: string | undefined, t: number): number {
	const clamped = Math.max(0, Math.min(1, t));
	if (!ease) return clamped;
	const fn = KINETIC_EASING_MAP[ease.toLowerCase().trim()];
	return fn ? fn(clamped) : clamped;
}

export function computeAnimatorProgress(
	animator: TextAnimator,
	unitIdx: number,
	totalUnits: number,
): number {
	if (totalUnits <= 0) return 0;
	const p = totalUnits > 1 ? unitIdx / (totalUnits - 1) : 0.5;
	const offset = animator.offset ?? 0;
	const rStart = (animator.rangeStart ?? 0) + offset;
	const rEnd = (animator.rangeEnd ?? 1) + offset;

	let u = 0;
	if (rEnd <= rStart) {
		u = p >= rStart ? 1 : 0;
	} else {
		u = Math.max(0, Math.min(1, (p - rStart) / (rEnd - rStart)));
	}

	const s = u * u * (3 - 2 * u);
	return evaluateEasing(animator.easing ?? "power2.out", s);
}

export interface GlyphTransforms {
	transX: number;
	transY: number;
	transZ?: number;
	rot: number;
	scale: number;
	scaleX: number;
	scaleY: number;
	opacity: number;
	blurAmount: number;
	color?: Color;
	chromaticShift?: number;
	dissolveProgress?: number;
	vfxParam?: number;
	skewM01?: number;
	skewM10?: number;
	anchorConfig?: TextAnchorConfig;
	fillOpacity?: number;
	strokeWidth?: number;
	strokeColor?: string;
	longShadow?: LongShadowConfig;
	lineSpacing?: number;
	lineAnchor?: number;
}

export function evaluateAEAnimatorWeight(
	aeAnim: AETextAnimator | AdvancedTextAnimator,
	glyph: { charIndex?: number; wordIndex?: number; lineIndex?: number },
	counts: { charsCount?: number; wordsCount?: number; linesCount?: number },
	signals: Record<string, unknown> | undefined,
	frame: number,
	fps: number,
): number {
	const charsCount = Math.max(1, counts.charsCount ?? 1);
	const wordsCount = Math.max(1, counts.wordsCount ?? 1);
	const linesCount = Math.max(1, counts.linesCount ?? 1);

	const selectors = aeAnim.selectors ?? [];
	if (selectors.length === 0) {
		return 1.0;
	}

	let combinedWeight = 0;
	for (let sIdx = 0; sIdx < selectors.length; sIdx++) {
		const selector = selectors[sIdx] as Record<string, unknown>;
		let currentWeight = 0;

		if (selector.type === "range") {
			let totalUnits = charsCount;
			let unitIdx = glyph.charIndex ?? 0;
			if (selector.basedOn === "words") {
				totalUnits = wordsCount;
				unitIdx = glyph.wordIndex ?? 0;
			} else if (selector.basedOn === "lines") {
				totalUnits = linesCount;
				unitIdx = glyph.lineIndex ?? 0;
			}

			if (selector.randomizeOrder) {
				const perm = getShuffledOrder(
					totalUnits,
					(selector.randomSeed as number) ?? 12345,
				);
				unitIdx = perm[unitIdx % totalUnits] ?? unitIdx;
			}

			const normalizedPos =
				selector.units === "index"
					? unitIdx
					: totalUnits > 1
						? unitIdx / (totalUnits - 1)
						: 0.5;

			const start =
				(selector.start as number) ??
				(aeAnim as { rangeStart?: number }).rangeStart ??
				0;
			const end =
				(selector.end as number) ??
				(aeAnim as { rangeEnd?: number }).rangeEnd ??
				(selector.units === "index" ? totalUnits : 1);
			const offset =
				(selector.offset as number) ??
				(aeAnim as { offset?: number }).offset ??
				0;

			currentWeight =
				computeRangeSelectorWeight(
					normalizedPos,
					start,
					end,
					offset,
					(selector.shape as SelectorShape) ?? "smooth",
					(selector.easeHigh as number) ?? 0,
					(selector.easeLow as number) ?? 0,
				) * ((selector.amount as number) ?? 1);
		} else if (selector.type === "wiggly") {
			const tSec = fps > 0 ? frame / fps : 0;
			const temporalPhase =
				(((selector.temporalPhaseDeg as number) ?? 0) * Math.PI) / 180;
			const spatialPhase =
				(((selector.spatialPhaseDeg as number) ?? 0) * Math.PI) / 180;
			const phase =
				tSec * ((selector.wigglesPerSecond as number) ?? 2.0) * 2 * Math.PI +
				temporalPhase +
				spatialPhase;
			const noise = deterministicWigglyNoise(
				(selector.randomSeed as number) ?? 42,
				glyph.charIndex ?? 0,
				phase,
				(selector.correlation as number) ?? 0.5,
			);
			const minAmt = (selector.minAmount as number) ?? -1.0;
			const maxAmt = (selector.maxAmount as number) ?? 1.0;
			currentWeight = minAmt + (noise * 0.5 + 0.5) * (maxAmt - minAmt);
		} else if (selector.type === "signal") {
			const rawSig = sampleSignalValue(
				signals,
				selector.signalId as string,
				frame,
				fps,
				(selector.phaseSpread as number) ?? 0,
				glyph.charIndex ?? 0,
			);
			currentWeight =
				rawSig * ((selector.multiplier as number) ?? 1.0) +
				((selector.offset as number) ?? 0.0);
		} else if (selector.type === "expression") {
			const exprSel = selector as unknown as ExpressionSelector;
			const time = fps > 0 ? frame / fps : 0;
			const ctx: ExpressionEvaluationContext = {
				charIndex: glyph.charIndex ?? 0,
				wordIndex: glyph.wordIndex ?? 0,
				lineIndex: glyph.lineIndex ?? 0,
				totalChars: charsCount,
				totalWords: wordsCount,
				totalLines: linesCount,
				frame,
				fps,
				time,
				signals,
			};
			const rawWeight = evaluateExpressionSelector(exprSel.expression, ctx);
			currentWeight = rawWeight * (exprSel.amount ?? 1.0);
		}

		if (sIdx === 0) {
			combinedWeight = currentWeight;
		} else {
			combinedWeight = evaluateSelectorCombination(
				combinedWeight,
				currentWeight,
				(selector.mode as SelectorMode) ?? "add",
			);
		}
	}

	return combinedWeight;
}

export function applyGlyphAnimators(
	animators:
		| (TextAnimator | AETextAnimator | AdvancedTextAnimator)[]
		| undefined,
	glyph: {
		charIndex?: number;
		wordIndex?: number;
		lineIndex?: number;
		unitIndex?: number;
		x?: number;
		y?: number;
	},
	counts: {
		charsCount?: number;
		wordsCount?: number;
		linesCount?: number;
		layoutCenter?: { x: number; y: number };
	},
	base: GlyphTransforms,
	isEmoji = false,
	frame = 0,
	fps = 24,
	signals?: Record<string, unknown>,
): GlyphTransforms {
	if (!animators || animators.length === 0) {
		return base;
	}

	let { transX, transY, rot, scale, scaleX, scaleY, opacity, blurAmount } =
		base;
	let transZ = base.transZ ?? 0;
	let color = base.color;
	let chromaticShift = base.chromaticShift ?? 0;
	let dissolveProgress = base.dissolveProgress ?? 0;
	const vfxParam = base.vfxParam ?? 0;
	let skewM01 = base.skewM01 ?? 0;
	let skewM10 = base.skewM10 ?? 0;
	let anchorConfig = base.anchorConfig;
	let fillOpacity = base.fillOpacity ?? 1.0;
	let strokeWidth = base.strokeWidth;
	let strokeColor = base.strokeColor;
	let longShadow = base.longShadow;
	let lineSpacing = base.lineSpacing;
	let lineAnchor = base.lineAnchor;

	const rotScale = isEmoji ? 1 : Math.PI / 180;
	const charsCount = Math.max(1, counts.charsCount ?? 1);
	const wordsCount = Math.max(1, counts.wordsCount ?? 1);
	const linesCount = Math.max(1, counts.linesCount ?? 1);

	for (const animator of animators) {
		if ("selectors" in animator && Array.isArray(animator.selectors)) {
			const aeAnim = animator as AETextAnimator | AdvancedTextAnimator;
			// Basic and advanced animators share one props bag; read it as both.
			const p = (aeAnim.props ?? {}) as ExtendedGlyphProperties &
				NonNullable<AETextAnimator["props"]>;
			const selectorWeight = evaluateAEAnimatorWeight(
				aeAnim,
				glyph,
				{ charsCount, wordsCount, linesCount },
				signals,
				frame,
				fps,
			);
			let combinedWeight = selectorWeight;

			let springWeight = 1.0;
			let springProgress = 1.0;
			if (p.spring) {
				const charDelay = (glyph.charIndex ?? 0) * 0.035;
				const tSec = Math.max(0, (fps > 0 ? frame / fps : 0) - charDelay);
				springProgress = evaluateSpringProgress(
					tSec,
					p.spring.stiffness,
					p.spring.damping,
					p.spring.mass,
					p.spring.initialVelocity,
				);
				springWeight = 1.0 - springProgress;
				combinedWeight = selectorWeight * springWeight;
			}

			if (combinedWeight !== 0 || selectorWeight !== 0) {
				if (p.x !== undefined) transX += p.x * combinedWeight;
				if (p.y !== undefined) transY += p.y * combinedWeight;
				if (p.scale !== undefined) scale *= 1 + (p.scale - 1) * combinedWeight;
				if (p.scaleX !== undefined)
					scaleX *= 1 + (p.scaleX - 1) * combinedWeight;
				if (p.scaleY !== undefined)
					scaleY *= 1 + (p.scaleY - 1) * combinedWeight;
				if (p.rotation !== undefined)
					rot += p.rotation * rotScale * combinedWeight;
				if (p.rotationX !== undefined) {
					const rotXRad = (p.rotationX * combinedWeight * Math.PI) / 180;
					scaleY *= Math.max(0.08, Math.abs(Math.cos(rotXRad)));
				}
				if (p.rotationY !== undefined) {
					const rotYRad = (p.rotationY * combinedWeight * Math.PI) / 180;
					scaleX *= Math.max(0.08, Math.abs(Math.cos(rotYRad)));
				}
				if (p.rotationZ !== undefined) {
					rot += p.rotationZ * rotScale * combinedWeight;
				}
				if (p.translateZ !== undefined) {
					transZ += p.translateZ * combinedWeight;
				}
				if (p.skew !== undefined) {
					const [, m01, m10] = evaluateSkewMatrix(
						p.skew * combinedWeight,
						p.skewAxis ?? 0,
					);
					skewM01 += m01;
					skewM10 += m10;
				}
				if (p.formation !== undefined) {
					const v3d = evaluateVolumetricFormation(
						glyph.charIndex ?? 0,
						charsCount,
						p.formation,
					);
					const centerX = counts.layoutCenter?.x ?? 0;
					const centerY = counts.layoutCenter?.y ?? 0;
					const glyphFlatX = glyph.x ?? 0;
					const glyphFlatY = glyph.y ?? 0;
					const targetX = centerX + v3d.x;
					const targetY = centerY + v3d.y;

					transX += (targetX - glyphFlatX) * combinedWeight;
					transY += (targetY - glyphFlatY) * combinedWeight;
					transZ += v3d.z * combinedWeight;

					if (v3d.rotX) {
						const rotXRad = (v3d.rotX * combinedWeight * Math.PI) / 180;
						scaleY *= Math.max(0.5, Math.abs(Math.cos(rotXRad)));
					}
					if (v3d.rotY) {
						const rotYRad = (v3d.rotY * combinedWeight * Math.PI) / 180;
						scaleX *= Math.max(0.5, Math.abs(Math.cos(rotYRad)));
					}
					if (v3d.rotZ) {
						rot += ((v3d.rotZ * Math.PI) / 180) * combinedWeight;
					}
					if (v3d.depthOpacity !== undefined) {
						opacity *= 1 + (v3d.depthOpacity - 1) * combinedWeight;
					}
				}
				if (p.anchor !== undefined) {
					anchorConfig = p.anchor;
				}
				if (p.opacity !== undefined) {
					opacity *= 1 + (p.opacity - 1) * combinedWeight;
				}
				if (p.blur !== undefined) {
					blurAmount = Math.max(blurAmount, p.blur * combinedWeight);
				}
				if (p.chromaticGlitch !== undefined) {
					let shift =
						(p.chromaticGlitch.redShiftX ?? 0) * Math.max(0, combinedWeight);
					const sliceProb = p.chromaticGlitch.sliceProbability ?? 0.35;
					const n = Math.sin(frame * 17.13 + (glyph.charIndex ?? 0) * 43.17);
					const frac = Math.abs(n - Math.floor(n));
					if (frac < sliceProb) {
						shift += (p.chromaticGlitch.sliceAmplitude ?? 12) * (frac * 2 - 1);
					}
					chromaticShift += shift;
				}
				if (p.particleDissolve !== undefined) {
					dissolveProgress = Math.max(
						dissolveProgress,
						(p.particleDissolve.progress ?? 0) *
							(p.spring ? springProgress : Math.max(0, combinedWeight)),
					);
				}
				if (p.longShadow !== undefined) {
					longShadow = p.longShadow;
				}
				if (p.audioSpectrum !== undefined) {
					const specScale = sampleAudioSpectrumScale(
						glyph.charIndex ?? 0,
						charsCount,
						p.audioSpectrum,
						signals,
						frame,
						fps,
					);
					if (p.audioSpectrum.scaleAxis === "scaleY") scaleY *= specScale;
					else if (p.audioSpectrum.scaleAxis === "scaleX") scaleX *= specScale;
					else scale *= specScale;
				}
				if (p.stroke !== undefined) {
					if (p.stroke.fillOpacity !== undefined)
						fillOpacity *=
							1 - combinedWeight + p.stroke.fillOpacity * combinedWeight;
					if (p.stroke.strokeWidth !== undefined)
						strokeWidth = (p.stroke.strokeWidth ?? 0) * combinedWeight;
					if (p.stroke.strokeColor) strokeColor = p.stroke.strokeColor;
				}
				if (p.lineSpacing !== undefined) {
					lineSpacing =
						p.lineSpacing * (p.spring ? springProgress : combinedWeight);
					lineAnchor = p.lineAnchor ?? 0;
				}
				if (p.fillColor) {
					const targetCol = parseColor(p.fillColor);
					const currentColor = color ?? { r: 1, g: 1, b: 1, a: 1 };
					const colorWeight = selectorWeight;
					color = {
						r: currentColor.r * (1 - colorWeight) + targetCol.r * colorWeight,
						g: currentColor.g * (1 - colorWeight) + targetCol.g * colorWeight,
						b: currentColor.b * (1 - colorWeight) + targetCol.b * colorWeight,
						a: currentColor.a * (1 - colorWeight) + targetCol.a * colorWeight,
					};
				}
			}
		} else {
			const legacyAnim = animator as TextAnimator;
			let unitIdx = glyph.charIndex ?? glyph.unitIndex ?? 0;
			let numUnits = Math.max(1, counts.charsCount ?? 1);
			if (legacyAnim.unit === "word") {
				unitIdx = glyph.wordIndex ?? 0;
				numUnits = Math.max(1, counts.wordsCount ?? 1);
			} else if (legacyAnim.unit === "line") {
				unitIdx = glyph.lineIndex ?? 0;
				numUnits = Math.max(1, counts.linesCount ?? 1);
			}

			const tc = computeAnimatorProgress(legacyAnim, unitIdx, numUnits);
			const t = legacyAnim.transform;
			if (!t || tc <= 0) continue;

			if (t.x !== undefined) transX += t.x * tc;
			if (t.y !== undefined) transY += t.y * tc;
			if (t.rotation !== undefined) rot += t.rotation * rotScale * tc;
			if (t.scale !== undefined) scale *= 1 + (t.scale - 1) * tc;
			if (t.scaleX !== undefined) scaleX *= 1 + (t.scaleX - 1) * tc;

			let scaleYFactor = 1 + ((t.scaleY ?? 1) - 1) * tc;
			if (t.rotationX) {
				const rotXRad = (t.rotationX * tc * Math.PI) / 180;
				scaleYFactor *= Math.cos(rotXRad);
			}
			scaleY *= scaleYFactor;

			if (t.opacity !== undefined) {
				opacity *= 1 + (t.opacity - 1) * tc;
			}
			if (t.blur !== undefined) {
				blurAmount = Math.max(blurAmount, t.blur * tc);
			}
			if (t.color) {
				const targetCol = parseColor(t.color);
				const currentColor = color ?? { r: 1, g: 1, b: 1, a: 1 };
				color = {
					r: currentColor.r * (1 - tc) + targetCol.r * tc,
					g: currentColor.g * (1 - tc) + targetCol.g * tc,
					b: currentColor.b * (1 - tc) + targetCol.b * tc,
					a: currentColor.a * (1 - tc) + targetCol.a * tc,
				};
			}
		}
	}

	return {
		transX,
		transY,
		transZ,
		rot,
		scale,
		scaleX,
		scaleY,
		opacity: Math.max(0, Math.min(1, opacity)),
		blurAmount,
		color,
		chromaticShift,
		dissolveProgress,
		vfxParam,
		skewM01,
		skewM10,
		anchorConfig,
		fillOpacity: Math.max(0, Math.min(1, fillOpacity)),
		strokeWidth,
		strokeColor,
		longShadow,
		lineSpacing,
		lineAnchor,
	};
}

export function drawParagraphNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: ParagraphNodeProps,
): void {
	let fontFamily = props.fontFamily ?? "Inter";
	if (SlugFontCache.isFailed(fontFamily)) {
		fontFamily = "Inter";
	}
	if (SlugFontCache.isFailed(fontFamily)) {
		return;
	}

	const fontSize = props.fontSize ?? 48;
	const slugFont = SlugFontCache.getFont(
		fontFamily,
		props.fontWeight,
		ctx.device,
		undefined,
		fontSize,
		props.variableAxes,
	);

	const hasStroke = props.stroke && props.strokeWidth && props.strokeWidth > 0;
	let strokeFont: SlugFont | null = null;

	if (slugFont && hasStroke && ctx.device) {
		const alignMultiplier = props.strokeAlign === "outside" ? 2.0 : 1.0;
		const effectiveStrokeWidth = (props.strokeWidth ?? 0) * alignMultiplier;
		const strokeWidthInFontUnits =
			effectiveStrokeWidth * (slugFont.unitsPerEm / fontSize);

		strokeFont =
			SlugFontCache.getFont(
				fontFamily,
				props.fontWeight,
				ctx.device,
				strokeWidthInFontUnits,
				fontSize,
				props.variableAxes,
			) ?? null;
	}

	if (!slugFont?.curvesTex || (hasStroke && !strokeFont?.curvesTex)) {
		const fontUrl = GetFontAssetUrl(fontFamily);
		SlugFontCache.preloadSlugFont(
			ctx.device,
			fontFamily,
			fontUrl,
			undefined,
			props.renderId,
		).catch((err) => {
			console.warn(
				`[drawParagraphNode] Failed to load Slug font for ${fontFamily}:`,
				err,
			);
		});
		return;
	}

	const letterSpacing = props.letterSpacing ?? 0;
	const lineHeight =
		props.lineHeight !== undefined && props.lineHeight < 10
			? props.lineHeight * fontSize
			: (props.lineHeight ?? fontSize * 1.2);
	const align = props.align ?? "left";

	const padding = props.isCaption
		? 0
		: props.textBackgroundColor
			? (props.padding ?? 0)
			: 0;

	// Typewriter handling
	let textToRender = props.text;
	let twState: ReturnType<typeof evaluateTypewriterState> | undefined;
	if (props.typewriter) {
		const compFps = props.fps ?? 24;
		const totalDurationFrames =
			props.durationMs !== undefined
				? Math.round((props.durationMs / 1000) * compFps)
				: 60;
		twState = evaluateTypewriterState(
			props.text,
			props.frame ?? 0,
			0,
			totalDurationFrames,
			props.typewriter.cadence,
			props.typewriter.scramble,
			props.typewriter.cursor?.blinkFrequency ?? 2.0,
			props.typewriter.granularity ?? "character",
			props.textProgress,
		);
		textToRender = twState.currentDisplayString;
	}

	// Path-following options resolution with animated margin/shift properties
	const pathOptions = props.pathOptions
		? {
				...props.pathOptions,
				firstMargin:
					props.firstMargin !== undefined
						? props.firstMargin
						: props.pathOptions.firstMargin,
				lastMargin:
					props.lastMargin !== undefined
						? props.lastMargin
						: props.pathOptions.lastMargin,
				baselineShift:
					props.baselineShift !== undefined
						? props.baselineShift
						: props.pathOptions.baselineShift,
			}
		: undefined;

	let maxWidth: number;
	let measured: { width: number; height: number; layout?: SlugLayoutResult };

	if (props.width != null) {
		maxWidth = Math.max(0, props.width - padding * 2);
		measured = SlugGeometry.measure(
			textToRender,
			slugFont,
			fontSize,
			letterSpacing,
			lineHeight,
			maxWidth,
			props.spans,
		);
	} else {
		measured = SlugGeometry.measure(
			textToRender,
			slugFont,
			fontSize,
			letterSpacing,
			lineHeight,
			undefined,
			props.spans,
		);
		maxWidth = measured.width;
	}

	const alignWidth = props.isCaption ? props.dstRect.width : maxWidth;
	const animApplyBy = props.animation?.applyBy ?? "word";
	const canReuseMeasured =
		align === "left" &&
		(alignWidth === undefined || alignWidth === maxWidth) &&
		!pathOptions &&
		animApplyBy === "word" &&
		Boolean(measured?.layout);

	const layout =
		canReuseMeasured && measured.layout
			? measured.layout
			: SlugGeometry.layout(
					textToRender,
					slugFont,
					fontSize,
					letterSpacing,
					lineHeight,
					maxWidth,
					align,
					animApplyBy,
					alignWidth,
					pathOptions,
					props.spans,
				);
	// verticalAlign places the text block inside a box taller than it (CSS
	// line-box centring). Path text follows its path; captions place themselves.
	const vAlign = props.verticalAlign ?? "top";
	const slack =
		props.height != null && !pathOptions && !props.isCaption
			? props.height - (measured.height + padding * 2)
			: 0;
	const textRect = {
		...props.dstRect,
		y:
			props.dstRect.y +
			(vAlign === "middle" ? slack / 2 : vAlign === "bottom" ? slack : 0),
	};
	const anim = props.animation;
	const isBold =
		props.fontWeight === "bold" ||
		(typeof props.fontWeight === "number" && props.fontWeight >= 600) ||
		(typeof props.fontWeight === "string" &&
			parseInt(props.fontWeight, 10) >= 600);
	// Only use synthetic bolding if the font does not support true weight variations
	const hasTrueWeight =
		"hasTrueWeight" in slugFont &&
		Boolean((slugFont as { hasTrueWeight?: boolean }).hasTrueWeight);

	let fillFont = slugFont;
	if (isBold && !hasTrueWeight && ctx.device) {
		const numericWeight = parseFontWeight(props.fontWeight);
		const emboldenPx =
			Math.max(0, (numericWeight - 400) / 500) * 0.055 * fontSize;
		if (emboldenPx > 0) {
			const strokeFontUnits = emboldenPx * (slugFont.unitsPerEm / fontSize);
			const dilated = SlugFontCache.getFont(
				fontFamily,
				400,
				ctx.device,
				strokeFontUnits,
				fontSize,
				props.variableAxes,
			);
			if (dilated?.curvesTex) {
				fillFont = dilated;
			}
		}
	}
	const instanceCount = layout.glyphs.length;

	const elapsed =
		props.elapsedMs !== undefined
			? props.elapsedMs
			: props.frame !== undefined && props.fps !== undefined
				? (props.frame / props.fps) * 1000
				: 0;
	const duration = props.durationMs !== undefined ? props.durationMs : 3000;

	const entranceMs = props.isCaption
		? anim?.in === "none" || !anim?.in
			? 0
			: duration
		: anim?.entranceMs
			? anim.entranceMs
			: anim?.in === "none" || !anim?.in
				? 0
				: duration;
	const exitMs = props.isCaption
		? 0
		: anim?.exitMs
			? anim.exitMs
			: anim?.out === "none" || !anim?.out
				? 0
				: duration;

	const transitionIn = anim?.in || "none";
	const transitionOut = anim?.out || "none";
	const kinetic = anim?.kinetic || "none";
	const smoothing = anim?.smoothing !== false;

	let maxUnitIndex = 0;
	for (const g of layout.glyphs) {
		if (!g.isSpace && g.unitIndex > maxUnitIndex) {
			maxUnitIndex = g.unitIndex;
		}
	}
	const totalUnits = maxUnitIndex + 1;

	const perm =
		kinetic === "shuffle" || transitionIn === "shuffle"
			? getShuffleOrder(totalUnits, props.text)
			: Array.from({ length: totalUnits }, (_, i) => i);

	// 1. Draw background color if present
	if (props.textBackgroundColor) {
		const strokeRadius = props.strokeRadius ?? props.borderRadius ?? 8;
		let maxParagraphOpacity = 0;
		const baseOpacity = props.opacity ?? 1.0;

		if (props.isVideoMode === false) {
			maxParagraphOpacity = baseOpacity;
		} else {
			for (const glyph of layout.glyphs) {
				if (glyph.isSpace) continue;
				const unitIdx = glyph.unitIndex;
				const idx_i = perm[unitIdx] ?? unitIdx;
				const { p_in, p_out } = computeUnitProgress(
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					totalUnits,
					true,
				);
				const effect = applyAnimationEffects(
					p_in,
					p_out,
					smoothing,
					transitionIn,
					transitionOut,
					kinetic,
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					baseOpacity,
					false,
				);
				if (effect.visible && effect.opacity > maxParagraphOpacity) {
					maxParagraphOpacity = effect.opacity;
				}
			}
			for (const emoji of layout.emojis) {
				const emojiUnitIdx =
					props.animation?.applyBy === "line"
						? 0
						: Math.floor(emoji.x / (fontSize + letterSpacing));
				const idx_i = perm[emojiUnitIdx % totalUnits] ?? 0;
				const { p_in, p_out } = computeUnitProgress(
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					totalUnits,
					true,
				);
				const effect = applyAnimationEffects(
					p_in,
					p_out,
					smoothing,
					transitionIn,
					transitionOut,
					kinetic,
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					baseOpacity,
					true,
				);
				if (effect.visible && effect.opacity > maxParagraphOpacity) {
					maxParagraphOpacity = effect.opacity;
				}
			}
		}

		if (maxParagraphOpacity > 0.001) {
			const rectWidth =
				props.width != null ? props.width : measured.width + padding * 2;
			const rectHeight =
				props.height != null ? props.height : measured.height + padding * 2;

			ctx.renderer.drawRRect(
				pass,
				{
					rect: {
						x: props.dstRect.x,
						y: props.dstRect.y,
						width: rectWidth,
						height: rectHeight,
					},
					rx: strokeRadius,
					ry: strokeRadius,
				},
				props.textBackgroundColor,
				{ opacity: maxParagraphOpacity },
			);
		}
	}

	// Draw mark highlight pills if present in layout
	if (layout.marks && layout.marks.length > 0) {
		for (const m of layout.marks) {
			const rx = m.borderRadius ?? 4;
			ctx.renderer.drawRRect(
				pass,
				{
					rect: {
						x: props.dstRect.x + padding + m.x,
						y: textRect.y + padding + m.y,
						width: m.width,
						height: m.height,
					},
					rx,
					ry: rx,
				},
				m.background,
				{ opacity: props.opacity ?? 1.0 },
			);
		}
	}

	const baseColor = parseColor(props.color ?? "white");
	const highlightColor = parseColor(props.highlightColor ?? "yellow");

	// Pre-compute cumulative tracking shifts across glyphs per line
	const trackingShifts = new Float32Array(layout.glyphs.length);
	let layoutCenterX = 0;
	let layoutCenterY = 0;
	if (layout.glyphs.length > 0) {
		const nonSpace = layout.glyphs.filter((g) => !g.isSpace);
		if (nonSpace.length > 0) {
			layoutCenterX = (nonSpace[0].x + nonSpace[nonSpace.length - 1].x) / 2;
			layoutCenterY = (nonSpace[0].y + nonSpace[nonSpace.length - 1].y) / 2;
		}
	}
	const counts = {
		charsCount: layout.charsCount,
		wordsCount: layout.wordsCount,
		linesCount: layout.linesCount,
		layoutCenter: { x: layoutCenterX, y: layoutCenterY },
	};

	if (props.animators && props.animators.length > 0) {
		for (const anim of props.animators) {
			if (
				"selectors" in anim &&
				Array.isArray((anim as AETextAnimator).selectors)
			) {
				const aeAnim = anim as AETextAnimator;
				if (
					aeAnim.props?.tracking !== undefined &&
					aeAnim.props.tracking !== 0
				) {
					const trackingAmount = aeAnim.props.tracking;

					// Group glyphs by line
					const lineGlyphIndices = new Map<number, number[]>();
					for (let gIdx = 0; gIdx < layout.glyphs.length; gIdx++) {
						const g = layout.glyphs[gIdx];
						const lIdx = g.lineIndex ?? 0;
						let list = lineGlyphIndices.get(lIdx);
						if (!list) {
							list = [];
							lineGlyphIndices.set(lIdx, list);
						}
						list.push(gIdx);
					}

					for (const indices of lineGlyphIndices.values()) {
						const weights: number[] = [];
						for (const gIdx of indices) {
							const g = layout.glyphs[gIdx];
							const w = evaluateAEAnimatorWeight(
								aeAnim,
								g,
								counts,
								props.signals,
								props.frame ?? 0,
								props.fps ?? 24,
							);
							weights.push(w);
						}

						let totalLineShift = 0;
						for (let k = 0; k < indices.length - 1; k++) {
							totalLineShift += trackingAmount * weights[k];
						}

						let cumShift = 0;
						for (let k = 0; k < indices.length; k++) {
							const gIdx = indices[k];
							let shift = cumShift;
							if (align === "center") {
								shift -= totalLineShift * 0.5;
							} else if (align === "right" || align === "end") {
								shift -= totalLineShift;
							}
							trackingShifts[gIdx] += shift;
							if (k < indices.length - 1) {
								cumShift += trackingAmount * weights[k];
							}
						}
					}
				}
			}
		}
	}

	let scratchData = new Float32Array(Math.max(1024, instanceCount * 24));

	const buildInstanceData = (
		targetFont: SlugFont,
		colorOverride?: Color,
		offsetX = 0,
		offsetY = 0,
		blurOverride?: number,
		fontFilter?: (g: SlugGlyphLayout) => boolean,
	) => {
		const requiredLen = instanceCount * 24;
		if (scratchData.length < requiredLen) {
			scratchData = new Float32Array(requiredLen);
		}
		const data = scratchData;
		let visibleCount = 0;

		for (let i = 0; i < layout.glyphs.length; i++) {
			const glyph = layout.glyphs[i];

			if (glyph.isSpace) {
				continue;
			}
			if (fontFilter && !fontFilter(glyph)) {
				continue;
			}

			const cp = targetFont.codePoints.get(glyph.cp.codePoint) || glyph.cp;
			if (!cp || cp.width === 0 || cp.height === 0) {
				continue;
			}

			const unitIdx = glyph.unitIndex;
			const idx_i = perm[unitIdx] ?? unitIdx;

			let opacity = props.opacity ?? 1.0;
			let transX = 0;
			let transY = 0;
			let rot = 0;
			let scale = 1.0;
			let blurAmount = blurOverride !== undefined ? blurOverride : 0.0;

			if (props.isVideoMode !== false) {
				const { p_in, p_out } = computeUnitProgress(
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					totalUnits,
					true,
				);
				const effect = applyAnimationEffects(
					p_in,
					p_out,
					smoothing,
					transitionIn,
					transitionOut,
					kinetic,
					elapsed,
					duration,
					entranceMs,
					exitMs,
					idx_i,
					props.opacity ?? 1.0,
					false,
				);
				if (!effect.visible) {
					continue;
				}
				opacity = effect.opacity;
				transX = effect.transX;
				transY = effect.transY;
				rot = effect.rot;
				scale = effect.scale;
				if (blurOverride === undefined) {
					blurAmount = effect.blurAmount;
				}
			}

			let customScaleX = 1.0;
			let customScaleY = 1.0;
			let animatorColor: Color | undefined;
			let transZ = 0;
			let chromaticShift = 0;
			let dissolveProgress = 0;
			let vfxParam = 0;
			let skewM01 = 0;
			let skewM10 = 0;
			let anchorConfig: TextAnchorConfig | undefined;
			let fillOpacity = 1.0;

			if (props.animators && props.animators.length > 0) {
				const kResult = applyGlyphAnimators(
					props.animators,
					glyph,
					counts,
					{
						transX,
						transY,
						rot,
						scale,
						scaleX: customScaleX,
						scaleY: customScaleY,
						opacity,
						blurAmount,
						color: baseColor,
					},
					false,
					props.frame ?? 0,
					props.fps ?? 24,
					props.signals,
				);
				transX = kResult.transX;
				transY = kResult.transY;
				rot = kResult.rot;
				scale = kResult.scale;
				customScaleX = kResult.scaleX;
				customScaleY = kResult.scaleY;
				opacity = kResult.opacity;
				if (blurOverride === undefined) {
					blurAmount = kResult.blurAmount;
				}
				if (kResult.color) {
					animatorColor = kResult.color;
				}
				if (kResult.lineSpacing !== undefined) {
					transY += computeLineLeadingDisplacement(
						glyph.lineIndex,
						layout.linesCount,
						kResult.lineSpacing,
						kResult.lineAnchor ?? 0,
					);
				}
				transZ = kResult.transZ ?? 0;
				chromaticShift = kResult.chromaticShift ?? 0;
				dissolveProgress = kResult.dissolveProgress ?? 0;
				vfxParam = kResult.vfxParam ?? 0;
				skewM01 = kResult.skewM01 ?? 0;
				skewM10 = kResult.skewM10 ?? 0;
				anchorConfig = kResult.anchorConfig;
				fillOpacity = kResult.fillOpacity ?? 1.0;
			}

			transX += trackingShifts[i];

			let glyphX = glyph.x;
			if (props.marquee) {
				const elapsedSec = (props.frame ?? 0) / (props.fps ?? 24);
				const contentWidth =
					layout.glyphs.length > 0
						? layout.glyphs[layout.glyphs.length - 1].x + fontSize
						: props.dstRect.width;
				glyphX = evaluateMarqueeOffset(
					glyph.x,
					props.dstRect.width,
					contentWidth,
					props.marquee,
					elapsedSec,
				);
			}

			const isHighlighted =
				props.highlightWordIndex !== undefined &&
				glyph.wordIndex === props.highlightWordIndex;
			const spanColor = glyph.fill ? parseColor(glyph.fill) : undefined;
			const col =
				animatorColor ??
				colorOverride ??
				(isHighlighted ? highlightColor : (spanColor ?? baseColor));

			const writeInstance = (boldShift: number) => {
				const offset = visibleCount * 24;
				const fontScale = glyph.fontScale ?? fontSize / targetFont.unitsPerEm;
				let scaleX = ((cp.width * fontScale) / 2.0) * customScaleX;
				let scaleY = ((cp.height * fontScale) / 2.0) * customScaleY;

				if (transZ !== 0) {
					const perspective = 1200;
					const depth = Math.max(100, perspective - transZ);
					const pScale = depth > 1 ? perspective / depth : 1;
					scaleX *= pScale;
					scaleY *= pScale;
				}

				const finalRot = rot + (glyph.pathTangentAngleRad ?? 0);

				let biasX: number;
				let biasY: number;

				if (glyph.pathTangentAngleRad !== undefined) {
					const r0x = cp.bearingX * fontScale + scaleX;
					const r0y = -cp.bearingY * fontScale + scaleY;
					const cosT = Math.cos(finalRot);
					const sinT = Math.sin(finalRot);
					const rotatedR0x = r0x * cosT - r0y * sinT;
					const rotatedR0y = r0x * sinT + r0y * cosT;
					biasX =
						glyphX +
						rotatedR0x +
						props.dstRect.x +
						padding +
						offsetX +
						boldShift;
					biasY = glyph.y + rotatedR0y + textRect.y + padding + offsetY;
				} else {
					biasX =
						glyphX +
						cp.bearingX * fontScale +
						scaleX +
						props.dstRect.x +
						padding +
						offsetX +
						boldShift;
					biasY =
						glyph.y -
						cp.bearingY * fontScale +
						scaleY +
						textRect.y +
						padding +
						offsetY;
				}

				if (anchorConfig) {
					const bbox = {
						width: cp.width * fontScale,
						height: cp.height * fontScale,
						ascender: (targetFont.ascender ?? 800) * fontScale,
						descender: (targetFont.descender ?? -200) * fontScale,
					};
					const pivot = computeAnchorPivotOffset(bbox, anchorConfig);
					const cosR = Math.cos(finalRot);
					const sinR = Math.sin(finalRot);
					const pivotShiftX =
						pivot.px * (1 - cosR * scale) + pivot.py * (sinR * scale);
					const pivotShiftY =
						-pivot.px * (sinR * scale) + pivot.py * (1 - cosR * scale);
					biasX += pivotShiftX;
					biasY += pivotShiftY;
				}

				if (skewM01 !== 0 || skewM10 !== 0) {
					biasX += scaleY * skewM01;
					biasY += scaleX * skewM10;
				}

				data[offset + 0] = scaleX;
				data[offset + 1] = scaleY;
				data[offset + 2] = biasX;
				data[offset + 3] = biasY;

				data[offset + 4] = cp.width;
				data[offset + 5] = cp.height;
				data[offset + 6] = cp.width / cp.bandDimX;
				data[offset + 7] = cp.height / cp.bandDimY;

				data[offset + 8] = cp.bandCount - 1;
				data[offset + 9] = cp.bandCount - 1;
				data[offset + 10] = cp.bandsTexCoordX;
				data[offset + 11] = cp.bandsTexCoordY;

				data[offset + 12] = finalRot;
				data[offset + 13] = scale;
				data[offset + 14] = transX;
				data[offset + 15] = transY;

				data[offset + 16] = col.r;
				data[offset + 17] = col.g;
				data[offset + 18] = col.b;
				const spanOpacity = glyph.opacity ?? 1.0;
				data[offset + 19] = col.a * opacity * fillOpacity * spanOpacity;

				data[offset + 20] = blurAmount;
				data[offset + 21] = chromaticShift;
				data[offset + 22] = dissolveProgress;
				data[offset + 23] = vfxParam;

				visibleCount++;
			};

			writeInstance(0);
		}

		return { data, visibleCount };
	};

	// 2. Draw shadows first (in order)
	if (props.shadows && props.shadows.length > 0) {
		for (const shadow of props.shadows) {
			const shadowColor = parseColor(shadow.color);
			const dx = shadow.offset?.x ?? 0;
			const dy = shadow.offset?.y ?? 0;
			const blur = shadow.blurRadius ?? 0;
			const { data: shadowData, visibleCount: shadowVisibleCount } =
				buildInstanceData(fillFont, shadowColor, dx, dy, blur);
			if (shadowVisibleCount > 0) {
				const drawInstances = shadowData.subarray(0, shadowVisibleCount * 24);
				const isItalic = props.fontStyle === "italic";
				const slant = isItalic ? 0.21 : 0.0;
				ctx.renderer.slugPipeline.draw(
					pass,
					ctx.renderer.getTransformStack(),
					fillFont,
					drawInstances,
					shadowVisibleCount,
					shadow.color,
					ctx.renderer.getSurfaceWidth(),
					ctx.renderer.getSurfaceHeight(),
					{
						opacity: props.opacity ?? 1,
						transform: props.matrix,
						customParam: slant,
					},
				);
			}
		}
	}

	// 2.2 Draw Long Shadow extrusion slices (if specified in animators)
	const longShadowAnim = props.animators?.find(
		(a) =>
			"props" in a &&
			(a as { props?: ExtendedGlyphProperties }).props?.longShadow &&
			((a as { props?: ExtendedGlyphProperties }).props?.longShadow?.length ??
				0) > 0,
	);
	if (longShadowAnim && "props" in longShadowAnim) {
		const animObj = longShadowAnim as { props: ExtendedGlyphProperties };
		const ls = animObj.props?.longShadow;
		if (ls) {
			const spProp = animObj.props?.spring;
			let length = ls.length;
			let angle = ls.angle;
			if (spProp) {
				const elapsed = (props.frame ?? 0) / (props.fps ?? 30);
				const sp = evaluateSpringProgress(
					elapsed,
					spProp.stiffness,
					spProp.damping,
					spProp.mass,
					spProp.initialVelocity,
				);
				length = Math.max(0, ls.length * sp);
				angle = ls.angle + (1 - Math.min(1, sp)) * 25;
			} else {
				const progress = Math.min(1.0, (props.frame ?? 0) / 36);
				const easeOut = 1 - (1 - progress) ** 3;
				length = ls.length * easeOut;
			}
			const rad = (angle * Math.PI) / 180;
			const totalSteps = Math.max(4, Math.min(64, ls.steps ?? 16));
			const stepLen = length / totalSteps;
			const shadowCol = parseColor(ls.color ?? "#000000");

			for (let s = 1; s <= totalSteps; s++) {
				const dist = s * stepLen;
				const sx = dist * Math.cos(rad);
				const sy = dist * Math.sin(rad);
				const t = s / totalSteps;
				const stepOpacity =
					(ls.startOpacity ?? 0.8) * (1 - t) + (ls.endOpacity ?? 0.0) * t;
				const sliceColor: Color = {
					...shadowCol,
					a: shadowCol.a * stepOpacity,
				};

				const { data: sliceData, visibleCount: sliceCount } = buildInstanceData(
					slugFont,
					sliceColor,
					sx,
					sy,
					0,
				);
				if (sliceCount > 0) {
					const drawInstances = sliceData.subarray(0, sliceCount * 24);
					const isItalic = props.fontStyle === "italic";
					const slant = isItalic ? 0.21 : 0.0;
					ctx.renderer.slugPipeline.draw(
						pass,
						ctx.renderer.getTransformStack(),
						fillFont,
						drawInstances,
						sliceCount,
						ls.color ?? "black",
						ctx.renderer.getSurfaceWidth(),
						ctx.renderer.getSurfaceHeight(),
						{
							opacity: (props.opacity ?? 1) * stepOpacity,
							transform: props.matrix,
							customParam: slant,
						},
					);
				}
			}
		}
	}

	// 2.5. Draw stroke pass (drawn below fill but above shadow)
	if (hasStroke && strokeFont) {
		const strokeColor = parseColor(props.stroke);
		const { data: strokeData, visibleCount: strokeVisibleCount } =
			buildInstanceData(strokeFont, strokeColor);
		if (strokeVisibleCount > 0) {
			const drawInstances = strokeData.subarray(0, strokeVisibleCount * 24);
			const isItalic = props.fontStyle === "italic";
			const slant = isItalic ? 0.21 : 0.0;
			ctx.renderer.slugPipeline.draw(
				pass,
				ctx.renderer.getTransformStack(),
				strokeFont,
				drawInstances,
				strokeVisibleCount,
				props.stroke ?? "#000000",
				ctx.renderer.getSurfaceWidth(),
				ctx.renderer.getSurfaceHeight(),
				{
					opacity: props.opacity ?? 1,
					transform: props.matrix,
					customParam: slant,
				},
			);
		}
	}

	// 3. Draw main text
	const uniqueFonts = new Set<SlugFont>();
	let hasMultiFonts = false;
	for (const g of layout.glyphs) {
		if (g.font && g.font !== fillFont) {
			uniqueFonts.add(g.font);
			hasMultiFonts = true;
		}
	}

	const isItalic = props.fontStyle === "italic";
	const slant = isItalic ? 0.21 : 0.0;

	if (hasMultiFonts) {
		uniqueFonts.add(fillFont);
		for (const currentFont of uniqueFonts) {
			if (ctx.device && !currentFont.curvesTex) {
				SlugFontCache.ensureTextures(ctx.device, currentFont);
			}
			if (!currentFont.curvesTex) {
				continue;
			}
			const { data: fontData, visibleCount: fontVisibleCount } =
				buildInstanceData(
					currentFont,
					undefined,
					0,
					0,
					undefined,
					(g) => (g.font ?? fillFont) === currentFont,
				);
			if (fontVisibleCount > 0) {
				const drawInstances = fontData.subarray(0, fontVisibleCount * 24);
				ctx.renderer.slugPipeline.draw(
					pass,
					ctx.renderer.getTransformStack(),
					currentFont,
					drawInstances,
					fontVisibleCount,
					props.color ?? "white",
					ctx.renderer.getSurfaceWidth(),
					ctx.renderer.getSurfaceHeight(),
					{
						opacity: props.opacity ?? 1,
						transform: props.matrix,
						customParam: slant,
					},
				);
			}
		}
	} else {
		const { data: mainData, visibleCount: mainVisibleCount } =
			buildInstanceData(fillFont);
		if (mainVisibleCount > 0) {
			const drawInstances = mainData.subarray(0, mainVisibleCount * 24);
			ctx.renderer.slugPipeline.draw(
				pass,
				ctx.renderer.getTransformStack(),
				fillFont,
				drawInstances,
				mainVisibleCount,
				props.color ?? "white",
				ctx.renderer.getSurfaceWidth(),
				ctx.renderer.getSurfaceHeight(),
				{
					opacity: props.opacity ?? 1,
					transform: props.matrix,
					customParam: slant,
				},
			);
		}
	}

	for (const emoji of layout.emojis) {
		const emojiUnitIdx =
			props.animation?.applyBy === "line"
				? 0
				: Math.floor(emoji.x / (fontSize + letterSpacing));
		const idx_i = perm[emojiUnitIdx % totalUnits] ?? 0;

		let opacity = props.opacity ?? 1.0;
		let transX = 0;
		let transY = 0;
		let rot = 0;
		let scale = 1.0;

		if (props.isVideoMode !== false) {
			const { p_in, p_out } = computeUnitProgress(
				elapsed,
				duration,
				entranceMs,
				exitMs,
				idx_i,
				totalUnits,
				true,
			);
			const effect = applyAnimationEffects(
				p_in,
				p_out,
				smoothing,
				transitionIn,
				transitionOut,
				kinetic,
				elapsed,
				duration,
				entranceMs,
				exitMs,
				idx_i,
				props.opacity ?? 1.0,
				true,
			);
			if (!effect.visible) {
				continue;
			}
			opacity = effect.opacity;
			transX = effect.transX;
			transY = effect.transY;
			rot = effect.rot;
			scale = effect.scale;
		}

		if (props.animators && props.animators.length > 0) {
			const kResult = applyGlyphAnimators(
				props.animators,
				{ charIndex: emojiUnitIdx, wordIndex: 0, lineIndex: emoji.lineIndex },
				{
					charsCount: layout.charsCount,
					wordsCount: layout.wordsCount,
					linesCount: layout.linesCount,
				},
				{
					transX,
					transY,
					rot,
					scale,
					scaleX: 1,
					scaleY: 1,
					opacity,
					blurAmount: 0,
				},
				true,
			);
			transX = kResult.transX;
			transY = kResult.transY;
			rot = kResult.rot;
			scale = kResult.scale;
			opacity = kResult.opacity;
		}

		const emojiTex = getOrCreateEmojiTexture(
			ctx.device,
			emoji.char,
			emoji.size,
		);

		const localEmojiSize = emoji.size * 1.5;
		const offsetAdjustment = (localEmojiSize - emoji.size) / 2;

		const emojiDstRect = {
			x: props.dstRect.x + emoji.x + padding - offsetAdjustment,
			y: textRect.y + emoji.y + padding - offsetAdjustment,
			width: localEmojiSize,
			height: localEmojiSize,
		};

		let localM = new DOMMatrix();
		const emojiCenterX = emojiDstRect.x + localEmojiSize / 2;
		const emojiCenterY = emojiDstRect.y + localEmojiSize / 2;

		localM = localM.translate(emojiCenterX, emojiCenterY);
		if (transX !== 0 || transY !== 0) {
			localM = localM.translate(transX, transY);
		}
		if (rot !== 0) {
			localM = localM.rotate(rot);
		}
		if (scale !== 1.0) {
			localM = localM.scale(scale);
		}
		localM = localM.translate(-emojiCenterX, -emojiCenterY);

		const emojiMatrix = props.matrix ? props.matrix.multiply(localM) : localM;

		ctx.renderer.drawTextureRegion(
			pass,
			emojiTex,
			{ x: 0, y: 0, width: emojiTex.width, height: emojiTex.height },
			emojiDstRect,
			{
				opacity,
				transform: emojiMatrix,
			},
		);
	}

	// 4. Draw typewriter cursor if enabled and visible
	if (
		props.typewriter?.cursor?.enabled &&
		twState &&
		twState.isCursorVisible &&
		(!props.typewriter.cursor.hideOnComplete ||
			twState.visibleChars < props.text.length)
	) {
		const cursorCfg = props.typewriter.cursor;
		const cursorCol = cursorCfg.color ?? props.color ?? "white";
		const cursorWidth = cursorCfg.width ?? 2.5;
		const cursorSpacing = cursorCfg.spacing ?? 3.0;

		let cursorX = props.dstRect.x + padding;
		let cursorY = textRect.y + padding;

		if (layout.glyphs.length > 0) {
			const lastG = layout.glyphs[layout.glyphs.length - 1];
			const fontScale = fontSize / slugFont.unitsPerEm;
			const adv = (lastG.cp?.advanceWidth || 0) * fontScale;
			cursorX = lastG.x + props.dstRect.x + padding + adv + cursorSpacing;
			cursorY = lastG.y + textRect.y + padding;
		}

		if (cursorCfg.style === "underscore") {
			ctx.renderer.drawRect(
				pass,
				{
					x: cursorX,
					y: cursorY,
					width: fontSize * 0.5,
					height: cursorWidth,
				},
				cursorCol,
				0,
				{ opacity: props.opacity ?? 1 },
			);
		} else if (cursorCfg.style === "block") {
			ctx.renderer.drawRect(
				pass,
				{
					x: cursorX,
					y: cursorY - fontSize * 0.8,
					width: fontSize * 0.5,
					height: fontSize,
				},
				cursorCol,
				0,
				{ opacity: props.opacity ?? 1 },
			);
		} else {
			ctx.renderer.drawRect(
				pass,
				{
					x: cursorX,
					y: cursorY - fontSize * 0.8,
					width: cursorWidth,
					height: fontSize,
				},
				cursorCol,
				0,
				{ opacity: props.opacity ?? 1 },
			);
		}
	}
}
