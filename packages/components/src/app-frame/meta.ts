import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "AppFrame",
	summary:
		"Window chrome around any content — desktop window, browser with a typed URL, terminal, or bare frame — and the coordinate system for pointing into it.",
	tags: ["window", "browser", "mockup", "ui", "screen recording", "device"],
	parts: [
		"shadow",
		"chrome",
		"bar",
		"divider",
		"content",
		"url-field",
		"url",
		"caret",
		"load",
		"tab-<n>",
		"light-<n>",
	],
	cues: ["urlTyped", "loaded"],
	example: `AppFrame({ kind: "browser", url: "acme.dev", content: "assets/recording.mp4" })`,
	since: "M1",
});
