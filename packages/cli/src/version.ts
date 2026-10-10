import { createRequire } from "node:module";

/** The CLI's version, which is also the engine version `ff init` installs. */
export const VERSION: string = (
	createRequire(import.meta.url)("../package.json") as { version: string }
).version;
