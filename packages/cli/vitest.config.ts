import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { conditions: ["development"] },
	ssr: { resolve: { conditions: ["development"] } },
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		pool: "forks",
		testTimeout: 30000,
	},
});
