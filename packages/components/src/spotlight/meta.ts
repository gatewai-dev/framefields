import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Spotlight",
	summary:
		"Dims the frame except a region that glides between targets, as a crisp rounded rect or a soft pool of light.",
	tags: ["spotlight", "focus", "dim", "highlight", "tutorial", "ui"],
	parts: ["dim", "hole"],
	cues: ["moves"],
	example: `Spotlight({ targets: [{ at: 0, target: button }, { at: 60, target: menu }] })`,
	since: "M5",
});
