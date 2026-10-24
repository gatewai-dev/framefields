import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "LogoReveal",
	summary:
		"The end-card lockup: a mark and a wordmark arriving as one move, drawn on, popped or wiped, with a glint across the name; names can be extruded in 3D.",
	tags: ["logo", "brand", "lockup", "end card", "outro", "wordmark", "3d"],
	parts: [
		"mark",
		"mark-clip",
		"mark-image",
		"mark-fill",
		"mark-outline",
		"name",
		"name-clip",
		"tagline",
	],
	cues: ["hit", "revealed", "glint"],
	example: `LogoReveal({ mark: "assets/logo.svg", name: "framefields", tagline: "Motion in code" })`,
	since: "M7",
});
