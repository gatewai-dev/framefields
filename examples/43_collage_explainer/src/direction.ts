/**
 * The film's whole direction: the Collage explainer preset from the style
 * library. Everything visual reads the look's tokens from here; the frame
 * comes from the format; the scenes follow the genre's beats. `pnpm brief`
 * prints the combined brief this film was built from.
 */
import {
	presetMix,
	type ResolvedMix,
	resolveStyleMix,
	styleLibrary,
} from "framefields/styles";

const preset = styleLibrary.presets.find((p) => p.id === "collage-explainer");
if (!preset)
	throw new Error("No collage-explainer preset in the style library.");

export const MIX = presetMix(preset);
const resolved: ResolvedMix | null = resolveStyleMix(MIX);
if (!resolved) throw new Error("The collage-explainer preset doesn't resolve.");
export const DIRECTION: ResolvedMix = resolved;

const { look, format } = DIRECTION;
export const W = format.width;
export const H = format.height;
export const FPS = format.fps;
export const SAFE = format.safeArea;

/** Ground, card paper, ink, highlighter, rust: the look's palette, in its order. */
export const [GROUND, PAPER, INK, MARKER, RUST] = look.palette as [
	string,
	string,
	string,
	string,
	string,
];
export const SANS = look.fonts.display;
export const MONO = look.fonts.mono ?? look.fonts.body;
export const ART_DIRECTION = look.ai;

export const sec = (s: number) => Math.round(s * FPS);
