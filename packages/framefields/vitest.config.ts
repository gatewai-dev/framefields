import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.{test,spec}.ts", "test/**/*.{test,spec}.ts"],
		pool: "forks",
		testTimeout: 30000,
	},
});
