import path from "node:path";
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.{test,spec}.{ts,tsx}"],
		pool: "forks",
		// Git, git-lfs and installs run for real; under a parallel run they
		// take longer than vitest's 5 s default.
		testTimeout: 30_000,
	},
	resolve: {
		alias: [
			{
				find: "@",
				replacement: path.resolve(import.meta.dirname, "./src"),
			},
		],
	},
});
