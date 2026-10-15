/**
 * Entry for the framefields renderer worker. Every export is a function the
 * worker calls; the job's `target.export` picks one.
 *
 * - film:      the 2D scenes back to back with transitions, score and grain
 * - threeD:    lit 3D scene with a glTF model
 * - vision:    ONNX segmentation, pose and detection on video
 * - all:       film + threeD + vision as three outputs (one job, three files)
 * - title, media, effects, charts: one 2D scene each, for isolating failures
 */
import { type Composition, FilmGrain, Layer, Transition } from "framefields";
import { CHARTS_FRAMES, chartsScene } from "./scenes/charts.js";
import { EFFECTS_FRAMES, effectsScene } from "./scenes/effects.js";
import { MEDIA_FRAMES, mediaScene } from "./scenes/media.js";
import { THREE_D_FRAMES, threeDLayers } from "./scenes/three-d.js";
import { TITLE_FRAMES, titleScene } from "./scenes/title.js";
import { VISION_FRAMES, visionLayers } from "./scenes/vision.js";
import { asset, composition, H, W } from "./theme.js";

const T = 18; // transition length, frames

export async function film(): Promise<Composition> {
	const sequence = Layer.sequence(
		[
			{ scene: titleScene(), duration: TITLE_FRAMES },
			{
				scene: mediaScene(),
				duration: MEDIA_FRAMES,
				transition: Transition.push("left", T),
			},
			{
				scene: effectsScene(),
				duration: EFFECTS_FRAMES,
				transition: Transition.wipe("right", T),
			},
			{
				scene: chartsScene(),
				duration: CHARTS_FRAMES,
				transition: Transition.iris(T),
			},
		],
		{ width: W, height: H },
	);
	const comp = await composition(sequence.totalFrames);
	comp.add(sequence);
	comp.add(
		Layer.audio(asset("score.mp3"), {
			id: "score",
			volume: 0.8,
			durationFrames: sequence.totalFrames,
		}),
	);
	comp.apply(new FilmGrain({ strength: 6, size: 1.4, animated: true }));
	return comp;
}

export async function threeD(): Promise<Composition> {
	const comp = await composition(THREE_D_FRAMES);
	comp.add(threeDLayers());
	return comp;
}

export async function vision(): Promise<Composition> {
	const comp = await composition(VISION_FRAMES, "#000000");
	comp.add(visionLayers());
	return comp;
}

/** Three outputs from one job: film.mp4, threeD.mp4, vision.mp4. */
export async function all(): Promise<Record<string, Composition>> {
	return { film: await film(), threeD: await threeD(), vision: await vision() };
}

const single = async (scene: () => unknown, frames: number) => {
	const comp = await composition(frames);
	comp.add(scene() as never);
	return comp;
};

export const title = () => single(titleScene, TITLE_FRAMES);
export const media = () => single(mediaScene, MEDIA_FRAMES);
export const effects = () => single(effectsScene, EFFECTS_FRAMES);
export const charts = () => single(chartsScene, CHARTS_FRAMES);
