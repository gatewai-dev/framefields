/**
 * Serves Topple: the page in `index.html`, around the game in `app.ts`,
 * which the browser runs and draws with WebGPU in real time.
 *
 *   pnpm --filter @framefields/example-47-topple dev
 */
import { startPreview } from "framefields/preview";

const session = await startPreview(
	{ entry: new URL("./app.ts", import.meta.url), export: "default" },
	{
		page: new URL("../index.html", import.meta.url).pathname,
		title: "Topple",
		port: Number(process.env.PORT ?? 4747),
		idleCloseMs: false,
		notesDir: false,
		audio: false,
	},
);
console.log(`Topple: ${session.url}`);
const reason = await session.closed;
console.log(`stopped (${reason})`);
process.exit(0);
