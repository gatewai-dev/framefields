/**
 * The typography verse, set in its own words.
 *   "Every letter razor sharp"        LETTER cycles through every face on sixteenths;
 *                                     RAZOR SHARP is zoomed 40× on the GPU
 *   "bend the words around the arc"   the line builds along a rainbow arc as it is sung
 *   "type that moves the way you speak"  each word lands on its spoken syllable
 *   "split it, stagger it, spin it sweet"  each verb is the text animator it names
 *   "every font a different feel"     a face per word, FONT flickering through them all
 *   "kinetic on every beat"           each word slams into its own row, and the row runs:
 *                                     a wall of faces sliding against each other
 *   "Step inside the camera"          the wall closes into a viewfinder and the lens rushes it
 */
import {
	Layer,
	LayerAnimation,
	TextAnimator,
	TextPathBuilder,
} from "gitframes";
import { BEAT, bar } from "../grid.js";
import { kickPulse } from "../hits.js";
import { bare, lineSpan, lineWords, type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	DISPLAY,
	EASE_IN,
	EASE_OUT,
	FG,
	GUEST,
	H,
	keys,
	MUTED,
	SNAP,
	scene,
	sungLine,
	W,
	word,
} from "../theme.js";
import { CH } from "../timeline.js";

const CX = W / 2;
const CY = H / 2;
const SIXTEENTH = BEAT / 4;
const FACES = Object.values(GUEST);

/** "LETTER" set in a different face on every sixteenth until "razor". */
function letterFlicker(at: number, until: number) {
	const out = [];
	for (let f = at, i = 0; f < until; f += SIXTEENTH, i++) {
		out.push(
			Layer.text("LETTER", {
				id: `type-letter-${i}`,
				position: "absolute",
				x: 0,
				y: CY - 40,
				width: W,
				height: 260,
				fontFamily: FACES[i % FACES.length],
				fontSize: 200,
				fill: i % 4 === 0 ? ACCENT : FG,
				align: "center",
				verticalAlign: "middle",
				startFrame: f,
				durationFrames: Math.min(SIXTEENTH, until - f),
			}),
		);
	}
	return out;
}

/** RAZOR SHARP, then the dive: 40× through the space between the words. */
function razor(
	razorW: SungWord,
	sharpW: SungWord,
	until: number,
	from: number,
) {
	const at = razorW.at - from;
	const dive = sharpW.at - from;
	const end = until - from;
	return Layer.text("RAZOR SHARP", {
		id: "type-razor",
		position: "absolute",
		x: 0,
		y: CY - 110,
		width: W,
		height: 220,
		fontFamily: DISPLAY,
		fontWeight: 900,
		fontSize: 170,
		fill: FG,
		align: "center",
		verticalAlign: "middle",
		anchorX: 0.5,
		anchorY: 0.5,
		startFrame: at,
		durationFrames: end - at,
		animators: [
			TextAnimator.blurIn({ blur: 18, y: 0, opacity: 0, easing: EASE_OUT }),
		],
	}).animate(
		LayerAnimation.create()
			.kineticSweep(-1, 1, 0, dive - at, "power2.out")
			.fromTo("scale", 1, 40, {
				start: dive - at + 6,
				end: end - at,
				ease: "expo.in",
			}),
	);
}

/** Character offsets where each word of a line ends, as a 0–1 fraction of the line. */
function revealPoints(words: SungWord[]): number[] {
	const text = words.map((w) => bare(w)).join(" ");
	let chars = 0;
	return words.map((w) => {
		chars += bare(w).length + 1;
		return Math.min(1, chars / text.length);
	});
}

/** The rainbow: an upper half circle the line is forced along, reading upright left to right. */
const ARC_R = 700;
const ARC_SIZE = 84;
/** Unbounded 900 caps (spaces included) average about 0.86 em. */
const ARC_EM = 0.86;
const ARC_CY = CY + 330;

function arcPath(r: number): string {
	return `M ${CX - r} ${ARC_CY} A ${r} ${r} 0 0 1 ${CX + r} ${ARC_CY}`;
}

/**
 * "bend the words around the arc": the line is laid along the arc and each
 * word fades up as it is sung; the arc itself draws beneath the voice, and
 * the whole bend swings up from flat as the line runs.
 */
function arc(line: number, from: number, to: number) {
	const words = lineWords(line);
	const text = words.map((w) => bare(w).toUpperCase()).join(" ");
	// The typewriter's progress (the text track) steps on each sung word:
	// a word appears in four frames on its syllable, never ahead of it.
	const points = revealPoints(words);
	const anim = keys("text", [[0, 0]]);
	for (const [i, p] of points.entries()) {
		const at = words[i].at - from;
		if (at > 0) anim.keyframe("text", at - 1, points[i - 1] ?? 0, "none");
		anim.keyframe("text", at + 4, p, "none");
	}
	void to;
	return [
		Layer.shape("path", {
			id: "type-arc-line",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			d: arcPath(ARC_R - 120),
			fillType: "none",
			strokeColor: ACCENT,
			strokeWidth: 10,
			strokeLineCap: "round",
		} as never).animate(
			keys("trimEnd", [
				[0, 0],
				[words[words.length - 1].at - from + 6, 1, EASE_OUT],
			]),
		),
		Layer.text(text, {
			id: "type-arc",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fontFamily: DISPLAY,
			fontWeight: 900,
			fontSize: ARC_SIZE,
			fill: FG,
			// Centred on the arc by its estimated width, so it grows in place.
			pathOptions: TextPathBuilder.fromSvg(arcPath(ARC_R))
				.firstMargin(
					Math.max(0, (Math.PI * ARC_R - text.length * ARC_EM * ARC_SIZE) / 2),
				)
				.build(),
		} as never).animate(anim),
	];
}

/** Each word of the line lands on its spoken syllable; the row is laid out by flexbox. */
function spoken(line: number, from: number, to: number) {
	const words = lineWords(line);
	return Layer.flex({
		id: "type-spoken",
		position: "absolute",
		x: 160,
		y: CY - 120,
		width: W - 320,
		dir: "row",
		wrap: true,
		justify: "center",
		align: "center",
		gap: 28,
		durationFrames: to - from,
		children: words.map((w, i) =>
			Layer.text(bare(w).toLowerCase(), {
				id: `type-spoken-${i}`,
				fontFamily: GUEST.fraunces,
				fontWeight: 700,
				fontSize: 120,
				fill: i === words.length - 1 ? ACCENT : FG,
				startFrame: w.at - from,
			}).animate(
				LayerAnimation.create()
					.fromTo("opacity", 0, 1, { start: 0, end: 4, ease: "none" })
					.fromTo("y", 40, 0, { start: 0, end: 12, ease: SNAP }),
			),
		),
	});
}

/**
 * "split it, stagger it, spin it sweet": each verb is set with the text
 * animator it names, the "it"s small between them.
 */
function verbs(line: number, from: number, until: number) {
	const words = lineWords(line);
	const size = 130;
	const verb = (w: SungWord, i: number) => {
		const key = bare(w).toLowerCase();
		const at = w.at - from;
		const animators =
			key === "stagger"
				? [
						TextAnimator.waveRise({
							y: 140,
							rotationX: 90,
							opacity: 0,
							easing: "back.out(1.4)",
						}),
					]
				: key === "spin"
					? [
							{
								id: "spin",
								unit: "character",
								rangeStart: 0,
								rangeEnd: 1,
								offset: -1,
								easing: "back.out(1.2)",
								transform: { rotation: 360, scale: 0, opacity: 0 },
							},
						]
					: key === "sweet"
						? [TextAnimator.blurIn({ blur: 24, y: 30 })]
						: [TextAnimator.wordPop({ scale: 0.4 })];
		const small = key === "it";
		if (key === "split") {
			// SPLIT comes in as two halves that slam together from either side.
			const half = (text: string, from: number, k: number) =>
				Layer.text(text, {
					id: `type-verb-${i}-${k}`,
					fontFamily: DISPLAY,
					fontWeight: 900,
					fontSize: size,
					fill: FG,
				}).animate(
					LayerAnimation.create()
						.fromTo("x", from, 0, { start: 0, end: 10, ease: EASE_OUT })
						.fromTo("opacity", 0, 1, { start: 0, end: 3, ease: "none" }),
				);
			return Layer.flex({
				id: `type-verb-${i}`,
				dir: "row",
				startFrame: at,
				children: [half("SPL", -260, 0), half("IT", 260, 1)],
			} as never);
		}
		return Layer.text(small ? "it" : bare(w).toUpperCase(), {
			id: `type-verb-${i}`,
			fontFamily:
				key === "sweet" ? GUEST.fraunces : small ? GUEST.fraunces : DISPLAY,
			fontWeight: small ? 400 : 900,
			fontSize: small ? 80 : size,
			fill: key === "sweet" ? ACCENT : small ? MUTED : FG,
			startFrame: at,
			animators,
		} as never).animate(
			LayerAnimation.create().kineticSweep(
				-1,
				1,
				0,
				key === "stagger" ? 16 : 12,
				"power2.out",
			),
		);
	};
	// Three rows: SPLIT it / STAGGER it / SPIN it SWEET.
	const rows: SungWord[][] = [[], [], []];
	let r = 0;
	for (const w of words) {
		rows[r].push(w);
		if (bare(w).toLowerCase() === "it" && r < 2) r++;
	}
	let k = 0;
	return Layer.flex({
		id: "type-verbs",
		position: "absolute",
		x: 0,
		y: CY - 300,
		width: W,
		dir: "column",
		align: "center",
		gap: 10,
		durationFrames: until - from,
		children: rows.map((row, i) =>
			Layer.flex({
				id: `type-verbs-row-${i}`,
				dir: "row",
				align: "end",
				gap: 30,
				children: row.map((w) => verb(w, k++)),
			}),
		),
	});
}

/** "every font a different feel": a face per word; FONT itself flickers through all of them. */
function faces(line: number, from: number, until: number) {
	const words = lineWords(line);
	const fontWord = words.find((w) => bare(w).toLowerCase() === "font");
	const next = words[words.indexOf(fontWord ?? words[0]) + 1];
	const set = [
		GUEST.anton,
		DISPLAY,
		GUEST.michroma,
		GUEST.monoton,
		GUEST.fraunces,
	];
	const flicker: ReturnType<typeof Layer.text>[] = [];
	if (fontWord && next)
		for (
			let f = fontWord.at - from, i = 0;
			f < until - from;
			f += SIXTEENTH, i++
		)
			flicker.push(
				Layer.text("FONT", {
					id: `type-font-${i}`,
					position: "absolute",
					x: 0,
					y: CY - 300,
					width: W,
					height: 260,
					fontFamily: FACES[i % FACES.length],
					fontSize: 210,
					fill: ACCENT,
					align: "center",
					verticalAlign: "middle",
					startFrame: f,
					durationFrames: SIXTEENTH,
				}),
			);
	const rest = words.filter((w) => w !== fontWord);
	return [
		...flicker,
		Layer.flex({
			id: "type-faces",
			position: "absolute",
			x: 0,
			y: CY + 20,
			width: W,
			dir: "row",
			justify: "center",
			align: "center",
			gap: 40,
			durationFrames: until - from,
			children: rest.map((w, i) =>
				Layer.text(bare(w).toUpperCase(), {
					id: `type-face-${i}`,
					fontFamily: set[i % set.length],
					fontSize: 120,
					fontWeight: set[i % set.length] === DISPLAY ? 900 : 400,
					fill: FG,
					startFrame: w.at - from,
				}).animate(
					LayerAnimation.create()
						.fromTo("opacity", 0, 1, { start: 0, end: 3, ease: "none" })
						.fromTo("scale", 1.4, 1, { start: 0, end: 10, ease: EASE_OUT }),
				),
			),
		}),
	];
}

const ROWS = 6;
const ROW_H = H / ROWS;
/** Each row keeps its own face; the kinetic words land in rows 1–4. */
const ROW_FACES = [
	GUEST.fraunces,
	DISPLAY,
	GUEST.anton,
	GUEST.dela,
	GUEST.shade,
	GUEST.michroma,
];
/** Rough advance of a face's caps, in em: sizes the run of copies a row needs. */
const CAP_EM = 0.95;

interface Row {
	text: string;
	/** Scene frame the centre copy lands (the word is sung). */
	at: number;
	/** Scene frame the rest of the row fills in and starts to run. */
	runAt: number;
	color: string;
}

/**
 * One row of the wall: copies of a word in a line, the centre one exactly
 * where the word slams in. The copies fill in either side and the row runs,
 * picking up speed, alternate rows in opposite directions.
 */
function row(r: Row, i: number, until: number) {
	const face = ROW_FACES[i];
	const size = Math.round(ROW_H * 0.72);
	const gap = Math.round(size * 0.45);
	const copyW = r.text.length * CAP_EM * size + gap;
	const dir = i % 2 ? 1 : -1;
	const travel = 1700;
	// Enough copies to cover the screen wherever the row has run to.
	const side = Math.ceil((W / 2 + travel + copyW) / copyW);
	const copies = side * 2 + 1;
	const span = 40000;
	return Layer.flex({
		id: `type-row-${i}`,
		position: "absolute",
		x: CX - span / 2,
		y: i * ROW_H,
		width: span,
		height: ROW_H,
		dir: "row",
		justify: "center",
		align: "center",
		gap,
		children: Array.from({ length: copies }, (_, k) => {
			const centre = k === side;
			const anim = centre
				? LayerAnimation.create()
						.fromTo("scale", 1.6, 1, {
							start: r.at,
							end: r.at + 9,
							ease: EASE_OUT,
						})
						.fromTo("opacity", 0, 1, {
							start: r.at,
							end: r.at + 3,
							ease: "none",
						})
				: LayerAnimation.create().fromTo("opacity", 0, 1, {
						start: r.runAt + Math.abs(k - side) * 2,
						end: r.runAt + Math.abs(k - side) * 2 + 4,
						ease: "none",
					});
			return Layer.text(r.text, {
				id: `type-row-${i}-${k}`,
				fontFamily: face,
				fontWeight: face === DISPLAY ? 900 : 400,
				fontSize: size,
				fill: centre ? r.color : i % 3 === 1 ? FG : MUTED,
				anchorX: 0.5,
				anchorY: 0.5,
				opacity: 0,
			}).animate(anim);
		}),
	}).animate(
		keys("x", [
			[r.runAt, CX - span / 2],
			[until, CX - span / 2 + dir * travel, "power2.in"],
		]),
	);
}

/**
 * The viewfinder's corners, drawn round the window the wall shrinks into on
 * "Step inside the camera".
 */
const FRAME_W = 1240;
const FRAME_H = 700;
const FRAME_L = CX - FRAME_W / 2;
const FRAME_T = CY - FRAME_H / 2;

function viewfinder(at: number) {
	const corner = (id: string, x: number, y: number, rot: number) =>
		Layer.shape("path", {
			id,
			position: "absolute",
			x,
			y,
			width: 120,
			height: 120,
			rotation: rot,
			d: "M 10 110 L 10 10 L 110 10",
			fillType: "none",
			strokeColor: ACCENT,
			strokeWidth: 14,
			strokeLineCap: "round",
		} as never).animate(
			keys("trimEnd", [
				[0, 0],
				[at, 0],
				[at + 12, 1, EASE_OUT],
			]),
		);
	const l = FRAME_L - 30;
	const t = FRAME_T - 30;
	const r = FRAME_L + FRAME_W - 90;
	const b = FRAME_T + FRAME_H - 90;
	return [
		corner("type-vf-tl", l, t, 0),
		corner("type-vf-tr", r, t, 90),
		corner("type-vf-br", r, b, 180),
		corner("type-vf-bl", l, b, 270),
	];
}

/**
 * The wall in a window: full frame until "Step", then an overflow-hidden box
 * closes to the viewfinder (the wall holds still inside it), and on the way
 * out into the 3D chapter the window rushes the lens.
 */
function window2D(
	children: unknown[],
	closeAt: number,
	pushAt: number,
	end: number,
) {
	const outer = LayerAnimation.create();
	const close = (prop: string, a: number, b: number) =>
		keys(
			prop as never,
			[
				[closeAt, a],
				[closeAt + 14, b, EASE_OUT],
			],
			outer,
		);
	close("x", 0, FRAME_L);
	close("y", 0, FRAME_T);
	close("width", W, FRAME_W);
	close("height", H, FRAME_H);
	close("borderRadius", 0, 36);
	const inner = LayerAnimation.create();
	keys(
		"x",
		[
			[closeAt, 0],
			[closeAt + 14, -FRAME_L, EASE_OUT],
		],
		inner,
	);
	keys(
		"y",
		[
			[closeAt, 0],
			[closeAt + 14, -FRAME_T, EASE_OUT],
		],
		inner,
	);
	return Layer.box({
		id: "type-lens",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		children: [
			Layer.box({
				id: "type-window",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				overflow: "hidden",
				children: [
					Layer.box({
						id: "type-window-hold",
						position: "absolute",
						x: 0,
						y: 0,
						width: W,
						height: H,
						children: children as never,
					}).animate(inner),
				],
			} as never).animate(outer),
		],
	}).animate(
		keys("scale", [
			[pushAt, 1],
			[end, 3.2, EASE_IN],
		]),
	);
}

export function typeScene() {
	const from = bar(CH.type);
	const to = bar(CH.world);
	const every = sung("every", from - BEAT);
	const letter = sung("letter", every.at);
	const razorW = sung("razor", letter.at);
	const sharp = sung("sharp", razorW.at);
	const bendLine = sharp.line + 1;
	const bend = lineSpan(bendLine);
	const speakLine = bendLine + 1;
	const speak = lineSpan(speakLine);
	const verbLine = speakLine + 1;
	const verb = lineSpan(verbLine);
	const faceLine = verbLine + 1;
	const face = lineSpan(faceLine);
	const kineticLine = faceLine + 1;
	const kin = lineWords(kineticLine);
	const kinEnd = lineSpan(kineticLine).end;
	// "Step inside the camera" is the wall's last line: the 3D chapter starts on "fly".
	const stepWords = lineWords(kineticLine + 1);
	const step = stepWords[0];
	const theCam = sung("the", step.at);
	const local = (f: number) => f - from;
	const fill = local(kinEnd) + 2;
	const rows: Row[] = [
		{ text: "gitframes", at: fill, runAt: fill, color: MUTED },
		...kin.map((w, i) => ({
			text: bare(w).toUpperCase(),
			at: local(w.at),
			runAt: local(w.at) + BEAT / 2,
			color: i === kin.length - 1 ? ACCENT : FG,
		})),
		{ text: "TYPE", at: fill + 4, runAt: fill + 4, color: MUTED },
	];

	const group = (
		id: string,
		at: number,
		until: number,
		children: unknown[],
		anim?: ReturnType<typeof LayerAnimation.create>,
	) => {
		const box = Layer.box({
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			startFrame: at - from,
			durationFrames: until - at,
			children: children as never,
		});
		return anim ? box.animate(anim) : box;
	};

	return scene("type", from, to, [
		word({
			id: "type-every",
			text: "EVERY",
			at: every.at - from,
			outAt: razorW.at - from,
			y: CY - 250,
			size: 90,
			weight: 300,
			color: MUTED,
		}),
		...letterFlicker(letter.at - from, razorW.at - from),
		razor(razorW, sharp, bend.at - 4, from),
		// The bend swings up from flat as the line runs.
		group(
			"type-arc-group",
			bend.at - 4,
			speak.at - 2,
			arc(bendLine, bend.at - 4, speak.at),
			LayerAnimation.create().fromTo("rotation", -10, 4, {
				start: 0,
				end: speak.at - bend.at,
				ease: "sine.inOut",
			}),
		),
		group("type-spoken-group", speak.at - 2, verb.at - 2, [
			spoken(speakLine, speak.at - 2, verb.at),
		]),
		group("type-verbs-group", verb.at - 2, face.at - 2, [
			verbs(verbLine, verb.at - 2, face.at - 2),
		]),
		group(
			"type-faces-group",
			face.at - 2,
			kin[0].at - 2,
			faces(faceLine, face.at - 2, kin[0].at - 2),
		),
		window2D(
			[
				Layer.box({
					id: "type-wall",
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					children: rows.map((r, i) => row(r, i, to - from)),
				}).animate(
					LayerAnimation.create().signal("scale", kickPulse(), {
						multiplier: 0.04,
						offset: 1,
					}),
				),
			],
			step.at - from,
			to - from - 12,
			to - from,
		),
		...viewfinder(step.at - from),
		sungLine({
			id: "type-step",
			words: stepWords.filter((w) => w.at < theCam.at),
			from,
			y: 40,
			size: 96,
			weight: 300,
			enter: "rise",
			outAt: to - from - 12,
		}),
		sungLine({
			id: "type-camera",
			words: stepWords.filter((w) => w.at >= theCam.at),
			from,
			y: FRAME_T + FRAME_H + 30,
			size: 110,
			color: ACCENT,
			enter: "rise",
			outAt: to - from - 12,
		}),
	]);
}
