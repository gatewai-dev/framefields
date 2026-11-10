/**
 * Tokens for the film: deep space, one warm color for what escapes, one cool
 * color for what falls in, two faces and one clock.
 */

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const OUTPUT = new URL("../output/", import.meta.url).pathname;
export const ASSETS = new URL("../assets/", import.meta.url).pathname;
export const FONTS = `${ASSETS}fonts/`;

/** Seconds → frames. */
export const sec = (s: number) => Math.round(s * FPS);
/** The spacing grid. */
export const space = (n: number) => n * 8;

/** Space, and the type set on it. */
export const VOID = "#020308";
export const INK = "#eef1f7";
export const INK_SOFT = "#aab4c8";
export const INK_FAINT = "#6b7690";
export const RULE = "#3a4358";
/** The partner that escapes, and the one that falls in. */
export const GOLD = "#ffc46b";
export const BLUE = "#6fb1ff";

/** Titles and labels. */
export const SANS = "Libre Franklin";
/** Numbers and units. */
export const MONO = "JetBrains Mono";
