/**
 * The film's clock: eight scenes, each owning the lines read over it. Lines
 * follow each other with a breath between them (longer where a picture has
 * to land first), so every start comes from the measured voice lengths in
 * assets/audio.json. Scene starts mirror `Layer.sequence`: each overlaps the
 * one before by its transition.
 */
import { Transition, type TransitionSpec } from "framefields";
import type { AudioManifest, LineId } from "./audio.js";
import { FPS, sec } from "./theme.js";

export type SceneId =
	| "open"
	| "title"
	| "route"
	| "storm"
	| "dive"
	| "ground"
	| "probe"
	| "close";

interface ScenePlan {
	id: SceneId;
	lines: LineId[];
	/** How the scene arrives from the one before. */
	transition: TransitionSpec;
	/** Frames from the scene's start to its first line. */
	lead: number;
	/** Frames from its last line's end to its own end (the next transition included). */
	tail: number;
	/** Extra frames of silence before a line, where a picture lands first. */
	pause?: Partial<Record<LineId, number>>;
}

/** The breath between two lines of one scene, after the take's own 0.3 s tail. */
export const BREATH = sec(0.15);

export const SCENES: ScenePlan[] = [
	{
		id: "open",
		lines: ["fell", "nine"],
		transition: Transition.cut(),
		lead: sec(1.0),
		tail: sec(0.9),
		pause: { nine: sec(0.4) },
	},
	{
		id: "title",
		lines: ["know"],
		transition: Transition.slide("left", sec(0.6)),
		lead: sec(0.6),
		tail: sec(1.1),
	},
	{
		id: "route",
		lines: ["route", "cruise"],
		transition: Transition.push("up", sec(0.7)),
		lead: sec(0.8),
		tail: sec(1.0),
		pause: { cruise: sec(0.3) },
	},
	{
		id: "storm",
		lines: ["storm", "warned", "climb"],
		transition: Transition.whip("left", sec(0.5)),
		lead: sec(0.7),
		tail: sec(1.0),
		pause: { warned: sec(0.2), climb: sec(0.3) },
	},
	{
		id: "dive",
		lines: ["fall", "minute", "rate", "speed", "mayday"],
		transition: Transition.cut(),
		lead: sec(0.3),
		tail: sec(1.3),
		pause: { minute: sec(0.4), speed: sec(0.2), mayday: sec(0.4) },
	},
	{
		id: "ground",
		lines: ["road", "crater", "ground"],
		transition: Transition.fadeThrough(sec(0.8)),
		lead: sec(0.8),
		tail: sec(1.0),
		pause: { ground: sec(0.3) },
	},
	{
		id: "probe",
		lines: ["ntsb", "breakup", "report"],
		transition: Transition.slide("up", sec(0.6)),
		lead: sec(0.7),
		tail: sec(1.0),
		pause: { report: sec(0.3) },
	},
	{
		id: "close",
		lines: ["question"],
		transition: Transition.wipe("right", sec(0.6)),
		lead: sec(0.7),
		tail: sec(4.0),
	},
];

export interface LineCue {
	id: LineId;
	/** Composition frames. */
	start: number;
	end: number;
}

/** A line in scene-local frames, with each word heard in it. */
export interface LocalLine {
	start: number;
	end: number;
	words: Array<{ text: string; start: number; end: number }>;
}

export interface SceneTiming {
	id: SceneId;
	start: number;
	duration: number;
	transition: TransitionSpec;
	/** The scene's lines, in scene-local frames. */
	lines: Record<string, LocalLine>;
}

export interface Timeline {
	scenes: SceneTiming[];
	/** Every line, in composition frames, in the order heard. */
	lines: LineCue[];
	total: number;
}

const frames = (seconds: number) => Math.ceil(seconds * FPS);

export function planTimeline(voice: AudioManifest["voice"]): Timeline {
	const scenes: SceneTiming[] = [];
	const lines: LineCue[] = [];
	let end = 0;
	for (const plan of SCENES) {
		const start = Math.max(0, end - plan.transition.frames);
		const local: SceneTiming["lines"] = {};
		let cursor = plan.lead;
		plan.lines.forEach((id, i) => {
			if (i > 0) cursor += BREATH;
			cursor += plan.pause?.[id] ?? 0;
			const length = frames(voice[id].seconds);
			const at = cursor;
			local[id] = {
				start: at,
				end: at + length,
				words: voice[id].words.map((w) => ({
					text: w.text,
					start: at + Math.round(w.start * FPS),
					end: at + Math.round(w.end * FPS),
				})),
			};
			lines.push({ id, start: start + cursor, end: start + cursor + length });
			cursor += length;
		});
		const duration = cursor + plan.tail;
		scenes.push({
			id: plan.id,
			start,
			duration,
			transition: plan.transition,
			lines: local,
		});
		end = start + duration;
	}
	return { scenes, lines, total: end };
}

/** One scene's timing, or a throw naming the scene. */
export function sceneTiming(t: Timeline, id: SceneId): SceneTiming {
	const scene = t.scenes.find((s) => s.id === id);
	if (!scene) throw new Error(`No scene "${id}" in the timeline.`);
	return scene;
}

/** Where a scene's line starts and ends, scene-local. */
export function lineIn(scene: SceneTiming, id: LineId): LocalLine {
	const line = scene.lines[id];
	if (!line)
		throw new Error(`Line "${id}" is not read in scene "${scene.id}".`);
	return line;
}

const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The scene-local frame `word` is said in line `id` (its `nth` occurrence),
 * so a picture lands on the word rather than somewhere in its sentence.
 */
export function wordIn(
	scene: SceneTiming,
	id: LineId,
	word: string,
	nth = 0,
): { start: number; end: number } {
	const matches = lineIn(scene, id).words.filter(
		(w) => bare(w.text) === bare(word),
	);
	const hit = matches[nth];
	if (!hit)
		throw new Error(`"${word}" is not heard in line "${id}" (${scene.id}).`);
	return hit;
}

/** Music level between lines, and under them. */
const BED = 0.42;
const DUCKED = 0.16;
/** Lines closer than this keep the music down between them. */
const BRIDGE = sec(1.2);

/** The music's volume: down under every line, up between scenes, out by the end. */
export function ducking(
	lines: LineCue[],
	total: number,
): Array<[number, number, string?]> {
	const keys: Array<[number, number, string?]> = [
		[0, 0],
		[sec(0.8), BED, "power2.out"],
	];
	let i = 0;
	while (i < lines.length) {
		const start = lines[i]?.start ?? 0;
		let end = lines[i]?.end ?? 0;
		while (i + 1 < lines.length && (lines[i + 1]?.start ?? 0) - end < BRIDGE)
			end = lines[++i]?.end ?? end;
		keys.push(
			[Math.max(sec(0.8), start - 8), BED, "hold"],
			[start, DUCKED, "power2.out"],
			[end, DUCKED, "hold"],
			[end + sec(0.5), BED, "power2.inOut"],
		);
		i++;
	}
	keys.push([total - sec(3), BED, "hold"], [total, 0, "power2.in"]);
	return keys;
}
