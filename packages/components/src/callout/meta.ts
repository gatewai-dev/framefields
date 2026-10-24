import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Callout",
	summary:
		"A label with a leader line pinned to a point, node, text or a moving tracked object; picks the open side and stays inside the frame.",
	tags: [
		"callout",
		"label",
		"leader line",
		"annotation",
		"tracking",
		"explainer",
	],
	parts: ["leader", "leader-2", "dot", "label"],
	cues: ["in"],
	example: `Callout({ target: [820, 410], title: "New", text: "Faster renderer" })`,
	since: "M5",
});
