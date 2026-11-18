/**
 * Shared editorial HUD primitives and 3D light-ring helpers used across
 * all five acts so typography, telemetry accents, and shockwaves share one
 * unified visual language.
 */
import { Layer, Layer3D, LayerAnimation, type LayoutNode } from "framefields";
import { FONT_DISPLAY, FONT_MONO, H, PALETTE, W } from "./theme.js";

/** Expanding neon light torus rushing outward along the reflective mirror floor. */
export function floorShockwave(options: {
	readonly id: string;
	readonly at: number;
	readonly span: number;
	readonly color: string;
	readonly maxScale: number;
	readonly x?: number;
	readonly z?: number;
	readonly intensity?: number;
}): LayoutNode {
	const {
		id,
		at,
		span,
		color,
		maxScale,
		x = 0,
		z = 0,
		intensity = 2.6,
	} = options;
	return Layer3D.torus({
		id,
		x,
		y: -3,
		z,
		rotateX: 90,
		radius: 90,
		// Razor-thin tube so scaling up to 24x stays a crisp 3px laser ring on the mirror floor.
		tube: 0.14,
		tubularSegments: 192,
		radialSegments: 8,
		color,
		material: "unlit",
		emissive: color,
		emissiveIntensity: intensity,
		castShadow: false,
		scale: 0.04,
		startFrame: at,
		durationFrames: span,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.04],
				[span - 1, maxScale, "power2.out"],
			])
			.keys("opacity", [
				[0, 0.9],
				[Math.round(span * 0.4), 0.65],
				[span - 1, 0, "sine.in"],
			]),
	) as LayoutNode;
}

/** Minimal precision viewfinder corner ticks around the 1080p safe area. */
export function cornerTicks(prefix: string, duration: number): LayoutNode[] {
	const margin = 48;
	const arm = 34;
	const size = arm + 8;
	const makePath = (flipX: boolean, flipY: boolean) => {
		const px = (v: number) => (flipX ? size - v : v);
		const py = (v: number) => (flipY ? size - v : v);
		return `M ${px(4)} ${py(arm)} L ${px(4)} ${py(4)} L ${px(arm)} ${py(4)}`;
	};
	const corners: Array<[boolean, boolean]> = [
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	];
	return corners.map(
		([right, bottom], i) =>
			Layer.shape("path", {
				id: `${prefix}-tick-${i}`,
				position: "absolute",
				x: right ? W - margin - size : margin,
				y: bottom ? H - margin - size : margin,
				width: size,
				height: size,
				d: makePath(right, bottom),
				strokeColor: PALETTE.cyan,
				strokeWidth: 2,
				fill: "transparent",
				opacity: 0.55,
				trimEnd: 0,
				startFrame: 0,
				durationFrames: duration,
			}).animate(
				LayerAnimation.keys("trimEnd", [
					[2 + i * 2, 0],
					[18 + i * 2, 1, "expo.out"],
				]),
			) as LayoutNode,
	);
}

/** Clean editorial act eyebrow + headline lockup. */
export function actHeader(options: {
	readonly id: string;
	readonly tag: string;
	readonly title: string;
	readonly accentWord?: string;
	readonly x: number;
	readonly y: number;
	readonly enterAt: number;
	readonly duration: number;
	readonly titleSize?: number;
}): LayoutNode {
	const {
		id,
		tag,
		title,
		accentWord,
		x,
		y,
		enterAt,
		duration,
		titleSize = 58,
	} = options;
	const end = Math.min(duration - 1, enterAt + 18);

	return Layer.flex({
		id,
		position: "absolute",
		x,
		y,
		width: 1120,
		dir: "column",
		gap: 10,
		opacity: 0,
		startFrame: 0,
		durationFrames: duration,
		children: [
			Layer.flex({
				id: `${id}-tag-row`,
				dir: "row",
				align: "center",
				gap: 12,
				children: [
					Layer.box({
						id: `${id}-dot`,
						width: 10,
						height: 10,
						borderRadius: 5,
						background: PALETTE.cyan,
					}),
					Layer.text(tag, {
						id: `${id}-tag`,
						fontFamily: FONT_MONO,
						fontSize: 18,
						fontWeight: 600,
						letterSpacing: 3.4,
						fill: PALETTE.cyan,
					}),
				],
			}),
			Layer.flex({
				id: `${id}-title-row`,
				dir: "row",
				align: "end",
				gap: 16,
				children: [
					Layer.text(title, {
						id: `${id}-title`,
						fontFamily: FONT_DISPLAY,
						fontSize: titleSize,
						fontWeight: 800,
						fontVariations: { wdth: 108 },
						letterSpacing: -0.8,
						fill: PALETTE.white,
					}),
					...(accentWord
						? [
								Layer.text(accentWord, {
									id: `${id}-accent`,
									fontFamily: FONT_DISPLAY,
									fontSize: titleSize,
									fontWeight: 300,
									fontVariations: { wdth: 112 },
									letterSpacing: 1.2,
									fill: PALETTE.cyan,
								}),
							]
						: []),
				],
			}),
		] as LayoutNode[],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[enterAt, 0],
				[end, 1, "power2.out"],
			])
			.keys("y", [
				[enterAt, y + 26],
				[end, y, "expo.out"],
			]),
	) as LayoutNode;
}
