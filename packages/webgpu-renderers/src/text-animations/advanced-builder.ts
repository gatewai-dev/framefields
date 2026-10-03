/**
 * @file packages/webgpu-renderers/src/text-animations/advanced-builder.ts
 * Fluent builder for Advanced Motion Design & After Effects Extended Typography Animators.
 */

import type {
	AnchorGrouping,
	AnchorPreset,
	ExpressionSelector,
	ExtendedGlyphProperties,
	VariableFontAxes,
	VolumetricFormationMode,
} from "./advanced-types.js";

/**
 * Fluent Builder for Extended Text Animators.
 */
export class AdvancedTextAnimatorBuilder {
	private readonly name: string;
	private props: ExtendedGlyphProperties = {};
	private selectors: (ExpressionSelector | Record<string, unknown>)[] = [];

	constructor(name: string) {
		this.name = name;
	}

	static create(name: string): AdvancedTextAnimatorBuilder {
		return new AdvancedTextAnimatorBuilder(name);
	}

	/** Directional Skew */
	skew(angleDeg: number, axisDeg = 0): this {
		this.props.skew = angleDeg;
		this.props.skewAxis = axisDeg;
		return this;
	}

	/** Anchor Point Grouping and Preset Pivot */
	anchor(
		preset: AnchorPreset,
		grouping: AnchorGrouping = "character",
		offsetX = 0,
		offsetY = 0,
	): this {
		this.props.anchor = {
			grouping,
			preset,
			anchorX: 0.5,
			anchorY: 0.5,
			offsetX,
			offsetY,
		};
		return this;
	}

	/** Custom Anchor Point Coordinates (0 to 1 normalized) */
	anchorNormalized(
		ax: number,
		ay: number,
		grouping: AnchorGrouping = "character",
	): this {
		this.props.anchor = {
			grouping,
			preset: "custom",
			anchorX: ax,
			anchorY: ay,
			offsetX: 0,
			offsetY: 0,
		};
		return this;
	}

	/** 3D Spatial Z-Depth */
	translateZ(zPixels: number): this {
		this.props.translateZ = zPixels;
		return this;
	}

	/** 3D Tilts */
	tilt3D(rx = 0, ry = 0, rz = 0): this {
		this.props.rotationX = rx;
		this.props.rotationY = ry;
		this.props.rotationZ = rz;
		return this;
	}

	/** 3D Rotation along X axis */
	rotationX(deg: number): this {
		this.props.rotationX = deg;
		return this;
	}

	/** 3D Rotation along Y axis */
	rotationY(deg: number): this {
		this.props.rotationY = deg;
		return this;
	}

	/** 3D Rotation along Z axis */
	rotationZ(deg: number): this {
		this.props.rotationZ = deg;
		return this;
	}

	/** 3D Volumetric Formations */
	volumetricFormation(
		mode: VolumetricFormationMode = "cylinder",
		radius = 300,
		pitch = 120,
		totalAngle = 360,
		perspective = 1200,
		axis: "x" | "y" | "z" = "y",
	): this {
		this.props.formation = {
			mode,
			radius,
			pitch,
			totalAngle,
			perspective,
			axis,
		};
		return this;
	}

	/** Dynamic Line Spacing (Leading) */
	lineSpacing(extraLeadingPixels: number, lineAnchor = 0): this {
		this.props.lineSpacing = extraLeadingPixels;
		this.props.lineAnchor = lineAnchor;
		return this;
	}

	/** Normalized Line Anchor (0=top, 0.5=center, 1=bottom) */
	lineAnchor(anchor: number): this {
		this.props.lineAnchor = anchor;
		return this;
	}

	/** Inertial Spring Settling Physics */
	spring(stiffness = 180, damping = 12, mass = 1.0, initialVelocity = 0): this {
		this.props.spring = {
			stiffness,
			damping,
			mass,
			initialVelocity,
			overshootMultiplier: 1.0,
		};
		return this;
	}

	/** Dynamic Stroke & Wireframe Properties */
	stroke(widthPixels: number, color = "#ffffff", fillOpacity = 1.0): this {
		this.props.stroke = {
			strokeWidth: widthPixels,
			strokeColor: color,
			strokeAlign: "center",
			fillOpacity,
			dashOffset: 0,
		};
		return this;
	}

	/** Variable Font Axes */
	variableFont(axes: VariableFontAxes): this {
		this.props.variableAxes = axes;
		return this;
	}

	/** Chromatic Aberration / Cyberpunk Glitch */
	chromaticGlitch(
		redShiftX: number,
		redShiftY = 0,
		blueShiftX = -redShiftX,
		blueShiftY = 0,
	): this {
		this.props.chromaticGlitch = {
			redShiftX,
			redShiftY,
			blueShiftX,
			blueShiftY,
			sliceProbability: 0,
			sliceAmplitude: 0,
		};
		return this;
	}

	/** Multi-Band Audio Spectrum Equalizer */
	audioSpectrum(
		signalChannel: string,
		minFreqHz = 60,
		maxFreqHz = 16000,
		maxScale = 2.5,
	): this {
		this.props.audioSpectrum = {
			signalChannel,
			minFreqHz,
			maxFreqHz,
			scaleAxis: "scaleY",
			minScale: 0.2,
			maxScale,
			peakDecay: 0.8,
		};
		return this;
	}

	/** Long Shadow Extrusion */
	longShadow(
		angle = 45,
		length = 40,
		color = "#000000",
		startOpacity = 0.8,
		endOpacity = 0.0,
		steps = 16,
	): this {
		this.props.longShadow = {
			angle,
			length,
			color,
			startOpacity,
			endOpacity,
			steps,
		};
		return this;
	}

	/** Particle Dust / Quantum Dissolve */
	particleDissolve(
		progress = 0,
		dispersalAngle = 90,
		maxDisplacement = 120,
	): this {
		this.props.particleDissolve = {
			progress,
			dispersalAngle,
			maxDisplacement,
			turbulence: 0.5,
			particleSize: 2.0,
		};
		return this;
	}

	/** Add Expression Selector */
	addExpressionSelector(
		expression: string,
		mode: "add" | "subtract" | "intersect" = "add",
	): this {
		this.selectors.push({
			type: "expression",
			expression,
			mode,
			amount: 1.0,
		});
		return this;
	}

	/** Alias for addExpressionSelector */
	expressionSelector(
		expression: string,
		mode: "add" | "subtract" | "intersect" = "add",
	): this {
		return this.addExpressionSelector(expression, mode);
	}

	/** Standard 2D Transforms */
	x(v: number): this {
		this.props.x = v;
		return this;
	}
	y(v: number): this {
		this.props.y = v;
		return this;
	}
	scale(v: number): this {
		this.props.scale = v;
		return this;
	}
	scaleX(v: number): this {
		this.props.scaleX = v;
		return this;
	}
	scaleY(v: number): this {
		this.props.scaleY = v;
		return this;
	}
	rotation(deg: number): this {
		this.props.rotation = deg;
		return this;
	}
	opacity(v: number): this {
		this.props.opacity = v;
		return this;
	}
	blur(v: number): this {
		this.props.blur = v;
		return this;
	}
	fillColor(hex: string): this {
		this.props.fillColor = hex;
		return this;
	}

	build(): {
		name: string;
		selectors: (ExpressionSelector | Record<string, unknown>)[];
		props: ExtendedGlyphProperties;
	} {
		return {
			name: this.name,
			selectors: this.selectors,
			props: this.props,
		};
	}
}
