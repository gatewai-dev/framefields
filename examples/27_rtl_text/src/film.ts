import { Composition, Layer, Transition } from "framefields";
import { ARABIC_FRAMES, arabicScene } from "./scenes/arabic.js";
import { HEBREW_FRAMES, hebrewScene } from "./scenes/hebrew.js";
import { THREE_D_FRAMES, threeDScene } from "./scenes/three-d.js";
import { FPS, H, PAPER, registerFonts, W } from "./theme.js";

const sequence = () =>
	Layer.sequence(
		[
			{ scene: arabicScene(), duration: ARABIC_FRAMES },
			{
				scene: hebrewScene(),
				duration: HEBREW_FRAMES,
				transition: Transition.push("right", 18),
			},
			{
				scene: threeDScene(),
				duration: THREE_D_FRAMES,
				transition: Transition.fadeThrough(16),
			},
		],
		{ width: W, height: H },
	);

const TRANSITIONS = 18 + 16;
/** Total length in frames: the scenes back to back, less the transition overlaps. */
export const DURATION =
	ARABIC_FRAMES + HEBREW_FRAMES + THREE_D_FRAMES - TRANSITIONS;

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: PAPER,
	});
	// Scenes are built after the fonts are registered: extruded text and the
	// caption measurements read the real outlines.
	const scenes = sequence();
	if (scenes.totalFrames !== DURATION) {
		throw new Error(
			`Sequence is ${scenes.totalFrames} frames, expected ${DURATION}`,
		);
	}
	film.add(scenes);
	return film;
}
