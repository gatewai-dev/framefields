#!/usr/bin/env node
import { run } from "./cli.js";
import { EXIT } from "./errors.js";
import { processIo } from "./output.js";

process.on("SIGINT", () => process.exit(EXIT.interrupted));

const code = await run(process.argv.slice(2), {
	io: processIo(),
	env: process.env,
	cwd: process.cwd(),
});
// Engines and preview servers can hold the event loop open; the command is done.
process.exit(code);
