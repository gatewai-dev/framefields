import path from "node:path";
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
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
