import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Terminal",
	summary:
		"A scripted shell session: commands typed with a human rhythm, streaming output, spinners that resolve to check marks, progress bars and scrolling, with a cue for every keystroke.",
	tags: ["terminal", "shell", "cli", "developer", "demo", "typing"],
	parts: ["window", "screen", "lines", "caret"],
	cues: ["keystrokes", "submits", "outputs", "done"],
	example: `Terminal({ script: [{ cmd: "pnpm add framefields" }, { spinner: "Installing", for: 40, done: "1 package added" }] })`,
	since: "M3",
});
