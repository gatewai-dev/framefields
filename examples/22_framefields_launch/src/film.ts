/**
 * The launch film, assembled. The chapters are cut to the generated song
 * (timeline.ts) and every lyric lands on the frame it is sung (lyrics.ts).
 */
import { Composition, FilmGrain, Layer, Vignette } from "framefields";
import { FPS } from "./grid.js";
import { asset } from "./paths.js";
import { compScene } from "./scenes/comp.js";
import { logoScene } from "./scenes/logo.js";
import { notScene } from "./scenes/not.js";
import { openScene } from "./scenes/open.js";
import { outroScenes } from "./scenes/outro.js";
import { speedScene } from "./scenes/speed.js";
import { toolsScene } from "./scenes/tools.js";
import { typeScene } from "./scenes/type.js";
import { vfxScene } from "./scenes/vfx.js";
import { warpScene } from "./scenes/warp.js";
import { worldScene } from "./scenes/world.js";
import { BG, H, registerFonts, W } from "./theme.js";
import { DURATION } from "./timeline.js";

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: DURATION,
		backgroundColor: BG,
	});
	film.add(openScene());
	film.add(logoScene());
	film.add(notScene());
	film.add(speedScene());
	film.add(toolsScene());
	film.add(typeScene());
	film.add(worldScene());
	film.add(warpScene());
	film.add(compScene());
	film.add(vfxScene());
	for (const node of outroScenes()) film.add(node);
	film.add(
		Layer.audio(asset("song.mp3"), {
			id: "score",
			volume: 1,
			durationFrames: DURATION,
		}),
	);
	film.apply(new Vignette({ strength: 0.12, radius: 0.95, softness: 0.7 }));
	film.apply(new FilmGrain({ strength: 0.035, size: 1.4, animated: true }));
	return film;
}
