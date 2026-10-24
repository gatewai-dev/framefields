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
	parts: ["bar-0", "spoke-0"],
	cues: ["beats"],
	example: `Waveform({ audio: await analyzeAudio("voice.wav", { fps: 30 }), kind: "mirror" })`,
	since: "M7",
});
