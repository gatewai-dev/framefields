import {
	CameraAnimation,
	Composition,
	FilmGrain,
	Layer,
	Layer3D,
	LayerAnimation,
	Vignette,
} from "framefields";
import { keyboard } from "./keyboard.js";
import { animateKey } from "./motion.js";
import {
	ACCENT,
	BG,
	FPS,
	H,
	MONO,
	MUTED,
	registerFonts,
	SANS,
	TEXT,
	W,
} from "./theme.js";
import {
	ASSEMBLE,
	DURATION,
	LINE,
	STROKES,
	TITLE_AT,
	TYPE_FROM,
	WAVE_FROM,
} from "./timeline.js";

export { DURATION };

/** The keyboard sits at the world origin of the shot: the screen's center. */
const CX = W / 2;
const CY = H / 2;

type Key = [frame: number, value: number | string, ease?: string];

/**
 * Three moves: a low three-quarter swing in while it assembles, a slow
 * push over the typing, then a rise to near top-down for the wave.
 */
function camera() {
	return CameraAnimation.camera()
		.keys("orbitAzimuth", [
			[0, -42],
			[100, -14, "power2.inOut"],
			[WAVE_FROM - 12, 6, "sine.inOut"],
			[WAVE_FROM + 50, 0, "power3.inOut"],
		])
		.keys("orbitElevation", [
			[0, 12],
			[100, 30, "power2.inOut"],
			[WAVE_FROM - 12, 38, "sine.inOut"],
			[WAVE_FROM + 50, 68, "power3.inOut"],
		])
		.keys("orbitRadius", [
			[0, 2500],
			[100, 1520, "power2.inOut"],
			[WAVE_FROM - 12, 1180, "sine.inOut"],
			[WAVE_FROM + 50, 1640, "power3.inOut"],
		]);
}

/** JetBrains Mono advances 0.6 em per character, so the caret can be placed by count. */
const LINE_SIZE = 60;
const ADVANCE = LINE_SIZE * 0.6;
const LINE_X = CX - (LINE.length * ADVANCE) / 2;
const LINE_Y = 118;

/** The typed line: revealed one character per keystroke, frame-exact. */
function typedLine() {
	// `text` above 1 is a character count; 1 and below a fraction of the line.
	const reveal: Key[] = [[0, 0]];
	for (const s of STROKES) {
		reveal.push([s.at, s.count === 1 ? 1 / LINE.length : s.count, "hold"]);
	}
	const caretX: Key[] = [[0, LINE_X]];
	for (const s of STROKES) {
		caretX.push([s.at, LINE_X + s.count * ADVANCE, "hold"]);
	}
	// Steady while typing, blinking at rest; it goes when the wave starts.
	const blink: Key[] = [[0, 0]];
	const typingFrom = STROKES[0]!.at;
	const typingTo = STROKES[STROKES.length - 1]!.at;
	for (let f = TYPE_FROM - 24; f < WAVE_FROM; f += 16) {
		const typing = f + 16 > typingFrom && f < typingTo + 8;
		blink.push([f, 1, "hold"], [f + 8, typing ? 1 : 0, "hold"]);
	}
	blink.push([WAVE_FROM, 0, "hold"]);
	return [
		Layer.text(LINE, {
			id: "typed",
			position: "absolute",
			x: LINE_X,
			y: LINE_Y,
			fontFamily: MONO,
			fontSize: LINE_SIZE,
			fill: TEXT,
		}).animate(LayerAnimation.create().keys("text", reveal)),
		Layer.box({
			id: "caret",
			position: "absolute",
			x: LINE_X,
			y: LINE_Y + 4,
			width: 5,
			height: LINE_SIZE + 6,
			background: ACCENT,
			borderRadius: 2,
		}).animate(
			LayerAnimation.create().keys("x", caretX).keys("opacity", blink),
		),
	];
}

function caption() {
	return Layer.text("A Mac keyboard, built from framefields 3D primitives", {
		id: "caption",
		position: "absolute",
		x: 0,
		y: H - 120,
		width: W,
		align: "center",
		fontFamily: SANS,
		fontSize: 30,
		fill: MUTED,
		letterSpacing: 0.5,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[TITLE_AT, 0],
				[TITLE_AT + 24, 1, "power2.out"],
			])
			.keys("y", [
				[TITLE_AT, H - 100],
				[TITLE_AT + 30, H - 120, "expo.out"],
			]),
	);
}

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: BG,
	});
	film.add([
		Layer.camera({
			id: "cam",
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: camera(),
		} as never),
		Layer.directionalLight({
			id: "key-light",
			color: "#ffffff",
			intensity: 0.7,
			direction: [-0.35, 1, 0.45],
		} as never),
		// A warm-white pool overhead: it falls off across the floor like a studio spot.
		Layer.pointLight({
			id: "pool",
			color: "#fff6ea",
			intensity: 0.9,
			x: CX,
			y: CY - 900,
			z: -150,
			radius: 2600,
			decay: 1.2,
		}),
		Layer.ambientLight("#ffffff", 0.22, { id: "fill" }),
		Layer3D.roundedBox({
			id: "floor",
			width: 60000,
			height: 10,
			depth: 60000,
			x: CX,
			y: CY + 13,
			z: 0,
			color: "#17181c",
			roughness: 0.9,
			specularIntensity: 0.05,
		}),
		keyboard({
			id: "kb",
			x: CX,
			y: CY,
			z: 0,
			animateKey,
			body: LayerAnimation.create()
				.keys("opacity", [
					[ASSEMBLE.body, 0],
					[ASSEMBLE.body + 14, 1, "power1.out"],
				])
				.keys("y", [
					[ASSEMBLE.body, 70],
					[ASSEMBLE.body + 22, 0, "expo.out"],
				]),
		}),
		...typedLine(),
		caption(),
	]);
	// Fine grain dithers the floor's light pool, which would band in 8 bits.
	film.apply(new Vignette({ strength: 18, radius: 0.9, softness: 0.75 }));
	film.apply(new FilmGrain({ strength: 3, size: 1.2, animated: true }));
	return film;
}
