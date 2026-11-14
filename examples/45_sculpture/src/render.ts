/**
 * pnpm render              → output/sculpture.mp4 (the sculpting film) and
 *                            output/sculpture.jpg (its last frame)
 * pnpm render frames 0 60  → output/frame-0.png, output/frame-60.png
 * pnpm render model        → output/guardian.glb: the finished bust (a mesh at
 *                            resolution 640), its
 *                            plinth, camera and lights as glTF
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HeadlessMediaRenderer } from "framefields";
import sharp from "sharp";
import { durationFrames, H, sculptureFilm, W } from "./sculpture.js";

const OUTPUT = path.join(
	path.dirname(path.dirname(fileURLToPath(import.meta.url))),
	"output",
);
await fs.mkdir(OUTPUT, { recursive: true });
const [mode = "film", ...rest] = process.argv.slice(2);
// An export keeps the stone's finest relief: a mesh lattice finer than it.
const comp = sculptureFilm({ modelResolution: mode === "model" ? 640 : 192 });
const renderer = new HeadlessMediaRenderer();

async function still(frame: number, file: string): Promise<void> {
	const rgba = await comp.renderFrame({ frame, format: "rgba", renderer });
	const image = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });
	await (file.endsWith(".jpg")
		? image.jpeg({ quality: 82 })
		: image.png()
	).toFile(file);
	console.log(file);
}

if (mode === "frames") {
	for (const f of rest.map(Number))
		await still(f, path.join(OUTPUT, `frame-${f}.png`));
} else if (mode === "model") {
	const model = await comp.exportModel({
		frame: durationFrames() - 1,
		outputPath: path.join(OUTPUT, "guardian.glb"),
	});
	console.log(`${model.filePath}: ${model.triangles} triangles`);
	for (const what of model.skipped) console.log(`not in the file: ${what}`);
} else {
	const started = performance.now();
	const result = await comp.renderVideo({
		outputPath: path.join(OUTPUT, "sculpture.mp4"),
		quality: "high",
		renderer,
		qa: true,
	});
	await result.cleanup?.();
	console.log(
		`${result.filePath}: ${durationFrames()} frames in ${((performance.now() - started) / 1000).toFixed(1)} s, QA ${result.qa?.passed ? "passed" : "failed"}`,
	);
	await still(durationFrames() - 1, path.join(OUTPUT, "sculpture.jpg"));
}
process.exit(0);
