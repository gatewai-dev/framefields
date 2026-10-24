import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Selection",
	summary:
		"A text selection or a marquee driven by a MousePointer drag: it follows the pointer glyph by glyph, and lights up covered items.",
	tags: [
		"selection",
		"highlight",
		"marquee",
		"drag",
		"editor",
		"ui",
		"pointer",
	],
	parts: ["line-0", "marquee", "item-0"],
	cues: ["selected", "items"],
	example: `Selection({ target: { text: paragraph, match: "the key line" }, pointer })`,
	since: "M8",
});
