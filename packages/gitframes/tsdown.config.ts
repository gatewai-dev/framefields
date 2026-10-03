import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/effects/index.ts",
		"src/audio/index.ts",
		"src/signals/index.ts",
		"src/react/index.ts",
		"src/renderer/index.ts",
		"src/fonts/index.ts",
	],
	format: ["esm"],
	clean: true,
	dts: true,
	target: "es2022",
});
