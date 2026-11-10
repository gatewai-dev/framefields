/**
 * What `pnpm generate` makes, and where the film finds it. Stills are
 * described like photographs, then given the look's art direction word for
 * word. Each keeps two candidates; `pick` and `sha256` pin the one in use.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ART_DIRECTION } from "./direction.js";
import type { LineId } from "./script.js";

export const ASSETS = new URL("../assets/", import.meta.url).pathname;
export const GENERATED = `${ASSETS}generated/`;
export const VOICE_DIR = `${ASSETS}voice/`;
export const AUDIO_MANIFEST = `${ASSETS}audio.json`;
export const MUSIC = `${ASSETS}music.mp3`;

export const IMAGE_MODEL = "seedream/5.0-pro";
export const VOICE_MODEL = "elevenlabs/v4";
export const MUSIC_MODEL = "elevenlabs/music-v2.5";
/** George, ElevenLabs' default narrator. */
export const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
export const MUSIC_PROMPT =
	"Quiet documentary underscore: solo felt piano and soft low strings, curious and warm, steady pulse, no drums, no build, instrumental";
export const MUSIC_SECONDS = 42;

interface Still {
	scene: string;
	candidates: number;
	pick: number | null;
	sha256: string | null;
}

export const STILLS: Record<"flood" | "dig" | "opened", Still> = {
	flood: {
		scene:
			"A flooded small-town square in spring 1929: brown water up to the knees, people wading with bundles, a horse cart half under water, shopfronts with sandbags, seen from a first-floor window, 35mm lens",
		candidates: 2,
		// 1: flood 2 has a large invented shop sign; this one's signs are small.
		pick: 1,
		sha256: "380cbf8c8391407f7837cdf09401d35c399f850c90014af58b8baf8a1552f749",
	},
	dig: {
		scene:
			"A city in 1931 in the middle of a great public works: a new river channel being dug straight through town, steam cranes and timber scaffolding along its banks, rows of workers with shovels in the mud in the foreground, brick warehouses and a church spire on the far bank, seen wide from a raised embankment, 35mm lens",
		candidates: 2,
		// 1: the workers are digging; 2 is a posed line-up.
		pick: 1,
		sha256: "c087ef62a98223380270ad9e2a7a63a3e64e9eae76d23c75634c117773668d3d",
	},
	opened: {
		scene:
			"The opening day of a new straight river channel in 1934: water flowing between fresh stone embankments, a crowd in hats and coats lining a new iron bridge, flags on the bridge, the old town behind, seen from the riverbank, 35mm lens",
		candidates: 2,
		// 2: the iron bridge with bunting the prompt asked for.
		pick: 2,
		sha256: "97b267e673d361cf06173e52a8717b463548e584a282d52ee5651549b35686f8",
	},
};
export type StillId = keyof typeof STILLS;

export const stillPrompt = (id: StillId) =>
	`${STILLS[id].scene}. ${ART_DIRECTION.direction}. Avoid: ${ART_DIRECTION.avoid}.`;
export const candidatePath = (id: StillId, n: number) =>
	`${GENERATED}${id}.${n}.jpg`;

/** The picked still, checked against its pin. */
export function still(id: StillId): string {
	const s = STILLS[id];
	if (s.pick === null)
		throw new Error(
			`No candidate picked for ${id}: run \`pnpm generate\` and set its pick in assets.ts.`,
		);
	const file = candidatePath(id, s.pick);
	if (!existsSync(file))
		throw new Error(`${file} is missing: run \`pnpm generate\`.`);
	const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
	if (s.sha256 && sha !== s.sha256)
		throw new Error(`${file}: SHA-256 ${sha}, pinned ${s.sha256}.`);
	return file;
}

export const voicePath = (id: LineId) => `${VOICE_DIR}${id}.mp3`;

/** One spoken word, seconds from its line's start. */
export interface Word {
	text: string;
	start: number;
	end: number;
}

/** What generation measured: each line's length and words. */
export interface AudioManifest {
	lines: Record<LineId, { duration: number; words: Word[] }>;
}

export function readAudio(): AudioManifest {
	if (!existsSync(AUDIO_MANIFEST))
		throw new Error("No assets/audio.json: run `pnpm generate`.");
	return JSON.parse(readFileSync(AUDIO_MANIFEST, "utf8")) as AudioManifest;
}
