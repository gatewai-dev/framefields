import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "TitleCard",
	summary:
		"Kicker, headline, rule and sub-line in designed layouts (center, left, stack, split), the headline in any reveal style, on one timeline.",
	tags: ["title", "headline", "typography", "opener", "chapter"],
	parts: ["kicker", "title", "rule", "bar", "subtitle"],
	cues: ["revealed", "settled", "exitStart"],
	example: `TitleCard({ kicker: "Chapter one", title: "Ship it faster", subtitle: "What changed in 2.5" })`,
	since: "M4",
});
