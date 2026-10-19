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
import { SFX, type SfxName } from "./manifest.js";
import { lowpassAt } from "./music.js";
import { ASSETS, sfx } from "./paths.js";
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
import { BAR, BG, FONT_FILES, FPS, H, registerFonts, W } from "./theme.js";
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

/**
 * The brand's master bus (framefields-social/packages/brand look.master): rumble cut, a little
 * warmth, the harsh 2.5–6 kHz band dipped, the top shelved off, a small room, then a gentle
 * compressor. Applied to every layer, then `trim` (a 1:1 compressor is a clean gain stage:
 * volume can only cut).
 */
function master<T extends { apply: (e: never) => T }>(layer: T, trimDb = 7): T {
	const chain = [
		Effect.audioParametricEq({
			type: "highPass",
			frequency: 40,
			q: 0.7,
			gain: 0,
		}),
		Effect.audioParametricEq({
			type: "lowShelf",
			frequency: 180,
			gain: 1.5,
			q: 0.7,
		}),
		Effect.audioParametricEq({
			type: "peak",
			frequency: 3500,
			gain: -3,
			q: 1.2,
		}),
		Effect.audioParametricEq({
			type: "highShelf",
			frequency: 7000,
			gain: -4,
			q: 0.7,
		}),
		Effect.audioReverb({
			roomSize: 0.35,
			damping: 0.7,
			wet: 0.12,
			dry: 1,
			width: 1,
		}),
		Effect.audioCompressor({
			threshold: -18,
			ratio: 3,
			attack: 0.01,
			release: 0.25,
			knee: 6,
			makeupGain: 0, // per layer, a bus make-up would stack up
		}),
		...(trimDb > 0
			? [
					Effect.audioCompressor({
						threshold: 0,
						ratio: 1,
						attack: 0.01,
						release: 0.1,
						knee: 0,
						makeupGain: trimDb,
					}),
				]
			: []),
		// A fast, hard limiter last: the engine scales the whole mix down by its single highest
		// summed peak, so no layer may spike.
		Effect.audioCompressor({
			threshold: -10,
			ratio: 20,
			attack: 0.0005,
			release: 0.06,
			knee: 2,
			makeupGain: 0,
		}),
	];
	return chain.reduce((l, e) => l.apply(e as never), layer);
}

/** One Freesound effect, placed so its peak lands on `frame`. */
function sfxAt(name: SfxName, frame: number, volume: number, id: string) {
	const s = SFX[name];
	const start = Math.max(0, Math.round(frame - s.peakSec * FPS));
	return master(
		Layer.audio(sfx(name), {
			id,
			startFrame: start,
			durationFrames: Math.ceil(s.durSec * FPS),
			volume,
		}),
		2,
	);
}

/**
 * The effects cue sheet, read off the cuts: a riser that stops dead plus a soft impact on chapters
 * that open on a hard cut (the drops), a light pass-by whoosh peaking mid-transition elsewhere,
 * pops on the opening's emoji, and the title hit on the last downbeat.
 */
function cues(comp: Composition): void {
	CHAPTERS.forEach((ch, i) => {
		if (i === 0) return;
		const c = chapter(ch.id);
		const t = CUTS[ch.id].transition;
		if (!t || t.frames === 0) {
			comp.addAudio(sfxAt("riser", c.start, 0.55, `sfx-riser-${ch.id}`));
			comp.addAudio(sfxAt("impact", c.start, 0.8, `sfx-impact-${ch.id}`));
		} else {
			comp.addAudio(
				sfxAt(
					"whoosh",
					c.start + Math.round(t.frames / 2),
					0.6,
					`sfx-whoosh-${ch.id}`,
				),
			);
		}
	});
	const open = chapter("open");
	comp.addAudio(
		sfxAt("impact", open.start + BAR * 2, 0.7, "sfx-impact-open-drop"),
	);
	for (let k = 0; k < 8; k++)
		comp.addAudio(
			sfxAt("pop", open.start + BAR * 2 + k * 7, 0.3, `sfx-pop-${k}`),
		);
	comp.addAudio(
		sfxAt("titleHit", chapter("finale").start + BAR * 3, 0.8, "sfx-title-hit"),
	);
}

/** The four stems through the audio nodes. */
export function mix(comp: Composition): void {
	const len = { durationFrames: TOTAL_FRAMES + FPS };
	const fadeOut = Effect.audioFade({
		fadeInDuration: 0,
		fadeOutDuration: 2.5,
		fadeOutCurve: "scurve",
	});
	comp.addAudio(
		master(
			Layer.audio(stem("drums"), { id: "stem-drums", volume: 1.05, ...len })
				.apply(
					Effect.audioCompressor({
						threshold: -16,
						ratio: 4,
						attack: 0.004,
						release: 0.12,
						knee: 6,
						makeupGain: 0,
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
		),
	);
	comp.addAudio(
		master(
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
						makeupGain: 0,
					}),
				),
		),
	);
	comp.addAudio(
		master(
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
						makeupGain: 0,
					}),
				)
				.apply(fadeOut),
		),
	);
	cues(comp);
}

export async function buildFilm(): Promise<Composition> {
	await registerFonts();
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: TOTAL_FRAMES,
		backgroundColor: BG,
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
	comp.apply(new Vignette({ strength: 10, radius: 1.3, softness: 0.8 }));
	comp.apply(
		new FilmGrain({
			strength: 7,
			size: 1.4,
			monochrome: true,
			animated: true,
		}),
	);

	mix(comp);
	return comp;
}
