import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		server: "server/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
	external: ["@gitframes/server-utils", "sharp"],
});
