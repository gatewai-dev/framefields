import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "WordCycle",
	summary:
		"One slot in a line cycles through words: rolled, faded, slid or retyped, while the slot resizes to each word and the line glides to fit.",
	tags: [
		"text",
		"headline",
		"rotating word",
		"kinetic type",
		"launch",
		"typography",
	],
	parts: ["before", "slot", "word-0", "after", "pill", "underline"],
	cues: ["changes"],
	example: `WordCycle({ text: "Make videos {}", words: ["faster", "together", "in code"] })`,
	since: "M7",
});
