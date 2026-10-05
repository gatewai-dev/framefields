// A minimal `process` for the browser preview bundle. It has no
// `versions.node`, so code that checks for Node takes its browser path.
export const process = {
	env: { NODE_ENV: "development" } as Record<string, string | undefined>,
	argv: [] as string[],
	platform: "browser",
	browser: true,
	cwd: () => "/",
	nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
		queueMicrotask(() => fn(...args)),
	on: () => process,
	emitWarning: () => undefined,
};
