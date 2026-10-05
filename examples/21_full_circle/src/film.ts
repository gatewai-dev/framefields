/**
 * Full Circle, assembled. Plates, ring and captions come from the edit
 * (edit.ts); the scenes add the words, the flashes and the fades. The score
 * is the clock: every frame number below derives from its measured grid.
 */
import {
	Composition,
	FilmGrain,
	Layer,
	LayerAnimation,
	Vignette,
} from "framefields";
import { bar, DROP, DURATION } from "./grid.js";
import { asset } from "./paths.js";
import { labels, plates, rings } from "./reel.js";
import { dropScene } from "./scenes/drop.js";
import { FADE, finaleScene } from "./scenes/finale.js";
import { hushScene } from "./scenes/hush.js";
import { openScene } from "./scenes/open.js";
import { tunnelScene } from "./scenes/tunnel.js";
import { FPS, H, INK, registerFonts, W } from "./theme.js";

export async function buildFilm(): Promise<Composition> {
	await registerFonts();

	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: INK,
	});

	for (const node of plates()) film.add(node);
	for (const node of rings()) film.add(node);
	for (const node of labels()) film.add(node);
	film.add(openScene());
	film.add(hushScene());
	film.add(dropScene());
	film.add(tunnelScene());
	film.add(finaleScene());

	// The score runs to the last frame; it is pulled down under the end card
	// so it lands with the picture's fade instead of stopping dead.
	film.add(
		Layer.audio(asset("score.wav"), {
			id: "score",
			volume: 1,
			durationFrames: DURATION,
		}).animate(
			LayerAnimation.create().fromTo("volume", 1, 0, {
				start: bar(DROP + 7),
				end: DURATION - FADE / 2,
				ease: "sine.in",
			}),
		),
	);

	// One lens and one emulsion over everything keeps plates and type in the same world.
	film.apply(new Vignette({ strength: 0.3, radius: 0.85, softness: 0.6 }));
	film.apply(new FilmGrain({ strength: 0.05, size: 1.6, animated: true }));
	return film;
}
