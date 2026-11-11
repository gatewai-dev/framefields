/**
 * Keynote: one object on black, lit by a soft key and a rim, with a strip
 * light sweeping across its top. One line of type under it, a gray line
 * under that, and nothing else on screen.
 */
import { Layer, Layer3D, LayerAnimation, type LayoutNode } from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { at, full } from "../place.js";

const look = lookTokens("keynote");
const [BLACK, , WHITE, GRAY] = look.palette;
const FRAMES = 120;

function stage(c: Crop): LayoutNode {
	const { width: W, height: H, u, tall } = c;
	const cx = W / 2;
	const cy = tall ? H * 0.42 : H * 0.4;
	const r = (tall ? 300 : 260) * u;
	const t = 70 * u;
	const floor = cy + t / 2;
	const reach = tall ? (H / W) * 0.95 : 1;
	return at("k-stage", 0, 0, W, H, {
		children: [
			// A tall frame sees less across: pull back so the object keeps its width.
			Layer.camera({
				id: "k-cam",
				x: cx,
				y: cy - 520 * u * reach,
				z: -1500 * u * reach,
				targetX: cx,
				targetY: cy,
				targetZ: 0,
				fov: 30,
			}).animate(
				LayerAnimation.create().keys("x", [
					[0, cx - 120 * u],
					[FRAMES, cx + 120 * u, "sine.inOut"],
				]),
			),
			Layer.environment("studio", {
				exposure: 0.2,
				toneMapping: "neutral",
				floor: {
					y: floor,
					color: BLACK,
					reflectivity: 0.5,
					roughness: 0.2,
					fadeDistance: 900 * u,
				},
				bloom: { intensity: 0.2, threshold: 1.8 },
			}),
			Layer.rectLight({
				id: "k-key",
				x: cx - 300 * u,
				y: cy - 900 * u,
				z: -500 * u,
				targetX: cx,
				targetY: cy,
				targetZ: 0,
				width: 600 * u,
				height: 300 * u,
				intensity: 2.4,
				color: "#fff6ee",
				castShadow: true,
			}),
			Layer.rectLight({
				id: "k-rim",
				x: cx + 700 * u,
				y: cy - 400 * u,
				z: 800 * u,
				targetX: cx,
				targetY: cy,
				targetZ: 0,
				width: 200 * u,
				height: 600 * u,
				intensity: 2,
				color: "#cfe0ff",
			}),
			Layer.rectLight({
				id: "k-sweep",
				x: cx - 1000 * u,
				y: cy - 500 * u,
				z: -600 * u,
				targetX: cx,
				targetY: cy,
				targetZ: 0,
				width: 80 * u,
				height: 900 * u,
				intensity: 2.2,
				color: "#ffffff",
			}).animate(
				LayerAnimation.create().keys("x", [
					[10, cx - 1000 * u],
					[FRAMES - 10, cx + 1000 * u, "sine.inOut"],
				]),
			),
			Layer3D.cylinder({
				id: "k-body",
				x: cx,
				y: cy,
				z: 0,
				radius: r,
				height: t,
				segments: 128,
				color: "#3a3a40",
				metallic: 0.75,
				roughness: 0.32,
				clearcoat: 0.6,
				clearcoatRoughness: 0.08,
			}),
			Layer3D.torus({
				id: "k-ring",
				x: cx,
				y: cy - t / 2,
				z: 0,
				radius: r * 0.72,
				tube: 6 * u,
				rotateX: 90,
				color: "#d8d8dc",
				metallic: 1,
				roughness: 0.18,
			}),
			Layer3D.cylinder({
				id: "k-cap",
				x: cx,
				y: cy - t / 2 - 2 * u,
				z: 0,
				radius: r * 0.6,
				height: 4 * u,
				segments: 128,
				color: "#1c1c20",
				metallic: 0.2,
				roughness: 0.7,
			}),
		],
	});
}

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const e = edges(c, 96 * u);
	const headSize = (tall ? 104 : 96) * u;
	const headY = tall ? H * 0.64 : H * 0.7;
	const line = (
		id: string,
		text: string,
		y: number,
		size: number,
		fill: string,
		weight: number,
		from: number,
	) =>
		Layer.flex({
			id,
			position: "absolute",
			x: e.left,
			y,
			width: e.right - e.left,
			dir: "row",
			justify: "center",
			children: [
				Layer.text(text, {
					id: `${id}-text`,
					fontFamily: look.fonts.display,
					fontSize: size,
					fontWeight: weight,
					letterSpacing: -0.02 * size,
					fill,
				}),
			],
		}).animate(
			LayerAnimation.create()
				.fadeIn(from, from + 18, "power2.out")
				.keys("y", [
					[from, y + 20 * u],
					[from + 18, y, "power2.out"],
				]),
		);
	return [
		full(
			"k-root",
			W,
			H,
			[
				stage(c),
				line("k-head", "Light, rebuilt.", headY, headSize, WHITE, 600, 40),
				line(
					"k-sub",
					"Arrives this spring.",
					headY + headSize * 1.25,
					headSize * 0.42,
					GRAY,
					500,
					58,
				),
			],
			BLACK,
		),
	];
}

export const keynote: Reference = {
	look: "keynote",
	alt: "A dark metal puck with a silver ring, lit on pure black, above the line Light, rebuilt. and Arrives this spring. in gray",
	frames: FRAMES,
	hero: 96,
	build,
};
