/**
 * 06 — Warp + fluid, over the breakdown. Three panels of effects that need motion inside the
 * layer: Gooey metaballs from big GPU particles, Trails echoing a light-painting emitter, and a
 * Liquify twirl over a precomposed poster that TileOffset scrolls underneath it. Along the bottom, the
 * low-pass EQ curve that is filtering the music right now, with its cutoff counting live.
 */
import {
	Color,
	Gooey,
	Gradient,
	Layer,
	Liquify,
	Signal,
	TileOffset,
	Trails,
} from "framefields";
import { full, hud, keys, type Node, popIn, scene } from "../kit.js";
import { lowpassAt } from "../music.js";
import { still } from "../precomp.js";
import {
	BG,
	COBALT,
	CYAN,
	DISPLAY,
	EMBER,
	FG,
	GOLD,
	INK,
	LINE,
	MONO,
	MUTED,
	NIGHT,
	PAPER,
	PINK,
	SIGNAL,
	SKY,
	VIOLET,
	WHITE,
} from "../theme.js";
import { chapter } from "../timeline.js";

const PANEL = { r: 28, bg: NIGHT, border: Color.alpha("#ffffff", 0.12) };

function panel(
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	label: string,
	children: Node[],
	delay: number,
): Node {
	return Layer.box({
		id: `fluid-panel-${id}`,
		position: "absolute",
		x,
		y,
		width: w,
		height: h,
		borderRadius: PANEL.r,
		background: PANEL.bg,
		borderColor: PANEL.border,
		borderWidth: 1.5,
		overflow: "hidden",
		children: [
			...children,
			Layer.box({
				position: "absolute",
				x: 16,
				y: h - 50,
				height: 34,
				padding: 8,
				borderRadius: 8,
				background: Color.alpha(INK, 0.75),
				children: [
					Layer.text(label, { fontFamily: MONO, fontSize: 17, fill: PAPER }),
				],
			}),
		],
	}).animate(popIn(delay, 20, 0.85));
}

/** Magnitude (dB) of a 2nd-order low-pass at `f` for cutoff `fc`. */
function lowpassDb(f: number, fc: number, q = 1.2): number {
	const r = f / fc;
	return -10 * Math.log10((1 - r * r) ** 2 + (r / q) ** 2);
}

export async function fluidScene(): Promise<Node> {
	const c = chapter("fluid");
	const top = 200;

	// Gooey: a dozen large particles drifting round a centre melt into each other.
	const gw = 820;
	const gh = 560;
	const goo = Layer.particles({
		id: "fluid-goo",
		x: 0,
		y: 0,
		width: gw,
		height: gh,
		max: 60,
		seed: 9,
		emitter: { shape: "circle", x: gw / 2, y: gh / 2, radius: 200, rate: 14 },
		lifetime: [5, 7],
		speed: [20, 70],
		spread: 360,
		drag: 0.4,
		noise: { strength: 120, scale: 220, speed: 0.4 },
		attractors: [{ x: gw / 2, y: gh / 2, strength: 160, radius: 400 }],
		size: [150, 80],
		sizeJitter: 0.5,
		fade: [0.05, 0.1],
		shape: "circle",
		color: [PINK, VIOLET, CYAN],
		prewarm: 6,
	} as never).withEffect(
		new Gooey({ radius: 26, threshold: 0.5, softness: 0.06 }),
	);

	// Trails: a light pen on a Lissajous path; the effect keeps fading copies that zoom and shift hue.
	const tw = 900;
	const th = 270;
	const pen = Layer.particles({
		id: "fluid-pen",
		x: 0,
		y: 0,
		width: tw,
		height: th,
		max: 4000,
		seed: 2,
		emitter: {
			shape: "point",
			x: (f: number) => tw / 2 + Math.sin((f - c.start) / 11) * 330,
			y: (f: number) => th / 2 + Math.sin((f - c.start) / 7) * 80,
			rate: 900,
		},
		lifetime: [0.3, 0.6],
		speed: [0, 30],
		spread: 360,
		size: [30, 8],
		fade: [0, 0.5],
		shape: "soft",
		blend: "add",
		color: [WHITE, SKY, SIGNAL],
	} as never).withEffect(
		new Trails({
			decay: 0.96,
			mode: "max",
			zoom: 1.012,
			hueShift: 9,
			warmup: 40,
		}),
	);

	// Liquify: a static twirl lens over a poster that Ken Burns pans underneath.
	const lw = 900;
	const lh = 270;
	const posterW = 1800;
	const posterH = 540;
	const poster = await still("fluid-poster", posterW, posterH, [
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: posterW,
			height: posterH,
			background: Gradient.linear([VIOLET, PINK, EMBER, GOLD], 90),
		}),
		...[0, 1, 2, 3].map((row) =>
			Layer.text("BEND · TWIST · MELT · WARP · ", {
				position: "absolute",
				x: -row * 160,
				y: row * 135 - 10,
				width: posterW + 800,
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 120,
				letterSpacing: -2,
				fill: row % 2 ? INK : PAPER,
			}),
		),
	]);
	const liquid = Layer.image(poster, {
		id: "fluid-poster",
		position: "absolute",
		x: 0,
		y: 0,
		width: lw,
		height: lh,
		fit: "cover",
	}).withEffects([
		// Scroll the poster through the frame (wrapping), so the lens has something moving under it.
		new TileOffset({
			offsetX: Signal.programmatic((ctx) => (ctx.frame - c.start) * 7),
			offsetY: 0,
			wrap: true,
			edgeMode: "wrap",
		}),
		new Liquify({
			operations: [
				{
					type: "TwirlCW",
					x: 0.5,
					y: 0.5,
					radius: 0.45,
					strength: 1,
					dx: 0,
					dy: 0,
				},
				{
					type: "Bloat",
					x: 0.5,
					y: 0.5,
					radius: 0.3,
					strength: 0.8,
					dx: 0,
					dy: 0,
				},
			],
		}),
	]);

	// The EQ curve: the response of the low-pass the stems run through, redrawn every 2 frames.
	const ew = 1760;
	const eh = 104;
	const curve = (frame: number) => {
		const fc = lowpassAt(frame);
		let d = "";
		for (let i = 0; i <= 120; i++) {
			const f = 20 * 1000 ** (i / 120);
			const db = Math.max(-36, Math.min(6, lowpassDb(f, fc)));
			const x = (i / 120) * ew;
			const y = eh * 0.25 - (db / 36) * eh * 0.75;
			d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
		}
		return d;
	};
	const eqKeys: Array<[number, string]> = [];
	for (let f = 0; f <= c.frames; f += 2) eqKeys.push([f, curve(c.start + f)]);
	// A marker at the cutoff, riding the curve.
	const markerKeys: Array<[number, number, string]> = [];
	for (let f = 0; f <= c.frames; f += 2) {
		const fc = lowpassAt(c.start + f);
		const u = Math.log(fc / 20) / Math.log(1000);
		markerKeys.push([f, Math.round(u * ew) - 9, "none"]);
	}

	return scene("fluid", BG, [
		full({
			background: Gradient.radial([Color.alpha(SKY, 0.3), "transparent"]),
		}),
		Layer.text("Warp, melt, echo", {
			id: "fluid-title",
			position: "absolute",
			x: 80,
			y: 84,
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 76,
			letterSpacing: -2,
			fill: FG,
		}).animate(
			keys("opacity", [
				[0, 0],
				[10, 1],
			]),
			keys("x", [
				[0, 30],
				[24, 80, "expo.out"],
			]),
		),
		panel("goo", 80, top, gw, gh, "Gooey · Layer.particles", [goo], 6),
		panel("trails", 940, top, tw, th, "Trails · light pen", [pen], 12),
		panel(
			"liquify",
			940,
			top + th + 20,
			lw,
			lh,
			"TileOffset(signal) → Liquify(TwirlCW, Bloat)",
			[liquid],
			18,
		),
		// The live EQ.
		Layer.box({
			id: "fluid-eq",
			position: "absolute",
			x: 80,
			y: 776,
			width: ew,
			height: eh,
			children: [
				Layer.box({
					position: "absolute",
					x: 0,
					y: eh * 0.25,
					width: ew,
					height: 1,
					background: LINE,
				}),
				Layer.shape("path", {
					id: "fluid-eq-curve",
					position: "absolute",
					x: 0,
					y: 0,
					width: ew,
					height: eh,
					d: eqKeys[0][1],
					fillType: "none",
					fillColor: "transparent",
					strokeColor: COBALT,
					strokeWidth: 4,
				}).animate(keys("d", eqKeys)),
				// At the cutoff the response is -3 dB, so the marker rides at that height.
				Layer.shape("circle", {
					id: "fluid-eq-marker",
					position: "absolute",
					x: 0,
					y:
						Math.round(eh * 0.25 - (lowpassDb(1000, 1000) / 36) * eh * 0.75) -
						9,
					width: 18,
					height: 18,
					fillColor: COBALT,
				}).animate(keys("x", markerKeys)),
				Layer.text(
					"the low-pass on the music right now: AudioParametricEq({ frequency: signal })",
					{
						id: "fluid-eq-label",
						position: "absolute",
						x: 0,
						y: eh + 6,
						width: ew,
						align: "end",
						fontFamily: MONO,
						fontSize: 19,
						fill: MUTED,
					},
				),
			],
		}).animate(
			keys("opacity", [
				[0, 0],
				[24, 0],
				[40, 1],
			]),
		),
		full({ id: "fluid-dim", background: BG, opacity: 0 }).animate(
			keys("opacity", [
				[c.frames - 4, 0],
				[c.frames, 0.6],
			]),
		),
		hud(
			"fluid",
			[
				"Gooey",
				"Trails",
				"Liquify",
				"TileOffset",
				"AudioParametricEq(frequency: signal)",
			],
			{ until: c.frames },
		),
	]);
}
