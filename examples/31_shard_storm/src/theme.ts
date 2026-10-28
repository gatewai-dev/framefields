import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT = path.resolve(HERE, "../output");

/** Source dancer clip from example 19. */
export const DANCER = path.resolve(
	HERE,
	"../../19_framefields_film/assets/dancer.mp4",
);

export const W = 1920;
export const H = 1080;
export const FPS = 24;
export const DURATION = 158;

/** 3D scene origin and glossy floor plane (y = 240 aligns with the placed dancer's feet). */
export const CX = W / 2;
export const CY = H / 2;
export const FLOOR_Y = 240;

/** Deep midnight Framefields blue stage & obsidian floor. */
export const BG = "#030712";
export const FLOOR_COLOR = "#040A1A";

/** Framefields blue shard palette (deep navy -> royal -> signature blue -> ice white). */
export const NAVY = "#0B1E4D";
export const BLUE_DARK = "#172554";
export const BLUE_ROYAL = "#1E3A8A";
export const BLUE_DEEP = "#1D4ED8";
export const BLUE_CORE = "#2563EB";
export const BLUE = "#3B82F6";
export const BLUE_SKY = "#60A5FA";
export const BLUE_ICE = "#93C5FD";
export const BLUE_GLOW = "#DBEAFE";
export const WHITE_HOT = "#FFFFFF";
