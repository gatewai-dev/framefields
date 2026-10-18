/**
 * pnpm render       → output/physics-dancer.mp4
 * pnpm render sim   → runs tracking and physics only, prints first contacts
 *
 * Frames render in order: the cutout runs vision on the previous frame, so
 * single frames out of order would show a ghost of another moment.
 */
import path from "node:path";
import { buildFilm } from "./film.js";
import { OUTPUT } from "./theme.js";

const [mode = "video"] = process.argv.slice(2);
const film = await buildFilm();

if (mode !== "sim") {
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUTPUT, "physics-dancer.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
