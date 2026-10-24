import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "BeforeAfter",
	summary:
		"Two versions of one picture split by a moving divider with a grip and labels: a clip with and without an effect, a redesign, a cleanup.",
	tags: ["before after", "comparison", "split", "wipe", "slider", "effects"],
	parts: [
		"after",
		"before",
		"before-clip",
		"divider",
		"handle",
		"label-0",
		"label-1",
	],
	cues: ["settled"],
	example: `BeforeAfter({ before: "assets/raw.mp4", after: graded })`,
	since: "M8",
});
