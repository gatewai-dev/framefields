import { RenderError } from "../errors.js";

/**
 * Thrown in place of exiting when repo code calls process.exit() while a job
 * runs in the worker (PLAN.md §8.2).
 */
export class ExitTrap extends RenderError {
	constructor(code: number | string | null | undefined) {
		super(
			"EXPORT_SIDE_EFFECT",
			`Repo code called process.exit(${code ?? ""}) while the worker was loading or rendering it.`,
			{
				phase: "load",
				hint: "Export a builder (a Composition or a function returning one); don't render or exit at import time.",
			},
		);
	}
}

export interface SandboxOptions {
	cwd: string;
	argv1: string;
	env: Record<string, string>;
}

export interface Sandbox {
	/** Rejects when repo code fails out of band (stray rejection / exception). */
	readonly failed: Promise<never>;
	restore(): void;
}

let active: { fail(err: unknown): void } | undefined;
let strayErrors = 0;

/** Errors raised by repo code after its job finished. */
export function strayErrorCount(): number {
	return strayErrors;
}

/**
 * Process-level handlers, installed once at boot: an unhandled rejection or
 * exception fails the active job instead of crashing the worker. With no job
 * running it is logged and counted (recycle trigger).
 */
export function installProcessGuards(
	log: (msg: string, err: unknown) => void,
): void {
	const onError = (err: unknown) => {
		if (active) active.fail(err);
		else {
			strayErrors++;
			log("Error outside any job", err);
		}
	};
	process.on("unhandledRejection", onError);
	process.on("uncaughtException", onError);
}

/**
 * Prepares the shared process for one job and returns how to undo it. Only
 * one sandbox can be open at a time (the queue runs one job at a time).
 */
export function openSandbox(options: SandboxOptions): Sandbox {
	if (active) throw new Error("A job sandbox is already open.");

	const previousCwd = process.cwd();
	const previousArgv = process.argv;
	const previousExit = process.exit;
	const previousEnv = new Map<string, string | undefined>();

	for (const [key, value] of Object.entries(options.env)) {
		previousEnv.set(key, process.env[key]);
		process.env[key] = value;
	}
	process.chdir(options.cwd);
	process.argv = [previousArgv[0], options.argv1];
	process.exit = ((code?: number | string | null) => {
		throw new ExitTrap(code);
	}) as typeof process.exit;

	let fail!: (err: unknown) => void;
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	failed.catch(() => {}); // observed via race(); never unhandled
	active = { fail };

	return {
		failed,
		restore() {
			process.exit = previousExit;
			process.argv = previousArgv;
			try {
				process.chdir(previousCwd);
			} catch {
				process.chdir("/");
			}
			for (const [key, value] of previousEnv) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			active = undefined;
		},
	};
}
