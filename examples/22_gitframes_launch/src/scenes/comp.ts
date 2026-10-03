/**
 * "It's just code, write it once, key it, mask it, blend the light, stack
 * the layers, comp it through, render true every night." Compositing, with
 * four generated images (images.ts) as the footage:
 *   It's just code    the comp's source types itself beside its four source images
 *   key it            ColorKey pulls the green from behind the camera
 *   mask it           an iris mask closes round it
 *   blend the light   a light leak on black goes on in screen mode, a paper grain in multiply
 *   stack the layers  the camera swings round an exploded view: the comp is five planes in depth
 *   comp it through   they fall back flat into the blended picture
 *   render true …     the render bar races to the last frame
 * The composite itself is 2D (blend modes are a compositing operation); the
 * exploded stack is the same images standing in 3D.
 */
import {
	CameraAnimation,
	ColorKey,
	Layer,
	LayerAnimation,
	Signal,
} from "gitframes";
import { BEAT, bar, FPS } from "../grid.js";
import { type ImageName, image } from "../images.js";
import { lineWords, type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	ACCENT_DEEP,
	BG,
	CAM_Z,
	EASE_IN_OUT,
	EASE_OUT,
	FG,
	H,
	HAIRLINE,
	keys,
	label,
	MONO,
	MUTED,
	scene,
	sungLine,
	W,
} from "../theme.js";
import { CH, DURATION } from "../timeline.js";

const CX = W / 2;
const CY = H / 2;
const WHITE = "#FFFFFF";
/** The generated green screen, sampled from its corners (it is not #00FF00). */
const SCREEN_GREEN = "#3EB300";

type Segment = [text: string, color: string];
const kw = (t: string): Segment => [t, ACCENT];
const str = (t: string): Segment => [t, ACCENT_DEEP];
const txt = (t: string): Segment => [t, FG];

/** The comp, as code: what the next ten seconds do. */
const SOURCE: Segment[][] = [
	[kw("const"), txt(" cam = Layer.image("), str('"subject.png"'), txt(")")],
	[
		txt("  .apply("),
		kw("new"),
		txt(" ColorKey({ keyColor: "),
		str(`"${SCREEN_GREEN}"`),
		txt(" }));"),
	],
	[
		kw("const"),
		txt(" leak = Layer.image("),
		str('"leak.png"'),
		txt(", { blendMode: "),
		str('"screen"'),
		txt(" });"),
	],
	[],
	[txt("film.add(backdrop, cam, leak, paper, type);")],
	[kw("await"), txt(" film.renderVideo();")],
];

const CARD = { x: 80, y: 150, w: 1010, h: 560, pad: 44, lineH: 56 };
const chars = (line: Segment[]) => line.reduce((n, [t]) => n + t.length, 0);

/** The source typed in, one flex row of coloured segments per line. */
function code(at: number, until: number) {
	const total = SOURCE.reduce((n, l) => n + Math.max(1, chars(l)), 0);
	const perChar = (until - at) / total;
	let cursor = at;
	return SOURCE.map((line, i) => {
		const row = Layer.flex({
			id: `comp-code-${i}`,
			position: "absolute",
			x: CARD.x + CARD.pad,
			y: CARD.y + 96 + i * CARD.lineH,
			dir: "row",
			children: line.map(([text, fill], k) => {
				const from = Math.round(cursor);
				cursor += text.length * perChar;
				return Layer.text(text, {
					id: `comp-code-${i}-${k}`,
					fontFamily: MONO,
					fontSize: 24,
					fontWeight: 500,
					fill,
				}).animate(
					LayerAnimation.create().typewriter(
						from,
						Math.max(from + 1, Math.round(cursor)),
						"none",
					),
				);
			}),
		});
		if (!line.length) cursor += perChar;
		return row;
	});
}

const full = (
	id: string,
	name: ImageName,
	extra: Record<string, unknown> = {},
) =>
	Layer.image(image(name), {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		...extra,
	} as never);

/**
 * The camera, keyed: ColorKey's similarity opens from nothing to a clean pull
 * over six frames from `keyAt` (effect signals run on the layer's own clock).
 * The generated screen is a soft green, so the pull is tighter than ColorKey's
 * default: chroma within 0.24 of it goes.
 */
function keyed(id: string, keyAt: number) {
	const similarity = Signal.builder({
		type: "custom",
		fn: (ctx) => 0.24 * Math.min(1, Math.max(0, (ctx.frame - keyAt) / 6)),
	});
	return full(id, "subject").apply(
		new ColorKey({
			keyColor: SCREEN_GREEN,
			similarity: similarity as never,
			smoothness: 0.06,
			spillSuppression: 0.7,
		}),
	);
}

/** "mask it": a rounded iris (overflow: hidden) closing round the camera, which holds still inside it. */
function iris(id: string, at: number, child: unknown) {
	const w = 1220;
	const h = 940;
	const x = 940 - w / 2;
	const y = 525 - h / 2;
	const close = (prop: string, a: number, b: number) =>
		[
			prop,
			[
				[at, a],
				[at + 14, b, EASE_OUT],
			],
		] as const;
	const outer = LayerAnimation.create();
	for (const [prop, list] of [
		close("x", 0, x),
		close("y", 0, y),
		close("width", W, w),
		close("height", H, h),
		close("borderRadius", 0, h / 2),
	])
		keys(prop as never, list as never, outer);
	const inner = LayerAnimation.create();
	for (const [prop, list] of [close("x", 0, -x), close("y", 0, -y)])
		keys(prop as never, list as never, inner);
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		overflow: "hidden",
		children: [
			Layer.box({
				id: `${id}-hold`,
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				children: [child as never],
			}).animate(inner),
		],
	} as never).animate(outer);
}

/** Length of the chorus footage (precomp.ts): eight seconds of the finished composite. */
export const PLATE_FRAMES = 8 * FPS;

/**
 * The finished composite as footage for the chorus to grade: the same four
 * layers and blend modes, the camera keyed from the first frame, drifting
 * against the backdrop while the leak sweeps through.
 */
export function compPlate() {
	const len = PLATE_FRAMES;
	const drift = (
		id: string,
		child: unknown,
		x0: number,
		x1: number,
		s0: number,
		s1: number,
	) =>
		Layer.box({
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			children: [child as never],
		}).animate(
			keys(
				"x",
				[
					[0, x0],
					[len, x1, "sine.inOut"],
				],
				keys("scale", [
					[0, s0],
					[len, s1, "sine.inOut"],
				]),
			),
		);
	return Layer.box({
		id: "plate",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		children: [
			drift("plate-back", full("plate-backdrop", "backdrop"), 0, 0, 1.04, 1.16),
			drift("plate-subject", keyed("plate-camera", -10), 60, -80, 1, 1.08),
			full("plate-leak", "leak", { blendMode: "screen" }).animate(
				keys("x", [
					[0, -700],
					[len, 500, "sine.inOut"],
				]),
			),
			full("plate-paper", "paper", { blendMode: "multiply" }),
		],
	});
}

export function compScene() {
	const from = bar(CH.code);
	const to = bar(CH.vfx);
	const len = to - from;
	const local = (w: SungWord) => w.at - from;
	const its = sung("it's", from - BEAT);
	const key = sung("key", its.at);
	const mask = sung("mask", key.at);
	const blend = sung("blend", mask.at);
	const light = sung("light", blend.at);
	const stack = sung("stack", light.at);
	const comp = sung("comp", stack.at);
	const render = sung("render", comp.at);
	const night = sung("night", render.at);
	const [k, m, b, l, s, c, r] = [
		key,
		mask,
		blend,
		light,
		stack,
		comp,
		render,
	].map(local);
	/** Frames inside the comp, which starts on "key". */
	const [kb, kl, ks, kc] = [b, l, s, c].map((f) => f - k);
	const compLen = len - k;

	// ── The 2D composite: the real one, blend modes and all ──────────────────
	const composite = Layer.box({
		id: "comp-2d",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: k,
		children: [
			full("comp-backdrop", "backdrop"),
			iris("comp-iris", m - k, keyed("comp-subject", k)),
			full("comp-leak", "leak", { blendMode: "screen" }).animate(
				keys(
					"opacity",
					[
						[0, 0],
						[kb - 1, 0],
						[kb + 4, 1, "none"],
					],
					keys("x", [
						[kb, -500],
						[compLen, 300, "sine.inOut"],
					]),
				),
			),
			full("comp-paper", "paper", { blendMode: "multiply" }).animate(
				keys("opacity", [
					[0, 0],
					[kl - 1, 0],
					[kl + 4, 1, "none"],
				]),
			),
			sungLine({
				id: "comp-type",
				words: lineWords(stack.line),
				from: from + k,
				y: H - 250,
				size: 96,
				color: WHITE,
			}),
		],
	} as never);

	// ── The exploded view: the same images standing apart in depth ──────────
	const planes: [ImageName | "type", string, number][] = [
		["backdrop", "01  backdrop.png", 1000],
		["subject", "02  subject.png  ·  ColorKey  ·  mask", 500],
		["leak", "03  leak.png  ·  screen", 0],
		["paper", "04  paper.png  ·  multiply", -500],
		["type", "05  type", -1000],
	];
	const spread = (depth: number) =>
		keys("z", [
			[0, 0],
			[24, depth, EASE_OUT],
			[kc - ks, depth],
			[kc - ks + 20, 0, EASE_IN_OUT],
		]);
	const cam = CameraAnimation.camera()
		.orbit({
			azimuth: { from: 0, to: 44 },
			elevation: { from: 0, to: 16 },
			radius: { from: CAM_Z, to: 3000 },
			start: 0,
			end: 30,
			ease: EASE_OUT,
		})
		.orbit({
			azimuth: { from: 44, to: 50 },
			elevation: { from: 16, to: 18 },
			radius: { from: 3000, to: 3050 },
			start: 31,
			end: kc - ks,
			ease: "sine.inOut",
		})
		.orbit({
			azimuth: { from: 50, to: 0 },
			elevation: { from: 18, to: 0 },
			radius: { from: 3050, to: CAM_Z },
			start: kc - ks + 1,
			end: kc - ks + 24,
			ease: EASE_IN_OUT,
		});
	const exploded = Layer.box({
		id: "comp-3d",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: BG,
		startFrame: s,
		durationFrames: c + 24 - s,
		children: [
			Layer.camera({
				id: "comp-cam",
				targetX: CX,
				targetY: CY,
				targetZ: 0,
				animation: cam,
			} as never),
			...planes.map(([name, , depth], i) => {
				const plate =
					name === "type"
						? Layer.text("STACK THE LAYERS, COMP IT THROUGH", {
								id: "comp-3d-type-text",
								position: "absolute",
								x: 0,
								y: H - 230,
								width: W,
								fontFamily: "Unbounded",
								fontSize: 72,
								fontWeight: 900,
								fill: ACCENT,
								align: "center",
							})
						: name === "subject"
							? full("comp-3d-subject", "subject")
							: full(`comp-3d-${name}`, name);
				return Layer.box({
					id: `comp-3d-plane-${i}`,
					is3D: true,
					position: "absolute",
					x: 0,
					y: 0,
					z: 0,
					width: W,
					height: H,
					opacity: name === "backdrop" ? 1 : 0.94,
					borderColor: name === "type" ? ACCENT : HAIRLINE,
					borderWidth: name === "type" ? 4 : 2,
					children: [plate as never],
				} as never).animate(spread(depth));
			}),
			...planes.map(([, title, depth], i) =>
				Layer.text(title, {
					id: `comp-3d-name-${i}`,
					is3D: true,
					position: "absolute",
					x: W + 60,
					y: 60,
					z: depth,
					width: 900,
					fontFamily: MONO,
					fontSize: 44,
					fontWeight: 600,
					fill: FG,
				} as never).animate(
					spread(depth)
						.fadeIn(16, 22)
						.fadeOut(kc - ks - 2, kc - ks + 4),
				),
			),
		],
	} as never);

	const thumbs: ImageName[] = ["backdrop", "subject", "leak", "paper"];
	const TW = 350;
	const TH = Math.round((TW * 1088) / 1920);
	return scene(
		"comp",
		from,
		to,
		[
			// "It's just code, write it once": the source beside the images it composites.
			Layer.box({
				id: "comp-intro",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				background: BG,
				durationFrames: k,
				children: [
					Layer.box({
						id: "comp-card",
						position: "absolute",
						x: CARD.x,
						y: CARD.y,
						width: CARD.w,
						height: CARD.h,
						borderRadius: 28,
						background: WHITE,
						borderColor: HAIRLINE,
						borderWidth: 2,
					}).animate(
						keys("x", [
							[0, -CARD.w],
							[12, CARD.x, EASE_OUT],
						]),
					),
					Layer.text("comp.ts", {
						id: "comp-tab",
						position: "absolute",
						x: CARD.x + CARD.pad,
						y: CARD.y + 34,
						fontFamily: MONO,
						fontSize: 22,
						fontWeight: 600,
						letterSpacing: 2,
						fill: MUTED,
					}).animate(LayerAnimation.create().fadeIn(10, 14)),
					...code(local(its), k - 4),
					...thumbs.flatMap((name, i) => {
						const x = CARD.x + CARD.w + 50 + (i % 2) * (TW + 30);
						const y = CARD.y + Math.floor(i / 2) * (TH + 70);
						const at = 6 + i * 4;
						return [
							Layer.box({
								id: `comp-thumb-${i}`,
								position: "absolute",
								x,
								y,
								width: TW,
								height: TH,
								borderRadius: 14,
								overflow: "hidden",
								borderColor: HAIRLINE,
								borderWidth: 2,
								startFrame: at,
								children: [
									Layer.image(image(name), {
										id: `comp-thumb-img-${i}`,
										position: "absolute",
										x: 0,
										y: 0,
										width: TW,
										height: TH,
										fit: "cover",
									} as never),
								],
							} as never).animate(
								LayerAnimation.create().fromTo("scale", 1.2, 1, {
									start: 0,
									end: 10,
									ease: EASE_OUT,
								}),
							),
							label({
								id: `comp-thumb-name-${i}`,
								text: `${name}.png`,
								x,
								width: TW,
								align: "start",
								y: y + TH + 12,
								size: 16,
								color: MUTED,
								inAt: at + 4,
							}),
						];
					}),
					sungLine({
						id: "comp-l0",
						words: lineWords(its.line),
						from,
						y: H - 230,
						size: 92,
					}),
				],
			} as never),
			composite,
			exploded,
			// The lyric over the comp, at the head of the frame.
			sungLine({
				id: "comp-l1",
				words: lineWords(key.line),
				from,
				y: 50,
				size: 72,
				color: FG,
				outAt: s - 4,
			}),
			sungLine({
				id: "comp-l3",
				words: lineWords(render.line),
				from,
				y: 50,
				size: 72,
				color: WHITE,
			}),
			label({
				id: "comp-chip-key",
				text: `ColorKey  ·  ${SCREEN_GREEN}`,
				x: 90,
				width: 900,
				align: "start",
				y: H - 90,
				size: 20,
				color: WHITE,
				inAt: k + 2,
				outAt: m - 2,
			}),
			label({
				id: "comp-chip-mask",
				text: "mask  ·  rounded iris",
				x: 90,
				width: 900,
				align: "start",
				y: H - 90,
				size: 20,
				color: WHITE,
				inAt: m,
				outAt: b - 2,
			}),
			label({
				id: "comp-chip-blend",
				text: "blendMode  ·  screen  ·  multiply",
				x: 90,
				width: 900,
				align: "start",
				y: H - 90,
				size: 20,
				color: WHITE,
				inAt: b,
				outAt: s - 2,
			}),
			// "render true every night": the render bar races to the last frame.
			Layer.shape("rect", {
				id: "comp-bar",
				position: "absolute",
				x: 160,
				y: H - 60,
				width: 1,
				height: 12,
				borderRadius: 6,
				fillColor: ACCENT,
			}).animate(
				keys(
					"width",
					[
						[r, 1],
						[local(night) + 10, W - 320, "power2.inOut"],
					],
					keys("opacity", [
						[0, 0],
						[r - 1, 0],
						[r, 1, "none"],
					]),
				),
			),
			...Array.from({ length: Math.floor((len - r) / 3) }, (_, i) => {
				const at = r + i * 3;
				const n = Math.min(
					DURATION,
					Math.round(((at - r) / (local(night) + 10 - r)) * DURATION),
				);
				return Layer.text(`frame ${String(n).padStart(4, "0")} / ${DURATION}`, {
					id: `comp-counter-${i}`,
					position: "absolute",
					x: 160,
					y: H - 100,
					width: W - 320,
					fontFamily: MONO,
					fontSize: 22,
					fontWeight: 600,
					letterSpacing: 3,
					fill: WHITE,
					align: "end",
					startFrame: at,
					durationFrames: 3,
				});
			}),
		],
		{ background: BG },
	);
}
