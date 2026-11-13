import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/gltf/index.ts",
		"src/math3d/index.ts",
		"src/text-animations/index.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
});
