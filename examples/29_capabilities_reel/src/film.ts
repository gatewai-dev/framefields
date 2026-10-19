/**
 * The reel: twelve chapters on a 120 BPM grid, one per corner of the engine, cut together with
 * every transition the sequencer has, scored by four synthesized stems mixed through the audio
 * nodes, and finished with a whole-composition grade.
 */
import {
	ColorBalance,
	Composition,
	Effect,
	FilmGrain,
	Layer,
	Signal,
	Transition,
	Vignette,
} from "framefields";
import { lowpassAt } from "./music.js";
import { ASSETS } from "./paths.js";
import { dataScene } from "./scenes/data.js";
import { emojiScene } from "./scenes/emoji.js";
import { finaleScene } from "./scenes/finale.js";
import { fluidScene } from "./scenes/fluid.js";
import { lottieScene } from "./scenes/lottie.js";
import { nodesScene } from "./scenes/nodes.js";
import { openScene } from "./scenes/open.js";
import { spaceScene } from "./scenes/space.js";
import { stylizeScene } from "./scenes/stylize.js";
import { typeScene } from "./scenes/type.js";
import { vectorScene } from "./scenes/vector.js";
import { visionScene } from "./scenes/vision.js";
import { FONT_FILES, FPS, H, INK, registerFonts, W } from "./theme.js";
import { CHAPTERS, chapter, TOTAL_FRAMES } from "./timeline.js";

type Builder = (comp: Composition) => unknown | Promise<unknown>;

/** Each chapter's builder and the transition that brings it in. */
const CUTS: Record<
	string,
	{ build: Builder; transition?: ReturnType<typeof Transition.cut> }
> = {
	open: { build: openScene },
	lottie: { build: lottieScene, transition: Transition.whip("left", 12) },
	emoji: { build: emojiScene, transition: Transition.zoom(14) },
	vector: { build: vectorScene, transition: Transition.iris(18) },
	stylize: { build: stylizeScene, transition: Transition.wipe("right", 15) },
	fluid: { build: fluidScene, transition: Transition.push("up", 18) },
	vision: { build: visionScene, transition: Transition.cut() },
	type: { build: typeScene, transition: Transition.slide("left", 15) },
	space: { build: spaceScene, transition: Transition.fadeThrough(16) },
	data: { build: dataScene, transition: Transition.crossfade(14) },
	nodes: { build: nodesScene, transition: Transition.cut() },
	finale: { build: finaleScene, transition: Transition.push("left", 15) },
};

const stem = (name: string) => `${ASSETS}/stems/${name}.wav`;

/** The four stems through the audio nodes. */
export function mix(comp: Composition): void {
	const len = { durationFrames: TOTAL_FRAMES + FPS };
	const fadeOut = Effect.audioFade({
		fadeInDuration: 0,
		fadeOutDuration: 2.5,
		fadeOutCurve: "scurve",
	});
	comp.addAudio(
		Layer.audio(stem("drums"), { id: "stem-drums", volume: 1.05, ...len })
			.apply(
				Effect.audioCompressor({
					threshold: -16,
					ratio: 4,
					attack: 0.004,
					release: 0.12,
					knee: 6,
					makeupGain: 5,
				}),
			)
			.apply(
				Effect.audioParametricEq({
					type: "lowShelf",
					frequency: 90,
					gain: 3,
					q: 0.8,
				}),
			),
	);
	comp.addAudio(
		Layer.audio(stem("bass"), { id: "stem-bass", volume: 0.95, ...len })
			// The breakdown's filter sweep, frame-locked to the EQ curve drawn on screen.
			.apply(
				Effect.audioParametricEq({
					type: "lowPass",
					frequency: Signal.programmatic((ctx) => lowpassAt(ctx.frame)),
					q: 1.1,
					gain: 0,
				}),
			)
			.apply(
				Effect.audioCompressor({
					threshold: -20,
					ratio: 2,
					attack: 0.01,
					release: 0.2,
					knee: 6,
					makeupGain: 2.5,
				}),
			),
	);
	comp.addAudio(
		Layer.audio(stem("music"), { id: "stem-music", volume: 1, ...len })
			.apply(
				Effect.audioParametricEq({
					type: "lowPass",
					frequency: Signal.programmatic((ctx) => lowpassAt(ctx.frame)),
					q: 1.4,
					gain: 0,
				}),
			)
			.apply(
				Effect.audioDelay({
					delayTime: 0.375,
					feedback: 0.35,
					wet: 0.22,
					dry: 1,
					pingPong: true,
				}),
			)
			.apply(
				Effect.audioReverb({
					roomSize: 0.82,
					damping: 0.4,
					wet: 0.25,
					dry: 1,
					width: 1,
				}),
			)
			.apply(
				Effect.audioCompressor({
					threshold: -20,
					ratio: 2,
					attack: 0.01,
					release: 0.2,
					knee: 6,
					makeupGain: 2.5,
				}),
			)
			.apply(fadeOut),
	);
	comp.addAudio(
		Layer.audio(stem("fx"), { id: "stem-fx", volume: 0.85, ...len })
			// Risers sweep across the stereo field.
			.apply(
				Effect.stereoPanning({
					pan: Signal.programmatic((ctx) => 0.6 * Math.sin(ctx.frame / 9)),
				}),
			)
			.apply(
				Effect.audioReverb({
					roomSize: 0.9,
					damping: 0.3,
					wet: 0.3,
					dry: 1,
					width: 1,
				}),
			),
	);
}

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: TOTAL_FRAMES,
		backgroundColor: INK,
		fonts: FONT_FILES,
	});

	const entries = [];
	for (let i = 0; i < CHAPTERS.length; i++) {
		const c = chapter(CHAPTERS[i].id);
		const cut = CUTS[c.id];
		const next = CHAPTERS[i + 1]
			? CUTS[CHAPTERS[i + 1].id].transition
			: undefined;
		// Each chapter runs on under the next one's transition, so the next starts on its downbeat.
		const tail = next?.frames ?? 0;
		entries.push({
			scene: (await cut.build(comp)) as never,
			duration: c.frames + tail,
			...(cut.transition ? { transition: cut.transition } : {}),
		});
	}
	const film = Layer.sequence(entries, { width: W, height: H });
	comp.add(film);

	// Whole-composition finish: a touch of split-tone, grain and lens falloff.
	comp.apply(
		new ColorBalance({
			shadows: { cyanRed: -2, magentaGreen: 0, yellowBlue: 4 },
			highlights: { cyanRed: 3, magentaGreen: 0, yellowBlue: -3 },
			preserveLuminosity: true,
		}),
	);
	comp.apply(new Vignette({ strength: 28, radius: 1.15, softness: 0.65 }));
	comp.apply(
		new FilmGrain({
			strength: 12,
			size: 1.4,
			monochrome: true,
			animated: true,
		}),
	);

	mix(comp);
	return comp;
}
