import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "TextReveal",
	summary:
		"Headlines and body copy that animate in and out by character, word or line: rise, blur, mask, slam, scatter, scramble, type, stream, wipe and flip, each ending on exactly the static text.",
	tags: ["text", "typography", "kinetic type", "title", "reveal", "typewriter"],
	parts: ["text", "shake", "caret", "matte", "reels", "units", "line-<n>"],
	cues: ["units", "revealed", "exitStart", "keystrokes"],
	example: `TextReveal({ text: "Ship it faster", style: "rise", emphasis: ["faster"] })`,
	since: "M2",
});
