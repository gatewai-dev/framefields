import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontManager, Layer, type LayoutNode } from "framefields";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONTS = path.resolve(HERE, "../assets/fonts");
export const OUTPUT = path.resolve(HERE, "../output");

export const W = 1920;
export const H = 1080;
export const FPS = 30;

/** Ink on warm paper for the 2D scenes; a dark studio for the 3D one. */
export const PAPER = "#f2ede4";
export const INK = "#1b1a17";
export const MUTED = "#7a746a";
export const ACCENT = "#c2410c";
export const TEAL = "#0f766e";
export const STUDIO = "#111216";

/** Arabic + Latin (the face from the original bug report). */
export const CAIRO = "Cairo";
/** Arabic with full vowel marks. */
export const NASKH = "Noto Naskh Arabic";
/** Hebrew + Latin. */
export const RUBIK = "Rubik";
/** Latin labels. */
export const SANS = "Inter";

const FACES: Record<string, string> = {
	[CAIRO]: "Cairo.ttf",
	[NASKH]: "NotoNaskhArabic.ttf",
	[RUBIK]: "Rubik.ttf",
	[SANS]: "Inter.ttf",
};

export async function registerFonts(): Promise<void> {
	for (const [family, file] of Object.entries(FACES)) {
		const source = path.join(FONTS, file);
		if (!fs.existsSync(source)) {
			throw new Error(`Missing ${source}. Run \`pnpm fonts\` first.`);
		}
		await FontManager.register({ family, source });
	}
}

/** A full-frame scene root; `Layer.sequence` sets its start and length. */
export function scene(id: string, background: string, children: unknown[]) {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background,
		children: children as LayoutNode[],
	});
}

/** The small Latin caption naming what a scene shows. */
export function label(id: string, text: string, color = MUTED) {
	return Layer.text(text, {
		id,
		position: "absolute",
		x: 0,
		y: H - 110,
		width: W,
		align: "center",
		fontFamily: SANS,
		fontSize: 28,
		fill: color,
		letterSpacing: 0.5,
	});
}
