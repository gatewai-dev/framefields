/** Tokens for the product demo: one palette, one type scale, one clock. */

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const OUTPUT = new URL("../output/", import.meta.url).pathname;
export const FONTS = new URL("../../../assets/fonts/", import.meta.url)
	.pathname;

export const SANS = "Inter";
export const MONO = "JetBrains Mono";

/** The page behind the window. */
export const NIGHT = "#06070a";
/** App surfaces, darkest to lightest. */
export const APP = "#0f1013";
export const PANEL = "#141519";
export const CARD = "#17181d";
export const RAISED = "#1f2128";
export const LINE = "#24262d";
export const EDGE = "#2c2f37";
/** Type. */
export const INK = "#ececf1";
export const SOFT = "#a9abb5";
export const MUTED = "#73757f";
/** Signals. */
export const ACCENT = "#6d8dff";
export const ACCENT_DEEP = "#4a6cf0";
export const VIOLET = "#a07bff";
export const GREEN = "#3ecf8e";
export const AMBER = "#f5b44a";

/** The window, in composition px. */
export const FRAME = { x: 150, y: 64, width: 1620, height: 952 } as const;
