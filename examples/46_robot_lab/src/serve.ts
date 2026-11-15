/**
 * Serves the robot lab: the page in `index.html`, around the composition in
 * `app.ts`, which the browser runs and draws with WebGPU in real time.
 *
 *   pnpm --filter @framefields/example-46-robot-lab dev
 */
import { startPreview } from "framefields/preview";

const session = await startPreview(
	{ entry: new URL("./app.ts", import.meta.url), export: "default" },
	{
		page: new URL("../index.html", import.meta.url).pathname,
		title: "Robot lab",
		port: Number(process.env.PORT ?? 4646),
		idleCloseMs: false,
		notesDir: false,
		audio: false,
	},
);
console.log(`Robot lab: ${session.url}`);
const reason = await session.closed;
console.log(`stopped (${reason})`);
process.exit(0);
