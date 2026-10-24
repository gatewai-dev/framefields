import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "FocusZoom",
	summary:
		"A camera over 2D content that pushes in on each burst of pointer clicks (or on given shots) and eases back out, clamped to the content.",
	tags: ["camera", "zoom", "auto-zoom", "screen recording", "demo", "focus"],
	parts: ["clip", "camera"],
	cues: ["shots"],
	example: `FocusZoom({ content: [frame, pointer], follow: pointer })`,
	since: "M1",
});
