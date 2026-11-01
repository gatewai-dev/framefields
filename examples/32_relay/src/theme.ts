/**
 * Tokens for the Relay film: one accent, two weights, an 8 px spacing grid,
 * and one clock. Everything on screen reads from here.
 */

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const OUTPUT = new URL("../output/", import.meta.url).pathname;
export const ASSETS = new URL("../assets/", import.meta.url).pathname;
export const FONTS = new URL("../../../assets/fonts/", import.meta.url)
	.pathname;

/** Seconds → frames. */
export const sec = (s: number) => Math.round(s * FPS);
/** The spacing grid. */
export const space = (n: number) => n * 8;

export const SANS = "Inter";
export const REGULAR = 400;
export const SEMIBOLD = 600;

/** The one accent, and its tint for selected and new things. */
export const ACCENT = "#3d4fe0";
export const ACCENT_TINT = "#eceefc";
/** The wall behind the window. */
export const WALL = "#e7e4dd";
export const WALL_LIGHT = "#f3f1ec";
/** App surfaces. */
export const APP = "#ffffff";
export const SIDEBAR = "#f6f5f2";
export const SUBTLE = "#f1efeb";
export const LINE = "#e7e5e0";
export const EDGE = "#d9d6cf";
/** Type. */
export const INK = "#18181b";
export const SOFT = "#4f4f57";
export const MUTED = "#76767e";
/** Shadow color for raised surfaces. */
export const SHADOW = "#2a2620";

/** The window on the stage, in composition px. */
export const FRAME = { x: 150, y: 82, width: 1620, height: 916 } as const;
