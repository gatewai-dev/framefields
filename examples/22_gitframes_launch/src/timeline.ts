/**
 * Where the chapters fall, as measured from the song (assets/structure.json,
 * written by `pnpm song`). Regenerate the song and the film re-cuts itself.
 */
import fs from "node:fs";
import { bar } from "./grid.js";
import type { Chapters } from "./music/chapters.js";
import { asset } from "./paths.js";

const structure = JSON.parse(
	fs.readFileSync(asset("structure.json"), "utf8"),
) as {
	chapters: Chapters;
};

/** Chapter starts, in bars. */
export const CH: Chapters = structure.chapters;
export const DURATION = bar(CH.end);
