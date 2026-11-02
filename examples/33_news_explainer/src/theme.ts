/**
 * Tokens for the explainer: paper, ink, one highlighter and one warning red,
 * four faces, an 8 px grid and one clock. Everything on screen reads from here.
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

/** The desk every scene is pinned to, and the sheets laid on it. */
export const PAPER = "#efe8da";
export const PAPER_DEEP = "#e2d8c4";
export const SHEET = "#f8f4ec";
export const CARD = "#fbf8f2";
/** Type and line work. */
export const INK = "#171614";
export const INK_SOFT = "#4b4740";
export const INK_FAINT = "#8a8478";
/** The highlighter, and the one color that means danger. */
export const YELLOW = "#f7d94c";
export const RED = "#d23f2a";
/** The map: water, land, borders. */
export const SEA = "#c4d5d3";
export const LAND = "#ebe3d1";
export const LAND_HOME = "#f6efdf";
export const BORDER = "#b9ae98";
/** The storm. */
export const STORM = "#4a5560";
export const STORM_LIGHT = "#7d8994";
export const SHADOW = "#2b2418";

/** Headlines: tall condensed caps. */
export const DISPLAY = "Anton";
/** Body copy and labels. */
export const SANS = "Libre Franklin";
/** Data, stamps, times. */
export const MONO = "JetBrains Mono";
/** The hand that writes notes in the margins. */
export const HAND = "Permanent Marker";
