import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "MousePointer",
	summary:
		"An animated pointer that travels between targets, clicks, drags and changes shape, reporting every click as a cue.",
	tags: ["pointer", "cursor", "demo", "ui", "interaction", "screen recording"],
	parts: [
		"motion",
		"cursor",
		"glyph-<style>",
		"label",
		"trail-<n>",
		"ripple-<n>-<m>",
	],
	cues: ["arrivals", "presses", "releases", "clicks", "drags"],
	example: `MousePointer({ path: [{ to: [400, 300] }, { to: [900, 520], click: true }] })`,
	since: "M1",
});
