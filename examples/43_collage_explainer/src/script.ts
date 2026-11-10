/**
 * The narration, one line per beat of the Explainer genre (Question, Context,
 * Steps, Payoff, Recap). The story is invented for the example and the film
 * says so: the pictures are generated, not archival.
 */
export const LINES = {
	question: "In 1931, a city decided its river was in the wrong place.",
	context:
		"The old river looped through the lowlands, and every spring it flooded the town.",
	plan: "So they drew a new course, straight through the middle of the city.",
	dig: "Three thousand workers dug it in two years, with shovels and steam cranes.",
	payoff: "In 1934 the water ran down the new channel, and the floods stopped.",
	recap: "The city didn't tame its river. It moved it.",
} as const;

export type LineId = keyof typeof LINES;
export const LINE_IDS = Object.keys(LINES) as LineId[];

/** The genre's beats, and the lines that carry each. */
export const BEATS: Record<string, LineId[]> = {
	Question: ["question"],
	Context: ["context"],
	Steps: ["plan", "dig"],
	Payoff: ["payoff"],
	Recap: ["recap"],
};
