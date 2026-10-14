import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { RenderError } from "../errors.js";
import type { JobRecord } from "./store.js";

/**
 * The running job, on local disk, so a process that dies mid-render (OOM,
 * native crash, watchdog kill) can still report it after restart (§8.3).
 * Sync I/O on purpose: it must land before repo code gets to run.
 */
export interface JournalEntry {
	jobId: string;
	startedAt: string;
	createdAt: string;
	/** Set by the watchdog right before it kills the process. */
	exitReason?: string;
}

export class CrashJournal {
	constructor(private readonly file: string) {}

	get path(): string {
		return this.file;
	}

	begin(entry: JournalEntry): void {
		writeFileSync(this.file, JSON.stringify(entry));
	}

	end(): void {
		rmSync(this.file, { force: true });
	}

	/**
	 * Returns the job a previous process died on, as a failed record, and
	 * clears the journal. Undefined when the last shutdown was clean.
	 */
	recover(): JobRecord | undefined {
		let entry: JournalEntry;
		try {
			entry = JSON.parse(readFileSync(this.file, "utf8")) as JournalEntry;
		} catch {
			return undefined;
		} finally {
			rmSync(this.file, { force: true });
		}
		const oom = /heap|memory/i.test(entry.exitReason ?? "");
		const error = new RenderError(
			oom ? "RENDER_OOM" : "RENDER_CRASHED",
			`The worker process died during this job${entry.exitReason ? ` (${entry.exitReason})` : ""}.`,
			{ phase: "render", hint: "A fresh worker can retry it." },
		);
		const now = new Date().toISOString();
		return {
			id: entry.jobId,
			status: "FAILED",
			progress: { phase: "done" },
			createdAt: entry.createdAt,
			startedAt: entry.startedAt,
			updatedAt: now,
			finishedAt: now,
			error: error.toJSON(),
			warnings: [],
		};
	}
}
