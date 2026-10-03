/**
 * @file packages/compositions/src/program/text-animations/builder.ts
 * Fluent builders for Path-Following Text and After Effects Text Animators.
 */

import {
	type AETextAnimator,
	AETextAnimatorSchema,
	type AnimatableGlyphProps,
	type CubicBezierSegment,
	type GlyphAnchorGrouping,
	type GlyphAnchorPoint,
	type SelectorBasedOn,
	type SelectorMode,
	type SelectorShape,
	type TextPathOptions,
	TextPathOptionsSchema,
	type TextSelector,
} from "./types.js";

/**
 * Fluent builder for creating Path-Following Text configurations.
 */
export class TextPathBuilder {
	private options: Partial<TextPathOptions> = {
		firstMargin: 0,
		lastMargin: 0,
		reversePath: false,
		perpendicularToPath: true,
		forceAlignment: false,
		loop: false,
		baselineOffset: "baseline",
		baselineShift: 0,
	};

	static fromSvg(svgPath: string): TextPathBuilder {
		const builder = new TextPathBuilder();
		builder.options.path = { type: "svg", d: svgPath };
		return builder;
	}

	static fromBezier(segments: CubicBezierSegment[]): TextPathBuilder {
		const builder = new TextPathBuilder();
		builder.options.path = { type: "bezier", segments };
		return builder;
	}

	static fromCurve(curve: CubicBezierSegment): TextPathBuilder {
		return TextPathBuilder.fromBezier([curve]);
	}

	static circularBadge(
		cx: number,
		cy: number,
		radius: number,
	): TextPathBuilder {
		const builder = new TextPathBuilder();
		builder.options.path = {
			type: "ellipse",
			cx,
			cy,
			rx: radius,
			ry: radius,
			startAngleDeg: 0,
			endAngleDeg: 360,
		};
		builder.options.loop = true;
		return builder;
	}

	static ellipse(
		cx: number,
		cy: number,
		rx: number,
		ry: number,
		startAngleDeg = 0,
		endAngleDeg = 360,
	): TextPathBuilder {
		const builder = new TextPathBuilder();
		builder.options.path = {
			type: "ellipse",
			cx,
			cy,
			rx,
			ry,
			startAngleDeg,
			endAngleDeg,
		};
		builder.options.loop = Math.abs(endAngleDeg - startAngleDeg) >= 360;
		return builder;
	}

	static wave(
		startX: number,
		startY: number,
		length: number,
		amplitude: number,
		frequency: number,
		phaseDeg = 0,
	): TextPathBuilder {
		const builder = new TextPathBuilder();
		builder.options.path = {
			type: "wave",
			startX,
			startY,
			length,
			amplitude,
			frequency,
			phaseDeg,
		};
		return builder;
	}

	firstMargin(margin: number): this {
		this.options.firstMargin = margin;
		return this;
	}

	lastMargin(margin: number): this {
		this.options.lastMargin = margin;
		return this;
	}

	reversePath(reverse: boolean): this {
		this.options.reversePath = reverse;
		return this;
	}

	perpendicularToPath(perpendicular: boolean): this {
		this.options.perpendicularToPath = perpendicular;
		return this;
	}

	forceAlignment(force: boolean): this {
		this.options.forceAlignment = force;
		return this;
	}

	loop(isLoop: boolean): this {
		this.options.loop = isLoop;
		return this;
	}

	baselineOffset(
		offset: "baseline" | "center" | "ascender" | "descender",
	): this {
		this.options.baselineOffset = offset;
		return this;
	}

	baselineShift(shiftPixels: number): this {
		this.options.baselineShift = shiftPixels;
		return this;
	}

	build(): TextPathOptions {
		return TextPathOptionsSchema.parse(this.options);
	}
}

/**
 * Fluent builder for After Effects Range, Wiggly, and Signal Animators.
 */
export class TextAnimatorBuilder {
	private name = "Animator";
	private selectors: TextSelector[] = [];
	private props: AnimatableGlyphProps = {};
	private anchor: GlyphAnchorPoint = {
		grouping: "character",
		anchorX: 0.5,
		anchorY: 0.8,
	};

	static create(name: string): TextAnimatorBuilder {
		const builder = new TextAnimatorBuilder();
		builder.name = name;
		return builder;
	}

	/** Adds an After Effects Range Selector */
	addRangeSelector(config: {
		start?: number;
		end?: number;
		offset?: number;
		shape?: SelectorShape;
		basedOn?: SelectorBasedOn;
		mode?: SelectorMode;
		easeHigh?: number;
		easeLow?: number;
		randomizeOrder?: boolean;
		randomSeed?: number;
	}): this {
		const rawHigh = config.easeHigh ?? 0;
		const easeHigh = Math.abs(rawHigh) > 1 ? rawHigh / 100 : rawHigh;
		const rawLow = config.easeLow ?? 0;
		const easeLow = Math.abs(rawLow) > 1 ? rawLow / 100 : rawLow;

		this.selectors.push({
			type: "range",
			start: config.start ?? 0,
			end: config.end ?? 1,
			offset: config.offset ?? 0,
			units: "percentage",
			basedOn: config.basedOn ?? "characters",
			shape: config.shape ?? "smooth",
			mode: config.mode ?? "add",
			amount: 1,
			easeHigh: Math.max(-1, Math.min(1, easeHigh)),
			easeLow: Math.max(-1, Math.min(1, easeLow)),
			randomizeOrder: config.randomizeOrder ?? false,
			randomSeed: config.randomSeed ?? 12345,
		});
		return this;
	}

	/** Adds an After Effects Wiggly Selector for procedural organic flutter */
	addWigglySelector(config: {
		wigglesPerSecond?: number;
		correlation?: number;
		minAmount?: number;
		maxAmount?: number;
		randomSeed?: number;
		mode?: SelectorMode;
	}): this {
		this.selectors.push({
			type: "wiggly",
			wigglesPerSecond: config.wigglesPerSecond ?? 2.0,
			correlation: config.correlation ?? 0.5,
			temporalPhaseDeg: 0,
			spatialPhaseDeg: 0,
			minAmount: config.minAmount ?? -1.0,
			maxAmount: config.maxAmount ?? 1.0,
			randomSeed: config.randomSeed ?? 42,
			basedOn: "characters",
			mode: config.mode ?? "intersect",
		});
		return this;
	}

	/** Adds a reactive signal selector */
	addSignalSelector(
		signalId: string,
		multiplier = 1.0,
		phaseSpread = 0.0,
		offset = 0.0,
		mode: SelectorMode = "add",
	): this {
		this.selectors.push({
			type: "signal",
			signalId,
			multiplier,
			offset,
			phaseSpread,
			basedOn: "characters",
			mode,
		});
		return this;
	}

	// --- Animatable Target Properties ---
	x(pixels: number): this {
		this.props.x = pixels;
		return this;
	}

	y(pixels: number): this {
		this.props.y = pixels;
		return this;
	}

	z(pixels: number): this {
		this.props.z = pixels;
		return this;
	}

	scale(scaleValue: number): this {
		this.props.scale = scaleValue;
		return this;
	}

	scaleX(scaleValue: number): this {
		this.props.scaleX = scaleValue;
		return this;
	}

	scaleY(scaleValue: number): this {
		this.props.scaleY = scaleValue;
		return this;
	}

	rotation(degrees: number): this {
		this.props.rotation = degrees;
		return this;
	}

	rotationX(degrees: number): this {
		this.props.rotationX = degrees;
		return this;
	}

	rotationY(degrees: number): this {
		this.props.rotationY = degrees;
		return this;
	}

	skew(degrees: number): this {
		this.props.skew = degrees;
		return this;
	}

	skewAxis(degrees: number): this {
		this.props.skewAxis = degrees;
		return this;
	}

	opacity(value: number): this {
		this.props.opacity = value;
		return this;
	}

	blur(pixels: number): this {
		this.props.blur = pixels;
		return this;
	}

	fill(colorHex: string): this {
		return this.fillColor(colorHex);
	}

	fillColor(colorHex: string): this {
		this.props.fillColor = colorHex;
		return this;
	}

	strokeColor(colorHex: string): this {
		this.props.strokeColor = colorHex;
		return this;
	}

	strokeWidth(pixels: number): this {
		this.props.strokeWidth = pixels;
		return this;
	}

	tracking(spacingPixels: number): this {
		this.props.tracking = spacingPixels;
		return this;
	}

	lineSpacing(spacingPixels: number): this {
		this.props.lineSpacing = spacingPixels;
		return this;
	}

	characterOffset(offset: number): this {
		this.props.characterOffset = offset;
		return this;
	}

	anchorGrouping(
		grouping: GlyphAnchorGrouping,
		anchorX = 0.5,
		anchorY = 0.8,
	): this {
		this.anchor = { grouping, anchorX, anchorY };
		return this;
	}

	build(): AETextAnimator {
		return AETextAnimatorSchema.parse({
			name: this.name,
			selectors: this.selectors,
			props: this.props,
			anchor: this.anchor,
		});
	}
}
