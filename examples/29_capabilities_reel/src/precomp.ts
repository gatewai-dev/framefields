/**
 * Stills rendered once at build time and reused as image layers. Layer effects run on media
 * (video, image, SVG, Lottie, particles, VFX) — a box or text layer's `withEffect` is not applied —
 * so type that needs a glow, a split or a warp is drawn here first, on a transparent canvas.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Composition, HeadlessMediaRenderer } from "framefields";
import type { Node } from "./kit.js";
import { OUTPUT } from "./paths.js";
import { FONT_FILES } from "./theme.js";

const DIR = path.join(OUTPUT, "precomp");
let renderer: HeadlessMediaRenderer | undefined;

/** Renders `nodes` on a transparent `width`×`height` canvas to a PNG (cached by content). */
export async function still(
	id: string,
	width: number,
	height: number,
	nodes: Node[],
): Promise<string> {
	const comp = new Composition({
		width,
		height,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "transparent",
		fonts: FONT_FILES,
	});
	comp.add(nodes);
	const hash = crypto
		.createHash("sha1")
		.update(JSON.stringify(comp.toSpec()))
		.digest("hex")
		.slice(0, 10);
	const file = path.join(DIR, `${id}-${hash}.png`);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(DIR, { recursive: true });
		renderer ??= new HeadlessMediaRenderer();
		fs.writeFileSync(file, await comp.renderFrame({ frame: 0, renderer }));
	}
	return file;
}
