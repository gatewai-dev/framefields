import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { type CheckReport, failedCheck } from "./check-result.js";
import { ownVersion } from "./init.js";
import { projectNodeArgs } from "./project-node.js";

export interface CheckOptions {
	/** Module path, resolved from the project working directory. */
	entry: string;
	/** Composition or builder export. Defaults to buildFilm. */
	exportName?: string;
	/** Also probe the GPU and write a representative PNG and bounded grid. */
	render?: boolean;
	/** Artifact directory. Defaults to output/check, relative to the working directory. */
	outputDir?: string;
	/** Maximum worker lifetime in milliseconds. Defaults to 60000. */
	timeoutMs?: number;
	/** Treat lint warnings as a failed check. Defaults to false. */
	warningsAsErrors?: boolean;
}

/** The worker's IPC result is separate from arbitrary builder stdout/stderr. */
export async function runCheck(options: CheckOptions): Promise<CheckReport> {
	const entry = resolve(options.entry);
	const exportName = options.exportName ?? "buildFilm";
	const sdkVersion = ownVersion();
	const timeout = options.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeout) || timeout <= 0)
		throw new Error("--timeout must be a positive integer in milliseconds");
	const fail = (code: string, message: string) =>
		failedCheck(entry, exportName, sdkVersion, code, message);
	const args = projectNodeArgs(entry, "check-worker");
	if ("error" in args) return fail("missing_ts_loader", args.error);
	return new Promise((done) => {
		const child = spawn(process.execPath, args, {
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		child.stdout?.pipe(process.stderr);
		child.stderr?.pipe(process.stderr);
		let result: CheckReport | undefined;
		const timer = setTimeout(() => {
			result = fail(
				"check_timeout",
				`Check exceeded ${timeout}ms; worker terminated.`,
			);
			child.kill("SIGKILL");
		}, timeout);
		child.on("message", (message: unknown) => {
			if (isCheckReport(message)) result = message;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			done(fail("worker_start_failed", error.message));
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			done(
				result ??
					fail(
						"worker_failed",
						`Check worker exited without a result (code ${code}, signal ${signal}).`,
					),
			);
		});
		child.send({
			...options,
			entry,
			exportName,
			sdkVersion,
			outputDir: resolve(options.outputDir ?? "output/check"),
		});
	});
}

function isCheckReport(value: unknown): value is CheckReport {
	return (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		value.schemaVersion === 1 &&
		"diagnostics" in value &&
		Array.isArray(value.diagnostics)
	);
}
