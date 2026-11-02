/**
 * What we know about the Florida jet crash: a two-minute news explainer in
 * the collage style of explainer journalism, about the Learjet 60 that came
 * down in Palm Beach County on November 1, 2026.
 *
 *   open    the dateline, the headline, the nine aboard
 *   title   WHAT WE KNOW
 *   route   the jet, and the flight from Austin toward the Bahamas
 *   storm   the thunderstorm, the warning, the climb the crew asked for
 *   dive    the fall, on a chart of altitude against time
 *   ground  where it came down, and the evacuation
 *   probe   the investigation, and what comes next
 *   close   the open question, and the sources
 *
 * Every scene is paper on a desk, built from shapes and type (no footage).
 * Gemini 3.8 Flash TTS reads the narration and Lyria 3.5 plays under it
 * (audio.ts); the timeline places every line on its scene, and scenes cue
 * their pictures off the words heard in it.
 */
import {
	Composition,
	FilmGrain,
	Layer,
	LayerAnimation,
	type LayoutNode,
	Vignette,
} from "framefields";
import { MUSIC_PATH, readManifest, voicePath } from "./audio.js";
import { registerFonts } from "./fonts.js";
import { paperTexture } from "./paper.js";
import { closeScene } from "./scenes/close.js";
import { diveScene } from "./scenes/dive.js";
import { groundScene } from "./scenes/ground.js";
import { openScene } from "./scenes/open.js";
import { probeScene } from "./scenes/probe.js";
import { routeScene } from "./scenes/route.js";
import { stormScene } from "./scenes/storm.js";
import { titleScene } from "./scenes/title.js";
import { FPS, H, PAPER, W } from "./theme.js";
import {
	ducking,
	planTimeline,
	type SceneId,
	type SceneTiming,
	type Timeline,
} from "./timeline.js";

const BUILDERS: Record<SceneId, (t: SceneTiming) => LayoutNode> = {
	open: openScene,
	title: titleScene,
	route: routeScene,
	storm: stormScene,
	dive: diveScene,
	ground: groundScene,
	probe: probeScene,
	close: closeScene,
};

export interface Film {
	film: Composition;
	timeline: Timeline;
}

export async function buildExplainer(): Promise<Film> {
	const fonts = await registerFonts();
	const { voice } = readManifest();
	const timeline = planTimeline(voice);
	const scenes = Layer.sequence(
		timeline.scenes.map((t) => ({
			scene: BUILDERS[t.id](t),
			duration: t.duration,
			transition: t.transition,
		})),
		{ id: "scenes", width: W, height: H },
	);
	if (scenes.totalFrames !== timeline.total)
		throw new Error(
			`The sequence runs ${scenes.totalFrames} frames, the timeline ${timeline.total}.`,
		);

	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (timeline.total / FPS) * 1000,
		backgroundColor: PAPER,
		fonts,
	});
	film.add([
		scenes,
		...paperTexture(),
		...timeline.lines.map((line) =>
			Layer.audio(voicePath(line.id), {
				id: `voice-${line.id}`,
				startFrame: line.start,
				durationFrames: line.end - line.start + 2,
				volume: 1,
			}),
		),
		Layer.audio(MUSIC_PATH, {
			id: "music",
			startFrame: 0,
			durationFrames: timeline.total,
			volume: 0,
		}).animate(
			LayerAnimation.keys("volume", ducking(timeline.lines, timeline.total)),
		),
	]);
	film.apply(new Vignette({ strength: 22, radius: 1.1, softness: 0.7 }));
	film.apply(
		new FilmGrain({
			strength: 7,
			size: 1.4,
			monochrome: true,
			animated: true,
		}),
	);
	return { film, timeline };
}

/** Builds the film; kept as the render script's entry point. */
export async function buildFilm(): Promise<Composition> {
	return (await buildExplainer()).film;
}
