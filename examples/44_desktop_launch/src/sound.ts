/**
 * Sound: the score alone (score.ts). There are no effects; the picture's
 * hits are written into the music instead.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { ASSETS, BEAT, DURATION } from "./theme.js";

/** The score, written by `pnpm assets`. */
export const SCORE = path.join(ASSETS, "generated/score.wav");

export function sound(): LayoutNode[] {
	if (!existsSync(SCORE)) {
		console.warn(`No score at ${SCORE}: run \`pnpm assets\`.`);
		return [];
	}
	return [
		Layer.audio(SCORE, {
			id: "score",
			volume: 1,
			startFrame: 0,
			durationFrames: DURATION,
		}).animate(
			LayerAnimation.keys("volume", [
				[BEAT.out, 1],
				[DURATION - 2, 0, "sine.in"],
			]),
		) as LayoutNode,
	];
}
