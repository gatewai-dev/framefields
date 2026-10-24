import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Backdrop",
	summary:
		"The surface behind a scene: a drifting mesh gradient, a grid or a dot field, with vignette and film grain, looping exactly.",
	tags: ["background", "backdrop", "gradient", "grid", "dots", "grain", "loop"],
	parts: [
		"surface",
		"background",
		"blob-0",
		"blob-0-x",
		"pattern",
		"pattern-lit",
		"glow-matte",
		"glow",
		"vignette",
		"grain",
	],
	cues: ["loops"],
	example: `Backdrop({ kind: "mesh" })`,
	since: "M7",
});
