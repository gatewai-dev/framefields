import { Worker } from "node:worker_threads";

/**
 * Event-loop watchdog (PLAN.md §8.3). Repo code runs on the main thread, so
 * a synchronous infinite loop would freeze the worker forever. A helper
 * thread watches a heartbeat the main loop bumps every second; if it stops
 * for `blockSec`, the thread writes the crash journal and kills the process
 * so the supervisor (RunPod, Docker, k8s) starts a fresh one.
 */
const WATCHER = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const beat = new Int32Array(workerData.buffer);
let last = Atomics.load(beat, 0);
let lastChange = Date.now();
setInterval(() => {
	const now = Atomics.load(beat, 0);
	if (now !== last) { last = now; lastChange = Date.now(); return; }
	if (Date.now() - lastChange < workerData.blockMs) return;
	try {
		const journal = JSON.parse(fs.readFileSync(workerData.journal, "utf8"));
		journal.exitReason = "event loop blocked for " + Math.round((Date.now() - lastChange) / 1000) + "s";
		fs.writeFileSync(workerData.journal, JSON.stringify(journal));
	} catch {}
	process.kill(process.pid, "SIGKILL");
}, 1000);
`;

export function startWatchdog(options: {
	blockSec: number;
	journalPath: string;
}): () => void {
	if (options.blockSec <= 0) return () => {};
	const buffer = new SharedArrayBuffer(4);
	const beat = new Int32Array(buffer);
	const heartbeat = setInterval(() => Atomics.add(beat, 0, 1), 1000);
	heartbeat.unref();
	const worker = new Worker(WATCHER, {
		eval: true,
		workerData: {
			buffer,
			blockMs: options.blockSec * 1000,
			journal: options.journalPath,
		},
	});
	worker.unref();
	return () => {
		clearInterval(heartbeat);
		void worker.terminate();
	};
}
