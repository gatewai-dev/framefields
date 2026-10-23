import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/test-runner.ts", "src/offscreen-canvas.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
});
