import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/schemas.ts", "src/web.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
});
