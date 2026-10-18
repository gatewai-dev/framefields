/**
 * pnpm render       → output/physics-dancer.mp4
 * pnpm render sim   → analyses the clip and steps the physics without drawing, prints first contacts
 * pnpm render preview → live player on localhost (add --open); vision and physics fill in as it plays
 *
 * Vision results persist in ~/.cache/framefields/vision, so only the first run analyses the clip.
 */
import path from "node:path";
import { startPreview } from "framefields";
import { buildScene, DURATION_FRAMES } from "./film.js";
import { OUTPUT } from "./theme.js";

const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
	const session = await startPreview(
		{ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
		{ title: "Physics dancer", open: args.includes("--open") },
	);
	console.log(`Preview at ${session.url}`);
	await session.closed;
	process.exit(0);
}

const { comp, world, cards } = await buildScene();

if (mode === "sim") {
	const started = Date.now();
	await world.advanceTo(DURATION_FRAMES - 1);
	console.log(
		`Analysed and simulated in ${((Date.now() - started) / 1000).toFixed(1)} s`,
	);
	for (const { id, body } of cards) {
		const hit = body.collisions[0];
		console.log(
			`${id}: first contact at frame ${hit?.frame ?? "-"} (${hit?.with.type ?? "none"})`,
		);
	}
} else {
	const started = Date.now();
	const result = await comp.renderVideo({
		outputPath: path.join(OUTPUT, "physics-dancer.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
