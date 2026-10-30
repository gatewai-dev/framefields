import { cpSync, existsSync } from "node:fs";
import { defineConfig } from "tsdown";
import { writeApiCatalog } from "./scripts/build-api-catalog.ts";
import { fixDtsAliases } from "./scripts/fix-dts-aliases.mjs";
import { buildEngine } from "./src/preview/bundle.ts";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/effects/index.ts",
		"src/audio/index.ts",
		"src/signals/index.ts",
		"src/renderer/index.ts",
		"src/fonts/index.ts",
		"src/preview/index.ts",
		"src/components/index.ts",
		"src/cli.ts",
		"src/cli/check-worker.ts",
	],
	format: ["esm"],
	clean: true,
	onSuccess: async () => {
		// The live preview's browser engine, shipped prebuilt in dist/preview-engine.
		await buildEngine("dist/preview-engine");
		// The component registry `framefields add` installs from.
		const registry = "../components/dist/registry";
		if (!existsSync(registry))
			throw new Error(
				`${registry} is missing: build @framefields/components first`,
			);
		cpSync(registry, "dist/registry", { recursive: true });
		fixDtsAliases("dist");
		writeApiCatalog("dist/api.json");
	},
	dts: { resolve: [/^@framefields\//] },
	target: "es2022",
	noExternal: [/^@framefields\//],
	external: [
		/^node:/,
		/^@napi-rs\//,
		/^@resvg\//,
		/^@mediabunny\//,
		/^@dimforge\//,
		/^@lottiefiles\//,
		"mediabunny",
		"onnxruntime-node",
		"skia-canvas",
		"fontkit",
		/^d3-/,
		"webgpu",
		"yoga-layout",
		"zod",
		"sharp",
		"gsap",
		"earcut",
		"fflate",
		"gifuct-js",
		"nanoid",
		"pino",
		"file-type",
		"dotenv",
		"@framefields/vision-sam",
	],
});
