import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "CodeBlock",
	summary:
		"Code that reads like an editor and moves like an explanation: syntax colours, typing, a focus band that walks the lines, and diffs where kept lines glide to their new places.",
	tags: ["code", "syntax", "diff", "developer", "tutorial", "typing"],
	parts: ["code", "line-<n>", "number-<n>", "band", "caret", "window"],
	cues: ["keystrokes", "lines", "focus", "diff"],
	example: `CodeBlock({ code, lang: "ts", focus: [{ at: 60, lines: [3] }] })`,
	since: "M4",
});
