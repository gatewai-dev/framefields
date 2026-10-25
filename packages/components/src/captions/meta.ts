import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Captions",
	summary:
		"Word-timed captions from words or a transcript (SRT, WebVTT, word JSON) in eight published styles, highlighting each word on its exact frame, optionally tucked behind the speaker.",
	tags: [
		"captions",
		"subtitles",
		"social",
		"talking head",
		"transcript",
		"karaoke",
	],
	parts: ["phrase-<n>", "behind"],
	cues: ["words", "phrases"],
	example: `Captions({ transcript: srt, style: "karaoke", emphasis: ["faster"] })`,
	since: "M3",
	fonts: [{ font: "emoji", why: "Social captions often carry emoji." }],
});
