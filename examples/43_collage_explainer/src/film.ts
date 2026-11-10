/**
 * "The city that moved its river": a 35-second explainer made only from the
 * Collage explainer preset's brief (`pnpm brief`). Six scenes, one per line
 * of narration, cut on the voice; generated stills moved by the engine; the
 * look's grain and vignette over everything.
 */
import { existsSync } from "node:fs";
import {
	Composition,
	FilmGrain,
	Layer,
	LayerAnimation,
	type LayoutNode,
	Vignette,
} from "framefields";
import { MUSIC, readAudio, voicePath } from "./assets.js";
import { FPS, GROUND, H, MONO, SANS, W } from "./direction.js";
import { registerFonts } from "./fonts.js";
import { SCENES } from "./scenes.js";
import { planTimeline, type SceneTiming } from "./timeline.js";

/** Music sits under the voice (the genre says 18–24 dB): about -20 dB while speaking. */
const MUSIC_UNDER = 0.1;
const MUSIC_OPEN = 0.35;

function scene(t: SceneTiming): LayoutNode {
	return Layer.box({
		id: `scene-${t.id}`,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: t.start,
		durationFrames: t.duration,
		overflow: "hidden",
		children: [SCENES[t.id](t)],
	});
}

/** Up between lines, down under them. */
function ducking(
	scenes: SceneTiming[],
	total: number,
): [number, number, string?][] {
	const keys: [number, number, string?][] = [[0, MUSIC_OPEN]];
	for (const s of scenes) {
		keys.push(
			[Math.max(0, s.voiceAt - 8), MUSIC_OPEN],
			[s.voiceAt, MUSIC_UNDER, "sine.inOut"],
		);
		const end = s.voiceAt + Math.round((s.words.at(-1)?.end ?? 0) * FPS);
		keys.push(
			[end + 4, MUSIC_UNDER],
			[end + 14, MUSIC_OPEN * 0.8, "sine.inOut"],
		);
	}
	keys.push([total - 30, MUSIC_OPEN * 0.8], [total, 0, "sine.in"]);
	return keys.sort((a, b) => a[0] - b[0]);
}

export async function buildFilm(): Promise<Composition> {
	const fonts = await registerFonts([SANS, MONO]);
	const { scenes, total } = planTimeline(readAudio());
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (total / FPS) * 1000,
		backgroundColor: GROUND,
		fonts,
	});
	film.add(scenes.map(scene));
	film.add(
		scenes.map((s) =>
			Layer.audio(voicePath(s.id), {
				id: `voice-${s.id}`,
				startFrame: s.voiceAt,
				durationFrames: s.duration - (s.voiceAt - s.start),
				volume: 1,
			}),
		),
	);
	// The music model was unavailable when this film was made; the film works without it.
	if (existsSync(MUSIC))
		film.add(
			Layer.audio(MUSIC, {
				id: "music",
				startFrame: 0,
				durationFrames: total,
				volume: 0,
			}).animate(LayerAnimation.keys("volume", ducking(scenes, total))),
		);
	film.apply(new Vignette({ strength: 30, radius: 1.0, softness: 0.8 }));
	film.apply(
		new FilmGrain({
			strength: 12,
			size: 1.4,
			monochrome: true,
			animated: true,
		}),
	);
	return film;
}
