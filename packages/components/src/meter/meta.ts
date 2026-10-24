import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Meter",
	summary:
		"Progress and scores as a ring, arc gauge, bar, lit segments or star rating, filling on the same timeline as its counter.",
	tags: ["progress", "gauge", "score", "rating", "stat", "data"],
	parts: ["track", "fill", "counter", "label", "cell-<n>", "star-<n>"],
	cues: ["settled", "crossings"],
	example: `Meter({ value: 72, kind: "ring", label: "Coverage" })`,
	since: "M4",
});
