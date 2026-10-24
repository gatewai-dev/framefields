import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "LowerThird",
	summary:
		"The name-and-role bar of interviews and talks: measured plates in the safe area that slide in and leave on their own.",
	tags: ["lower third", "name", "interview", "talk", "caption", "broadcast"],
	parts: ["plate", "edge", "name-plate", "role-plate", "tag", "line", "text"],
	cues: ["in", "out"],
	example: `LowerThird({ name: "Ada Lovelace", role: "Engineer" })`,
	since: "M4",
});
