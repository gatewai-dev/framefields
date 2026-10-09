/**
 * Creative source of truth for every generated asset.
 *
 * The film is a chain of match cuts: every shot is built around one circle,
 * framed dead center at the same size, so a single ring can carry the eye
 * from an eclipse to an eye to a porthole … to the moon. Stills come from
 * z-image turbo, motion from MiniMax h3-max-turbo (h3-max where fine detail
 * matters), the score from MiniMax Music 3.
 */

import type { CircleSpec } from "./circles.js";

export type VideoModel =
	| "minimax/h3-max-turbo/image-to-video"
	| "minimax/h3-max/image-to-video";

export interface Shot {
	id: string;
	/** Catalogue name shown on screen. */
	name: string;
	/** z-image prompt for the first frame. */
	image: string;
	/** h3 prompt describing how the still comes alive. */
	motion: string;
	seconds: number;
	model: VideoModel;
	/** How to find this shot's circle in its frames (see circles.ts). */
	circle: CircleSpec;
}

const LOOK =
	"Cinematic film still, shot on anamorphic 35mm, rich deep warm blacks, amber and gold highlights, bone-white accents, restrained palette, fine film grain, high dynamic range. Perfectly symmetrical composition: a single perfect circle exactly in the center of the frame, its diameter about half the frame height, surrounded by dark negative space. No text, no letters, no logos, no watermark.";

const LOCKED = "One continuous shot, no cuts, no camera shake.";

export const SHOTS: Shot[] = [
	{
		id: "eclipse",
		name: "Eclipse",
		image: `A total solar eclipse in a pure black sky. The moon's perfectly black disc sits exactly in the center, ringed by a thin brilliant white-gold corona with delicate wispy streamers and a small diamond-ring flare at its upper right edge. A few faint stars. ${LOOK}`,
		motion: `The golden corona shimmers and its wispy streamers slowly breathe and ripple; the small diamond-ring flare gently blooms. Locked-off telescope camera with an extremely slow push-in; the black disc stays perfectly centered. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { polarity: "dark", threshold: 0.08, seed: [999, 516], maxR: 420 },
	},
	{
		id: "iris",
		name: "Iris",
		image: `Extreme macro photograph of a human eye seen straight on. The round iris is perfectly centered: intricate amber, honey and hazel fibres radiating around a deep black round pupil, a tiny soft catchlight. Dark lashes and eyelids frame the edges in soft shadow. ${LOOK}`,
		motion: `The pupil slowly contracts as warm light hits it and the iris fibres shift subtly; the wet surface glistens. The eye stays wide open and steady the whole time, no blinking. Locked-off macro camera, the pupil stays perfectly centered. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max/image-to-video",
		circle: { polarity: "dark", threshold: 0.07, seed: [970, 556], maxR: 260 },
	},
	{
		id: "porthole",
		name: "Porthole",
		image: `Inside the dark cabin of an old wooden ship, a round brass porthole window exactly in the center of the frame. Through its thick glass: a stormy sea at golden dusk, big rolling waves and a distant lighthouse. Raindrops on the glass. The cabin wall around it is almost black. ${LOOK}`,
		motion: `Big waves roll and break beyond the porthole glass, raindrops run down the glass, the distant lighthouse beam sweeps slowly. The porthole stays centered. Static camera. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { polarity: "light", threshold: 0.25, seed: [872, 524], maxR: 460 },
	},
	{
		id: "crema",
		name: "Crema",
		image: `Top-down overhead shot looking straight down at a single white porcelain espresso cup on a dark slate surface, the round cup exactly centered. Glossy amber-gold crema with a delicate spiral swirl, a thin wisp of steam. Moody low-key side light. ${LOOK}`,
		motion: `Seen from directly above, the golden crema slowly swirls in a spiral and thin wisps of steam rise and curl over the cup. Locked-off overhead camera, the cup stays perfectly centered. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { polarity: "dark", threshold: 0.57, seed: [974, 540], maxR: 380 },
	},
	{
		id: "record",
		name: "Record",
		image: `Top-down overhead shot looking straight down at a small black vinyl record, the whole record fully visible and exactly centered with wide dark margins around it, a plain warm amber paper label in its middle, fine grooves catching a soft gold rim light. Only the tip of a tonearm enters from the right edge. Dark walnut surface. ${LOOK}`,
		motion: `Seen from directly above, the vinyl record spins steadily clockwise and the gold light glints travel around the grooves; the tonearm stays still. Locked-off overhead camera, the record stays perfectly centered. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: {
			polarity: "light",
			threshold: 0.3,
			seed: [940, 450],
			maxR: 340,
			minR: 150,
		},
	},
	{
		id: "spotlight",
		name: "Spotlight",
		image: `Top-down overhead shot looking straight down at an empty black theatre stage. A single perfectly round pool of warm spotlight exactly in the center of the floor, and in it a dancer in a flowing bone-white dress mid-spin, the skirt flaring into a wide circle. Dust hangs in the light. ${LOOK}`,
		motion: `Seen from directly above, the dancer spins fast and her bone-white dress flares out into a wide spinning disc, arms sweeping through the air. The round spotlight on the floor stays fixed and centered. Locked-off overhead camera. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { fixed: { cx: 996, cy: 590, r: 230 } },
	},
	{
		id: "tunnel",
		name: "Tunnel",
		image: `Looking straight down the axis of a vast circular concrete tunnel, perfectly symmetrical concentric rings converging on a round opening of warm golden sunlight exactly in the center, a tiny silhouetted figure walking toward the light. ${LOOK}`,
		motion: `Slow steady dolly forward through the circular tunnel toward the glowing round opening; the tiny silhouetted figure keeps walking toward the light. Smooth stabilized camera, perfectly centered on the opening. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { polarity: "light", threshold: 0.6, seed: [968, 522], maxR: 460 },
	},
	{
		id: "moon",
		name: "Moon",
		image: `An enormous full moon hanging over a calm dark sea at night, the moon exactly in the center of the frame, pale bone-gold with visible craters, its light laying a shimmering path across the water toward the viewer. A tiny silhouette of a lone person standing on a rock at the bottom center. ${LOOK}`,
		motion: `The moonlight path shimmers and glitters on slow gentle waves; the moon hangs still and the lone figure stands still. Locked-off camera with an extremely slow push-in. ${LOCKED}`,
		seconds: 6,
		model: "minimax/h3-max-turbo/image-to-video",
		circle: { polarity: "light", threshold: 0.35, seed: [988, 334], maxR: 320 },
	},
];

/** Upper bound for the score; the analyzer measures what came back. */
export const SCORE_SECONDS = 36;

/**
 * MiniMax Music 3 takes a structured caption. The arrangement is written in
 * bars of 120 BPM (2 s each) so the analyzer has a clean grid to lock onto.
 */
export const SCORE = {
	prompt: [
		"Genre: modern cinematic electronic trailer score, minimal and premium.",
		"BPM: 120. Key: D minor. Time signature: 4/4. Instrumental only, no vocals.",
		"Emotional progression: weightless and mysterious, rising tension, a huge confident drop, a short suspended breakdown, one final resolving hit that rings out.",
		"Arrangement:",
		"Intro (bars 1-4): deep sub drone, a soft muted analog pulse on every beat, sparse distant felt piano notes, no drums.",
		"Build (bars 5-8): sixteenth-note ticking hi-hats, rising staccato string ostinato, a reversed cymbal riser into the drop.",
		"Drop (bars 9-12): massive punchy kick on every beat, tight snare on 2 and 4, gritty analog bass, bright plucked synth arpeggio.",
		"Breakdown (bars 13-14): sudden filtered hush, only the pulse and a heartbeat sub.",
		"Final (bars 15-18): one enormous orchestral and synth chord hit on the downbeat, then a long reverb tail fading to silence.",
	].join(" "),
	lyrics: ["[intro]", "[instrumental]", "[solo]", "[bridge]", "[outro]"].join(
		"\n",
	),
	/** The tempo the prompt asks for; the analyzer searches around it. */
	bpmHint: 120,
};
