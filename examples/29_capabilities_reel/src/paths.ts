import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const REPO = path.resolve(ROOT, "../..");
export const ASSETS = path.join(ROOT, "assets");
export const FONTS = path.join(ASSETS, "fonts");
export const OUTPUT = path.join(ROOT, "output");

export const emoji = (name: string) =>
	path.join(ASSETS, "emoji", `${name}.json`);
export const lottie = (name: string) =>
	path.join(ASSETS, "lottie", `${name}.json`);
export const fluent = (name: string) =>
	path.join(ASSETS, "svg/fluent", `${name}.svg`);
export const twemoji = (name: string) =>
	path.join(ASSETS, "svg/twemoji", `${name}.svg`);
export const lucide = (name: string) =>
	path.join(ASSETS, "svg/lucide", `${name}.svg`);
export const SCORE = path.join(ASSETS, "score.wav");
/** Example 19's generated clip (run `pnpm assets` there). */
export const DANCER = path.resolve(
	REPO,
	"examples/19_framefields_film/assets/dancer.mp4",
);
export const LOGO = path.resolve(REPO, "assets/brand/logo.png");
