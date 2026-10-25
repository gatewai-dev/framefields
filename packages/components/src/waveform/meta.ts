import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "Waveform",
	summary:
		"An audiogram: bars, mirrored bars, dots or a ring that move with a track's spectrum, analysed offline and bound as signals.",
	tags: [
		"audio",
		"waveform",
		"audiogram",
		"spectrum",
		"podcast",
		"music",
		"visualizer",
	],
	parts: ["bar-<n>", "spoke-<n>"],
	cues: ["beats"],
	example: `Waveform({ audio: await analyzeAudio("voice.wav", { fps: 30 }), kind: "mirror" })`,
	since: "M7",
});
