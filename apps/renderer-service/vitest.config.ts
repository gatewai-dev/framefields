import path from "path";
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
	esbuild: {
		target: "es2022",
		tsconfigRaw: {
			compilerOptions: {
				experimentalDecorators: true,
				emitDecoratorMetadata: true,
			},
		},
	},
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.{test,spec}.{ts,tsx}"],
		pool: "forks",
	},
	resolve: {
		alias: [
			{
				find: "@",
				replacement: path.resolve(__dirname, "./src"),
			},
		],
	},
});
