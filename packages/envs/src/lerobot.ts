/**
 * Exports reacher episodes as a LeRobot v3.0 dataset:
 *
 *   pnpm --filter @framefields/envs lerobot --out <dir> [--seeds 0-9]
 */
import { rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { LeRobotWriter } from "framefields/datasets";
import { REACHER_CLIP, reacherEpisode } from "./envs/reacher.js";

const { values } = parseArgs({
	options: {
		out: { type: "string" },
		seeds: { type: "string", default: "0-2" },
	},
});
if (!values.out) throw new Error("usage: lerobot --out <dir> [--seeds 0-9]");
const [a, b] = values.seeds.split("-").map(Number);
const seeds = Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
rmSync(values.out, { recursive: true, force: true });
const writer = new LeRobotWriter({
	dir: values.out,
	fps: REACHER_CLIP.fps,
	robotType: "reacher-2dof",
});
for (const seed of seeds) {
	const started = performance.now();
	const { index, frames } = await writer.addEpisode(await reacherEpisode(seed));
	console.error(
		`episode ${index} (seed ${seed}): ${frames} frames, ${((performance.now() - started) / 1000).toFixed(1)} s`,
	);
}
const done = await writer.close();
console.error(
	`${done.episodes} episodes, ${done.frames} frames: ${values.out}`,
);
process.exit(0);
