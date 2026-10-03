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
		"@gitframes/core",
		"@gitframes/client-utils",
		"@gitframes/node-sdk",
		"@gitframes/server-utils",
		"@gitframes/renderers",
		"zod",
	],
});
