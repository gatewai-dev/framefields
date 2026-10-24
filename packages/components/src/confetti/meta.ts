import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Confetti",
	summary:
		"Celebration bursts of paper, ribbons and sparkles on the GPU that arc up, flutter down and can settle on a floor; bursts can follow cues.",
	tags: ["confetti", "celebration", "particles", "burst", "success", "party"],
	parts: ["paper-<o>-<n>", "ribbons-<o>", "sparkles-<o>"],
	cues: ["bursts"],
	example: `Confetti({ bursts: [{ at: 30, origin: [960, 900] }], floor: true })`,
	since: "M5",
});
