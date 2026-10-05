/**
 * The hook, four lines in four bars. A dot lands with the first sound and a
 * ring draws around it; then the camera leaps through depth from phrase to
 * phrase, arriving as each is sung (a word never shows before its syllable).
 * "commit" gets its commit, "no timeline" a timeline that is struck out, and
 * on "hit" the camera dives through the brand mark into the logo.
 */
import { Layer, LayerAnimation } from "framefields";
import { BEAT } from "../grid.js";
import { type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	CAM_Z,
	circlePath,
	EASE_IN,
	EASE_OUT,
	FG,
	H,
	type Key,
	keys,
	logoMark,
	MONO,
	MUTED,
	plane,
	SNAP,
	SURFACE,
	scene,
	sungLine,
	W,
} from "../theme.js";

const CX = W / 2;
const CY = H / 2;
/** Eye height above the look point: the camera looks slightly down onto the floor. */
const LIFT = 160;
const STEP_Z = 820;

/** The logo takes over on the beat "Framefields!" is sung in. */
export const OPEN_TO = Math.floor(sung("framefields").at / BEAT) * BEAT;

interface Stop {
	words: SungWord[];
	z: number;
	x: number;
	size: number;
	weight: number;
	color?: string;
	font?: string;
}

/** The words of the hook, grouped into the phrases the camera stops at. */
function stops(): Stop[] {
	const after = (t: string, w: SungWord) => sung(t, w.at + 1);
	const what = sung("what");
	const what2 = after("what", what);
	const commit = sung("commit", what2.at);
	const no = sung("no");
	const no2 = after("no", no);
	const hit = sung("hit");
	const just2 = sung("just", no2.at);
	const groups: [SungWord[], Partial<Stop>][] = [
		[[what, sung("if")], { weight: 300 }],
		[[sung("video")], { size: 230 }],
		[[sung("was")], { weight: 300 }],
		[[sung("just")], { weight: 300 }],
		[[sung("code")], { size: 260, color: ACCENT }],
		[[what2, sung("if", what2.at)], { weight: 300 }],
		[[sung("motion")], { size: 230 }],
		[[sung("shipped")], { weight: 300 }],
		[[sung("in", what2.at), sung("a", what2.at)], { weight: 300 }],
		[[commit], { size: 230, color: ACCENT }],
		[[no, sung("timeline")], {}],
		[[no2, sung("render", no2.at), sung("farm")], {}],
		[
			[just2, sung("type", just2.at), sung("it", just2.at)],
			{ font: MONO, weight: 600 },
		],
		[
			[sung("and", just2.at), sung("let"), sung("it", sung("let").at)],
			{ weight: 300 },
		],
		[[hit], { size: 300, color: ACCENT }],
	];
	return groups.map(([words, o], i) => {
		// Wide phrases shrink to fit the lens at the stop's distance (~0.75 em a character).
		const chars = words.reduce((n, w) => n + w.text.length + 1, 0);
		const size = Math.min(o.size ?? 170, Math.round(1450 / (chars * 0.75)));
		return {
			words,
			z: 900 + i * STEP_Z,
			x: CX + (i % 2 ? 200 : -200) * (i === groups.length - 1 ? 0 : 1),
			weight: 900,
			...o,
			size,
		};
	});
}

const MARK_Z = (n: number) => 900 + n * STEP_Z + 900;

function phrase(s: Stop, i: number, list: Stop[]) {
	const next = list[i + 1];
	return sungLine({
		id: `open-line-${i}`,
		words: s.words,
		from: 0,
		x: s.x - 900,
		width: 1800,
		y: CY - s.size * 0.65,
		size: s.size,
		weight: s.weight,
		font: s.font,
		color: s.color,
		enter: "rise",
		z: s.z,
		// Passed phrases leave as the camera leaps on, or they fill the lens;
		// the last clears as the camera dives, so the logo is seen whole.
		outAt: next ? next.words[0].at - 4 : OPEN_TO - 12,
	});
}

/** Camera track: leap to each phrase as it is sung, then dive through the mark. */
function cameraKeys(list: Stop[], diveTo: number) {
	const z: Key[] = [[0, -CAM_Z - 600]];
	const x: Key[] = [[0, CX]];
	for (const s of list) {
		const at = s.words[0].at;
		const from = Math.max(z[z.length - 1][0] + 1, at - 10);
		z.push([from, z[z.length - 1][1]], [at + 4, s.z - CAM_Z * 0.9, EASE_OUT]);
		x.push([from, x[x.length - 1][1]], [at + 6, s.x, EASE_OUT]);
	}
	const last = z[z.length - 1];
	z.push(
		[Math.max(last[0] + 1, OPEN_TO - 10), last[1]],
		[OPEN_TO, diveTo, EASE_IN],
	);
	return { x, z };
}

/** "…in a commit?": the commit itself, hashed and messaged, under the word. */
function commitChip(s: Stop) {
	return Layer.text("●  a3f9c2e  feat: motion", {
		id: "open-commit",
		is3D: true,
		position: "absolute",
		x: s.x - 500,
		y: CY + 120,
		z: s.z,
		width: 1000,
		fontFamily: MONO,
		fontSize: 40,
		fontWeight: 600,
		fill: FG,
		align: "center",
	} as never).animate(
		LayerAnimation.create().typewriter(
			s.words[0].at + 2,
			s.words[0].at + 16,
			"none",
		),
	);
}

/** "No timeline": an editor's timeline, three tracks of clips, struck through on the next "no". */
function timeline(s: Stop, strikeAt: number) {
	const z = s.z + 40;
	const clips: [track: number, x: number, w: number, color: string][] = [
		[0, 0, 360, ACCENT],
		[0, 380, 520, SURFACE],
		[1, 120, 300, FG],
		[1, 440, 260, ACCENT],
		[2, 0, 700, SURFACE],
	];
	return [
		...clips.map(([t, x, w, color], i) =>
			Layer.box({
				id: `open-clip-${i}`,
				is3D: true,
				position: "absolute",
				x: s.x - 450 + x,
				y: CY + 110 + t * 56,
				z,
				width: w,
				height: 44,
				borderRadius: 10,
				background: color,
				startFrame: s.words[1].at,
			} as never).animate(
				keys("scaleX", [
					[0, 0],
					[8 + i * 2, 1, EASE_OUT],
				]),
			),
		),
		Layer.shape("path", {
			id: "open-strike",
			is3D: true,
			position: "absolute",
			x: s.x - 520,
			y: CY - 40,
			z: z - 20,
			width: 1040,
			height: 300,
			d: "M 0 300 L 1040 0",
			fillType: "none",
			strokeColor: ACCENT,
			strokeWidth: 26,
			strokeLineCap: "round",
			startFrame: strikeAt,
		} as never).animate(
			keys("trimEnd", [
				[0, 0],
				[8, 1, EASE_OUT],
			]),
		),
	];
}

/** The logo waiting at the end of the flight. */
function brandMark(z: number, appearAt: number) {
	return logoMark({
		id: "open-mark",
		size: 460,
		x: CX,
		y: CY,
		z,
		startFrame: appearAt,
	});
}

export function openScene() {
	const list = stops();
	const markZ = MARK_Z(list.length);
	const cam = cameraKeys(list, markZ - 30);
	const camAnim = keys(
		"cameraZ",
		cam.z,
		keys("cameraX", cam.x, keys("targetX", cam.x)),
	);
	keys(
		"targetZ",
		cam.z.map(([f, v, e]) => [f, (v as number) + CAM_Z, e] as Key),
		camAnim,
	);
	keys(
		"cameraRoll",
		[
			[0, 0],
			[OPEN_TO - 12, 0],
			[OPEN_TO, -10, EASE_IN],
		],
		camAnim,
	);

	const dot = 36;
	const ringR = 150;
	const commit = list.find((s) => s.words[0].text.startsWith("commit"));
	const tl = list.find((s) => s.words[1]?.text.startsWith("timeline"));
	const strike = list.find((s) => s.words[1]?.text.startsWith("render"));
	return scene("open", 0, OPEN_TO, [
		Layer.camera({
			id: "open-cam",
			x: CX,
			y: CY - LIFT,
			z: -CAM_Z,
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: camAnim,
		} as never),
		Layer.shape("ellipse", {
			id: "open-dot",
			is3D: true,
			position: "absolute",
			x: CX - dot / 2,
			y: CY - dot / 2,
			z: 0,
			width: dot,
			height: dot,
			fillColor: ACCENT,
		} as never).animate(
			keys("scale", [
				[0, 0],
				[2, 0],
				[10, 1, SNAP],
			]),
		),
		Layer.shape("path", {
			id: "open-ring",
			is3D: true,
			position: "absolute",
			x: CX - ringR,
			y: CY - ringR,
			z: 0,
			width: ringR * 2,
			height: ringR * 2,
			d: circlePath(ringR),
			fillType: "none",
			strokeColor: FG,
			strokeWidth: 3,
		} as never).animate(
			keys("trimEnd", [
				[0, 0],
				[list[0].words[0].at + 14, 1, EASE_OUT],
			]),
		),
		...list.map((s, i) => phrase(s, i, list)),
		...(commit ? [commitChip(commit)] : []),
		...(tl && strike ? timeline(tl, strike.words[0].at) : []),
		Layer.text("SERVER RACK  ×  0", {
			id: "open-farm",
			is3D: true,
			position: "absolute",
			x: (strike?.x ?? CX) - 500,
			y: CY + 120,
			z: strike?.z ?? 0,
			width: 1000,
			fontFamily: MONO,
			fontSize: 34,
			fontWeight: 600,
			letterSpacing: 8,
			fill: MUTED,
			align: "center",
			startFrame: strike?.words[2]?.at ?? 0,
		} as never),
		brandMark(markZ, list[list.length - 1].words[0].at + 2),
		// Through the mark: the frame floods with the accent as the logo whips in.
		plane("open-burn", ACCENT).animate(
			keys("opacity", [
				[0, 0],
				[OPEN_TO - 6, 0],
				[OPEN_TO - 1, 1, EASE_IN],
			]),
		),
	]);
}
