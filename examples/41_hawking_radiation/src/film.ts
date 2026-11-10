/**
 * Hawking radiation, explained in two and a half minutes.
 *
 *   open         a black hole, and what Hawking found in 1974
 *   zoom         down through an atom and its nucleus to empty space
 *   vacuum       particle pairs; one is pulled apart at the horizon
 *   radiation    pulling back: the escaping partners are the glow
 *   energy       the one that falls in makes the hole lighter
 *   temperature  smaller is hotter; the numbers for a solar mass
 *   evaporate    shrinking, heating, gone in a flash
 *   close        never observed, and what it means
 *
 * Every picture is a shader layer (`Layer.shader`): the black hole is ray
 * traced through the Schwarzschild metric, the atom and nucleus are ray
 * marched, the pairs are procedural. Type and meters are ordinary layers on
 * top. The timeline places each line of narration on its scene, and scenes
 * cue their pictures off the words heard in it; lines with no take yet are
 * timed by estimate, so the picture can be cut before the voice exists.
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
import { MUSIC_PATH, readVoice, voicePath } from "./audio.js";
import { registerFonts } from "./fonts.js";
import { closeScene } from "./scenes/close.js";
import { energyScene } from "./scenes/energy.js";
import { evaporateScene } from "./scenes/evaporate.js";
import { openScene } from "./scenes/open.js";
import { radiationScene } from "./scenes/radiation.js";
import { temperatureScene } from "./scenes/temperature.js";
import { vacuumScene } from "./scenes/vacuum.js";
import { zoomScene } from "./scenes/zoom.js";
import { FPS, H, VOID, W } from "./theme.js";
import {
	ducking,
	planTimeline,
	type SceneId,
	type SceneTiming,
	type Timeline,
} from "./timeline.js";

const BUILDERS: Record<SceneId, (t: SceneTiming) => LayoutNode> = {
	open: openScene,
	zoom: zoomScene,
	vacuum: vacuumScene,
	radiation: radiationScene,
	energy: energyScene,
	temperature: temperatureScene,
	evaporate: evaporateScene,
	close: closeScene,
};

export interface Film {
	film: Composition;
	timeline: Timeline;
}

export async function buildExplainer(): Promise<Film> {
	const fonts = await registerFonts();
	const timeline = planTimeline(readVoice());
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
		backgroundColor: VOID,
		fonts,
	});
	film.add([
		scenes,
		// Lines with no take on disk are silent; the picture still keeps their time.
		...timeline.lines
			.filter((line) => existsSync(voicePath(line.id)))
			.map((line) =>
				Layer.audio(voicePath(line.id), {
					id: `voice-${line.id}`,
					startFrame: line.start,
					durationFrames: line.end - line.start + 2,
					volume: 1,
				}),
			),
		...(existsSync(MUSIC_PATH)
			? [
					Layer.audio(MUSIC_PATH, {
						id: "music",
						startFrame: 0,
						durationFrames: timeline.total,
						volume: 0,
					}).animate(
						LayerAnimation.keys(
							"volume",
							ducking(timeline.lines, timeline.total),
						),
					),
				]
			: []),
	]);
	film.apply(new Vignette({ strength: 26, radius: 1.05, softness: 0.75 }));
	film.apply(
		new FilmGrain({ strength: 9, size: 1.3, monochrome: true, animated: true }),
	);
	return { film, timeline };
}

/** Builds the film; kept as the render script's entry point. */
export async function buildFilm(): Promise<Composition> {
	return (await buildExplainer()).film;
}
