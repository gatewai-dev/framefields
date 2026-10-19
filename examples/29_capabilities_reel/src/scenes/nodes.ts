/**
 * 10b — Node montage. Two bars, sixteen cuts on the eighth notes: the dancer clip through one
 * more node each — keying, corner pin, mesh warp, diamond pixels, symmetry, rotation, hue, levels,
 * high-pass, sharpening, relighting, depth parallax, glass caustics, CMYK halftone, a 3D LUT
 * (written here as a .cube) and datamosh — each named as it hits.
 */
import fs from "node:fs";
import path from "node:path";
import {
	ApplyLUT,
	CameraParallax3D,
	ColorKey,
	CornerPin,
	Datamosh,
	Flip,
	Gradient,
	HalftoneScreen,
	HighPass,
	Layer,
	Levels,
	MeshWarp,
	Modulate,
	Pixelate,
	RefractionCaustics3D,
	Relight3D,
	Rotate,
	Signal,
	UnsharpMask,
} from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import { ASSETS, DANCER } from "../paths.js";
import {
	BEAT,
	CYAN,
	DISPLAY,
	GOLD,
	H,
	INK,
	MONO,
	PAPER,
	PINK,
	VIOLET,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

/** A small teal-and-orange 3D LUT, written as a .cube so ApplyLUT has a real file to read. */
export function tealOrangeLut(): string {
	const file = path.join(ASSETS, "luts", "teal-orange.cube");
	if (fs.existsSync(file)) return file;
	const n = 17;
	const lines = ['TITLE "teal-orange"', `LUT_3D_SIZE ${n}`];
	for (let b = 0; b < n; b++) {
		for (let g = 0; g < n; g++) {
			for (let r = 0; r < n; r++) {
				const R = r / (n - 1);
				const G = g / (n - 1);
				const B = b / (n - 1);
				const l = 0.299 * R + 0.587 * G + 0.114 * B;
				// Shadows toward teal, highlights toward orange, a little more contrast.
				const s = l * l * (3 - 2 * l);
				const mix = (v: number, teal: number, orange: number) =>
					Math.min(
						1,
						Math.max(0, v * 0.5 + (1 - s) * teal * 0.5 + s * orange * 0.5),
					);
				lines.push(
					[mix(R, 0.05, 1.0), mix(G, 0.35, 0.62), mix(B, 0.42, 0.28)]
						.map((v) => v.toFixed(5))
						.join(" "),
				);
			}
		}
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

export function nodeLooks(
	frameOffset: () => number,
): Array<[string, unknown[]]> {
	return [
		[
			"ColorKey",
			[
				new ColorKey({
					keyColor: "#E7D2B5",
					similarity: 0.1,
					smoothness: 0.06,
					spillSuppression: 0.2,
				}),
			],
		],
		[
			"CornerPin",
			[
				new CornerPin({
					points: [
						{ x: 12, y: 6 },
						{ x: 92, y: 14 },
						{ x: 4, y: 86 },
						{ x: 84, y: 94 },
					],
				}),
			],
		],
		[
			"MeshWarp",
			[
				new MeshWarp({
					cols: 3,
					rows: 3,
					points: [
						{ x: 0, y: 0 },
						{ x: 50, y: 8 },
						{ x: 100, y: 0 },
						{ x: 10, y: 50 },
						{ x: 62, y: 42 },
						{ x: 90, y: 50 },
						{ x: 0, y: 100 },
						{ x: 50, y: 92 },
						{ x: 100, y: 100 },
					],
				}),
			],
		],
		[
			"Pixelate · diamond",
			[new Pixelate({ size: 22, shape: "diamond", gap: 0.1 })],
		],
		[
			"Flip · quadrant",
			[new Flip({ mode: "custom", horizontal: false, symmetry: "quadrant" })],
		],
		[
			"Rotate",
			[
				new Rotate({
					angle: Signal.programmatic(
						(ctx) => (ctx.frame - frameOffset()) * 6 - 20,
					),
					fit: "cover",
					scale: 1.1,
				}),
			],
		],
		[
			"Modulate · hue",
			[
				new Modulate({
					hue: Signal.programmatic((ctx) =>
						Math.round(((ctx.frame - frameOffset()) * 24) % 360),
					),
					saturation: 1.6,
					brightness: 1,
					contrast: 1.1,
				} as never),
			],
		],
		[
			"Levels",
			[
				new Levels({
					master: { inBlack: 0.2, inWhite: 0.78, outBlack: 0, outWhite: 1 },
				} as never),
			],
		],
		[
			"HighPass",
			[new HighPass({ radius: 4, contrastBoost: 2.2, monochrome: true })],
		],
		[
			"UnsharpMask",
			[new UnsharpMask({ amount: 400, radius: 3, threshold: 0 })],
		],
		[
			"Relight3D",
			[
				new Relight3D({
					lightType: "Point",
					intensity: 2.4,
					lightPosX: 0.75,
					lightPosY: 0.25,
					lightPosZ: 0.4,
					lightColor: "#FF7A3D",
					ambientIntensity: 0.35,
					ambientColor: "#2A3A80",
					specularStrength: 0.8,
				}),
			],
		],
		[
			"CameraParallax3D",
			[
				new CameraParallax3D({
					motionPreset: "Orbit",
					parallaxAmount: 1.1,
					panX: Signal.programmatic((ctx) =>
						Math.sin((ctx.frame - frameOffset()) / 3),
					) as never,
				}),
			],
		],
		[
			"RefractionCaustics3D",
			[
				new RefractionCaustics3D({
					ior: 1.33,
					dispersion: 0.08,
					refractionScale: 1,
					causticBrightness: 1.2,
					fluidRipples: 0.8,
					rippleSpeed: 2,
				}),
			],
		],
		[
			"HalftoneScreen · CMYK",
			[new HalftoneScreen({ mode: "CMYK", dotShape: "Circle", frequency: 46 })],
		],
		[
			"ApplyLUT · .cube",
			[new ApplyLUT({ lutUrl: tealOrangeLut(), intensity: 1 })],
		],
		["Datamosh", [new Datamosh({ strength: 3, bleed: 0.6, warmup: 6 })]],
	].map(([name, fx]) => [name as string, fx as unknown[]]) as Array<
		[string, unknown[]]
	>;
}

export function nodesScene(): Node {
	const c = chapter("nodes");
	const looks = nodeLooks(() => 0);
	const step = (k: number) => Math.round((k * BEAT) / 2);
	const cuts = looks.map(([name, fx], k) => {
		const at = step(k);
		const len = k === looks.length - 1 ? c.frames - at + 30 : step(k + 1) - at;
		return full({
			id: `nodes-cut-${k}`,
			startFrame: at,
			durationFrames: len,
			children: [
				// Behind the keyed cut, so ColorKey has something to reveal.
				full({ background: Gradient.linear([VIOLET, PINK, GOLD], 120) }),
				Layer.video(DANCER, {
					id: `nodes-video-${k}`,
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					fit: "cover",
					muted: true,
					trimStartSec: 1 + at / 30,
				}).withEffects(fx as never),
				Layer.box({
					position: "absolute",
					x: 70,
					y: 70,
					height: 64,
					padding: 14,
					borderRadius: 12,
					background: INK,
					children: [
						Layer.text(name, {
							fontFamily: DISPLAY,
							fontWeight: 800,
							fontSize: 34,
							fill: [CYAN, GOLD, PINK, PAPER][k % 4],
						}),
					],
				}).animate(
					keys("x", [
						[0, 40],
						[5, 70, "expo.out"],
					]),
				),
				Layer.text(`${String(k + 1).padStart(2, "0")} / ${looks.length}`, {
					position: "absolute",
					x: W - 240,
					y: 84,
					width: 170,
					align: "end",
					fontFamily: MONO,
					fontSize: 26,
					fill: PAPER,
				}),
			],
		});
	});
	return scene("nodes", INK, [
		...cuts,
		hud("nodes", ["one node per eighth note", "nodes/*"]),
	]);
}
