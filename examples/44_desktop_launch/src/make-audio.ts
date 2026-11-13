/**
 * pnpm assets → assets/generated/score.wav
 *
 * Writes the score (score.ts). It is synthesized in code, so it costs
 * nothing, is the same every time and follows the film's beats when they
 * move: run it again after changing `BEAT`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { encodeStereoWav } from "framefields";
import { SCORE_RATE, synthesizeScore } from "./score.js";
import { SCORE } from "./sound.js";

const started = Date.now();
await fs.mkdir(path.dirname(SCORE), { recursive: true });
await fs.writeFile(
	SCORE,
	encodeStereoWav(synthesizeScore(), { sampleRate: SCORE_RATE }),
);
console.log(`${SCORE} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(0);
