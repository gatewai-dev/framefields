import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Counter",
	summary:
		"A number that counts to its value on odometer reels (or stepping digits), with format-aware separators, affixes and multi-step values.",
	tags: ["number", "counter", "stat", "odometer", "data", "price"],
	parts: ["digits", "slot-<n>", "prefix", "suffix", "minus"],
	cues: ["settled", "milestones"],
	example: `Counter({ to: 12480, format: ",d", prefix: "$" })`,
	since: "M2",
});
