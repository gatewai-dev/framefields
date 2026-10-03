/**
 * The film's clock: the beat grid measured from the generated score
 * (assets/score.json, written by `pnpm assets grid`). Every cut is written in
 * bars, so regenerating the music re-times the whole edit.
 */
import fs from "node:fs";
import type { BeatGrid } from "./beat-grid.js";
import { asset } from "./paths.js";
import { FPS } from "./theme.js";

export const GRID: BeatGrid = JSON.parse(
	fs.readFileSync(asset("score.json"), "utf8"),
);

/** Frame where bar `n` starts (fractions are beats: 0.25 = one beat). */
export const bar = (n: number) =>
	Math.round((GRID.downbeatSec + n * GRID.barSec) * FPS);

/** Frame of beat `n` counted from bar 0. */
export const beat = (n: number) =>
	Math.round((GRID.downbeatSec + n * GRID.beatSec) * FPS);

/** The score's full length; the picture ends with it. */
export const DURATION = Math.floor(GRID.durationSec * FPS);

/** Bar where the score drops. */
export const DROP = GRID.dropBar;
