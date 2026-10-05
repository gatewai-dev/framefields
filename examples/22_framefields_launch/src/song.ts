/**
 * The song: one section per chapter of the film, sized in bars at 180 BPM,
 * with the lyric each chapter puts on screen. ElevenLabs Music renders it
 * from this plan (generate-song.ts); the picture is then cut to the take.
 */
import { BAR_SEC, BPM, PLAN } from "./grid.js";

export interface SongSection {
	name: string;
	fromBar: number;
	toBar: number;
	styles: string[];
	avoid: string[];
	lines: string[];
}

export const GLOBAL_STYLES = [
	`${BPM} bpm`,
	"high-energy drum and bass",
	"liquid neurofunk",
	"punchy breakbeat drums",
	"reese bass",
	"bright supersaw chords",
	"fast-paced female rap",
	"confident female rapper with a rich, warm, powerful voice",
	"rapid-fire double-time flow locked to the beat",
	"crisp enunciation, every word clear",
	"the rap never stops: vocals from the first bar to the last",
	"F minor",
	"modern festival mix",
];
export const GLOBAL_AVOID = [
	"male vocals",
	"slow tempo",
	"acoustic guitar",
	"lo-fi",
	"mumbled vocals",
	"heavy autotune",
	"instrumental breaks",
	"long instrumental intro",
	"silence",
];

/**
 * One line per bar or so, every section rapped: the film puts the words on
 * screen as they are sung, so a bar without a word is a bar without a cue.
 */
export const SECTIONS: SongSection[] = [
	{
		name: "Intro",
		fromBar: PLAN.intro,
		toBar: PLAN.drop,
		styles: [
			"rap starts on the very first beat",
			"filtered drums already rolling",
			"rising tension",
			"riser into the drop",
		],
		avoid: ["heavy bass", "spoken word"],
		lines: [
			"What if video was just code?",
			"What if motion shipped in a commit?",
			"No timeline, no render farm,",
			"just type it and let it hit.",
		],
	},
	{
		name: "Drop",
		fromBar: PLAN.drop,
		toBar: PLAN.tools,
		styles: [
			"massive drop",
			"full breakbeat",
			"rolling reese bass",
			"punchy female rap hook, shouted ad-libs",
		],
		avoid: ["quiet"],
		lines: [
			"Framefields!",
			"No browser, no Chromium,",
			"no screenshots, just the GPU.",
			"A hundred twenty frames a second,",
			"every pixel rendered true,",
			"watch it move.",
		],
	},
	{
		name: "Tools",
		fromBar: PLAN.tools,
		toBar: PLAN.type,
		styles: [
			"driving drums",
			"offbeat chord stabs",
			"rapid-fire female rap verse, list flow",
		],
		avoid: ["quiet"],
		lines: [
			"After Effects, Photoshop,",
			"Premiere, Cinema 4D,",
			"Blender, Illustrator,",
			"all of it in one import,",
			"lightweight, typed and fast,",
			"all the power, none of the weight.",
		],
	},
	{
		name: "Verse",
		fromBar: PLAN.type,
		toBar: PLAN.world,
		styles: [
			"wobbling growl bass",
			"offbeat chord stabs",
			"rapid-fire female rap verse",
		],
		avoid: ["quiet"],
		lines: [
			"Every letter razor sharp,",
			"bend the words around the arc,",
			"type that moves the way you speak,",
			"split it, stagger it, spin it sweet,",
			"every font a different feel,",
			"kinetic on every beat.",
		],
	},
	{
		name: "Pre-Chorus",
		fromBar: PLAN.world,
		toBar: PLAN.warp,
		styles: [
			"soaring supersaw lead",
			"driving drums",
			"fast female rap with melodic edge",
		],
		avoid: ["quiet"],
		lines: [
			"Step inside the camera,",
			"fly the third dimension,",
			"paths and planes in motion,",
			"cubes in every direction,",
			"orbit round and dolly through,",
			"light it up in depth.",
		],
	},
	{
		name: "Warp",
		fromBar: PLAN.warp,
		toBar: PLAN.comp,
		styles: [
			"heavy wobbling bass with pitch bends",
			"full drums",
			"aggressive female rap, punchy flow",
		],
		avoid: ["quiet", "drums drop out"],
		lines: [
			"Drop a mesh and make it bend,",
			"warp the vertices to the bass,",
			"ripple, twist and fold the space,",
			"every frame a different shape.",
		],
	},
	{
		name: "Composite",
		fromBar: PLAN.comp,
		toBar: PLAN.chorus,
		styles: [
			"riser and snare roll building",
			"driving drums",
			"tight female rap, building intensity",
		],
		avoid: ["quiet", "drums drop out"],
		lines: [
			"It's just code, write it once,",
			"key it, mask it, blend the light,",
			"stack the layers, comp it through,",
			"render true every night.",
		],
	},
	{
		name: "Chorus",
		fromBar: PLAN.chorus,
		toBar: PLAN.outro,
		styles: [
			"biggest drop of the song",
			"anthemic chorus",
			"full energy",
			"female rap chorus with stacked ad-libs",
		],
		avoid: ["quiet"],
		lines: [
			"Frame by frame,",
			"shader by shader,",
			"grade it, grain it, glitch it, make it louder,",
			"frame by frame,",
			"faster and faster!",
		],
	},
	{
		name: "Outro",
		fromBar: PLAN.outro,
		toBar: PLAN.end,
		styles: ["final hit", "big sustained chord ringing out", "clean ending"],
		avoid: ["fade-in"],
		lines: ["Framefields.", "Motion, compiled."],
	},
];

/** Section length in ms; boundaries are rounded cumulatively so the plan totals exactly PLAN.end bars. */
export function sectionDurationsMs(): number[] {
	return SECTIONS.map(
		(s) =>
			Math.round(s.toBar * BAR_SEC * 1000) -
			Math.round(s.fromBar * BAR_SEC * 1000),
	);
}

export const LYRICS = SECTIONS.flatMap((s) => s.lines).join("\n");
