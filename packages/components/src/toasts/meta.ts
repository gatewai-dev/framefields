import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Toasts",
	summary:
		"Notifications arriving into a corner stack that pushes older ones away and compresses as it grows; each slides out when dismissed.",
	tags: ["toast", "notification", "alert", "ui", "stack", "demo"],
	parts: ["toast-<n>"],
	cues: ["arrivals", "dismissals"],
	example: `Toasts({ items: [{ at: 0, title: "Deployed", kind: "success" }, { at: 40, title: "3 new comments" }] })`,
	since: "M5",
});
