/**
 * The interface's two cues: a panel opening and a completion. They come from
 * UI SFX (github.com/romainsimon/uisfx), "soft" pack, whose audio is CC0-1.0.
 * Each is pinned to a commit and checked by SHA-256; `pnpm assets` fetches
 * them into assets/sfx/ (media stays out of git). The library's presses are
 * all low, pitched blips, so the mouse click is generated instead (audio.ts).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./theme.js";

export const UISFX_COMMIT = "9950fe66f993a6660dab9c2651dcbcd899ffd83b";

export const SFX = {
	panel: {
		source: "soft/open.mp3",
		sha256: "e7cd24beb3a6a873afb05df2dae5eb128dc6e5d47680892b57dd2ccde7799d00",
		seconds: 0.49,
	},
	complete: {
		source: "soft/complete.mp3",
		sha256: "e314e373c1c06f7aa943caea003993c1ce89702a22501c067b7beb079c48e777",
		seconds: 0.98,
	},
} as const;

export type SfxName = keyof typeof SFX;

export const sfxPath = (name: SfxName) =>
	path.join(ASSETS, "sfx", `${name}.mp3`);

export const sfxUrl = (name: SfxName) =>
	`https://raw.githubusercontent.com/romainsimon/uisfx/${UISFX_COMMIT}/packages/uisfx/sounds/${SFX[name].source}`;

/** Sounds not on disk yet. */
export function missingSfx(): SfxName[] {
	return (Object.keys(SFX) as SfxName[]).filter(
		(name) => !existsSync(sfxPath(name)),
	);
}
