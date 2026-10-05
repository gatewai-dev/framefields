/**
 * The song as the picture feels it (assets/envelopes.json, from the separated
 * stems): per-frame kick and snare envelopes as Signal.fromArray, for the few
 * reactive accents.
 */
import fs from "node:fs";
import { Signal } from "framefields";
import type { Envelopes } from "./music/envelopes.js";
import { asset } from "./paths.js";

const ENV = JSON.parse(
	fs.readFileSync(asset("envelopes.json"), "utf8"),
) as Envelopes;

export const kickPulse = () => Signal.fromArray(ENV.kick, ENV.fps);
export const snarePulse = () => Signal.fromArray(ENV.snare, ENV.fps);
