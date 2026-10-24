import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "CardStack",
	summary:
		"Cards in a depth stack that shuffle: the front card flies off and returns to the back, or cards are dealt onto the pile.",
	tags: [
		"cards",
		"stack",
		"deck",
		"carousel",
		"testimonials",
		"features",
		"3d",
	],
	parts: ["card-0", "card-0-clip", "tilt"],
	cues: ["changes"],
	example: `CardStack({ cards: [{ title: "Fast" }, { title: "Typed" }, { title: "Yours" }] })`,
	since: "M8",
});
