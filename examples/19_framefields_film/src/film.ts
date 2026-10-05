/**
 * The 30-second film, assembled. Scenes overlap where a transition carries one
 * into the next; the score is the only audio and sets the grid (100 BPM):
 *
 *   0.0–10.2  open → film → grade      (piano, strings)
 *  10.2–19.8  motion → code            (the drop at 10.2)
 *  19.8–26.4  effects → track          (second drop at 19.8)
 *  26.4–30.0  resolve                  (final chord at 26.4, rings out)
 *
 * Every clip is muted; only `score.mp3` reaches the mix.
 */
import { Composition, FilmGrain, Layer } from "framefields";
import { codeScene } from "./scenes/code.js";
import { effectsScene } from "./scenes/effects.js";
import { filmScene } from "./scenes/film.js";
import { gradeScene } from "./scenes/grade.js";
import { motionScene } from "./scenes/motion.js";
import { openScene } from "./scenes/open.js";
import { resolveScene } from "./scenes/resolve.js";
import { trackScene } from "./scenes/track.js";
import { DURATION_FRAMES, FPS, H, INK, W, asset, registerFonts } from "./theme.js";

export { trackScene };

export async function buildFilm(): Promise<Composition> {
	await registerFonts();

	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION_FRAMES / FPS) * 1000,
		backgroundColor: INK,
	});

	film.add(openScene());
	film.add(filmScene());
	film.add(gradeScene());
	film.add(motionScene());
	film.add(codeScene());
	film.add(effectsScene());
	film.add(trackScene());
	film.add(resolveScene());
	film.add(Layer.audio(asset("score.mp3"), { id: "score", volume: 1 }));

	// One shared emulsion over everything keeps paper, footage and type in the same world.
	film.apply(new FilmGrain({ strength: 0.05, size: 1.6, animated: true }));

	return film;
}
