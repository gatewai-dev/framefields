/** pnpm probe:nodes → output/probe-nodes.png: every montage look on one still. */
import fs from "node:fs/promises";
import path from "node:path";
import { Composition, HeadlessMediaRenderer, Layer } from "framefields";
import { OUTPUT, REPO } from "./paths.js";
import { nodeLooks } from "./scenes/nodes.js";
import { FONT_FILES, MONO, registerFonts } from "./theme.js";

await registerFonts();
const still = `${REPO}/examples/19_framefields_film/assets/dancer.png`;
const comp = new Composition({
	width: 1920,
	height: 1080,
	fps: 30,
	durationFrames: 30,
	backgroundColor: "#203040",
	fonts: FONT_FILES,
});
nodeLooks(() => 0).forEach(([name, fx], i) => {
	const x = (i % 4) * 480;
	const y = Math.floor(i / 4) * 270;
	comp.add(
		Layer.image(still, {
			position: "absolute",
			x,
			y,
			width: 480,
			height: 270,
			fit: "cover",
		}).withEffects(fx as never),
	);
	comp.add(
		Layer.text(name, {
			position: "absolute",
			x: x + 8,
			y: y + 8,
			fontFamily: MONO,
			fontSize: 18,
			fill: "#fff",
			background: "#000",
			padding: 4,
		}),
	);
});
await fs.writeFile(
	path.join(OUTPUT, "probe-nodes.png"),
	await comp.renderFrame({ frame: 12, renderer: new HeadlessMediaRenderer() }),
);
process.exit(0);
