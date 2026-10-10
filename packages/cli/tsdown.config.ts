import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/bin.ts"],
	format: ["esm"],
	clean: true,
	dts: false,
	target: "node22",
	platform: "node",
	// The manifest reader is tiny and has no engine dependencies: bundle it so
	// installing the CLI never installs the engine. Rendering uses the
	// `framefields` installed in the project.
	noExternal: [/^framefields\/project$/],
	external: [/^node:/, /^@clack\//, "commander", "tsx", /^tsx\//, "zod"],
});
