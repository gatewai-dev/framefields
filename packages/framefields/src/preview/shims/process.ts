// A minimal `process` for the browser preview. It has no `versions.node`, so
// code that checks for Node takes its browser path. Also set as the global, for
// the project's own code, which is bundled separately from the engine.
type Process = ReturnType<typeof createProcess>;

function createProcess() {
	const p = {
		env: { NODE_ENV: "production" } as Record<string, string | undefined>,
		argv: [] as string[],
		platform: "browser",
		browser: true,
		cwd: () => "/",
		nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
			queueMicrotask(() => fn(...args)),
		on: (): unknown => p,
		emitWarning: () => undefined,
	};
	return p;
}

const g = globalThis as unknown as { process?: Process };
export const process: Process = g.process ?? createProcess();
g.process ??= process;
