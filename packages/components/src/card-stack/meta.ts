import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "CardStack",
	summary:
		"Cards in a depth stack that shuffle: the front card flies, drops, zooms or flips away and returns to the back; cards are dealt onto the pile; or the stack fans out into a hand.",
	tags: [
		"cards",
		"stack",
		"deck",
		"carousel",
		"fan",
		"testimonials",
		"features",
		"3d",
	],
	parts: ["card-<n>", "card-<n>-clip", "tilt"],
	cues: ["changes"],
	example: `CardStack({ cards: [{ title: "Fast" }, { title: "Typed" }, { title: "Yours" }] })`,
	since: "M8",
});
