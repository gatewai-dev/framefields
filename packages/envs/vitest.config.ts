import { defineConfig } from "vitest/config";

export default defineConfig({
	// framefields from its sources, as `pnpm generate` runs it.
	resolve: { conditions: ["development"] },
	ssr: { resolve: { conditions: ["development"] } },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		pool: "forks",
		testTimeout: 120000,
	},
});
