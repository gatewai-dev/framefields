/** → output/motion-high.mp4: the motion scene at 1920×1080 with the default (high) tracing preset. */
import path from "node:path";
import { OUTPUT } from "./paths.js";
import { motionScene } from "./scenes.js";

const t = performance.now();
const r = await motionScene({ scale: 2 }).renderVideo({
	outputPath: path.join(OUTPUT, "motion-high.mp4"),
	quality: "high",
});
await r.cleanup?.().catch(() => {});
console.log(`${r.filePath} (${((performance.now() - t) / 1000).toFixed(1)} s)`);
process.exit(0);
