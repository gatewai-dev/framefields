import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/server.ts", "src/program/index.ts"],
	format: ["esm"],
	dts: true,
	clean: false,
	sourcemap: true,
	treeshake: true,
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@framefields/core",
		"@framefields/client-utils",
		"@framefields/node-sdk",
		"@framefields/server-utils",
		"@framefields/renderers",
		"zod",
	],
});
