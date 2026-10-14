/** Blocks the event loop under the watchdog. Usage: tsx test/watchdog-harness.ts <journal> */
import { CrashJournal } from "../src/jobs/journal.js";
import { startWatchdog } from "../src/worker/watchdog.js";

const journal = new CrashJournal(process.argv[2]);
journal.begin({ jobId: "stuck", createdAt: "x", startedAt: "y" });
startWatchdog({ blockSec: 2, journalPath: journal.path });
setTimeout(() => {
	// Repo code stuck in a synchronous loop.
	for (;;) {}
}, 1500);
