import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Annotate",
	summary:
		"Marks that draw on to point at something: underline, circle, box, highlight, strike, cross, bracket, arrow or squiggle, clean or hand-drawn with a boil, with an optional label.",
	tags: [
		"annotation",
		"underline",
		"highlight",
		"arrow",
		"hand-drawn",
		"explainer",
	],
	parts: ["stroke-<n>", "head", "label"],
	cues: ["drawn", "labelIn"],
	example: `Annotate({ target: { text: headline, match: "faster" }, mark: "circle" })`,
	since: "M2",
});
