import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/toolkit.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
	external: [/^@framefields\//, "zod"],
});
