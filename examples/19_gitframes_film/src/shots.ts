/**
 * Creative source of truth for every generated asset: stills (gpt-image-2),
 * their motion (h3-max-turbo image-to-video) and the score plan (ElevenLabs).
 *
 * Palette is warm and restrained: ink, bone, sand and a single ember accent.
 */

export interface Shot {
	id: string;
	/** gpt-image-2 prompt for the first frame. */
	image: string;
	/** h3 prompt describing how the still comes alive. */
	motion: string;
	seconds: number;
	/** Faces need h3-max's identity preservation; everything else runs on turbo. */
	model?: "minimax/h3-max/image-to-video";
}

const FILM =
	"Shot on 35mm Kodak Vision3 film, natural fine grain, soft highlight roll-off, warm neutral color palette of cream, sand, rust and deep brown. No blue, no teal, no cyan tones. No text, no letters, no logos, no watermark.";

export const SHOTS: Shot[] = [
	{
		id: "frame",
		image: `Cinematic wide establishing shot, symmetrical composition. A vast pale salt flat stretching to a razor-flat horizon in the lower third, bathed in warm low golden-hour sun from the left with long soft shadows. Standing dead center in the distance is a monumental freestanding empty rectangular frame made of thin matte-black steel, landscape 16:9 proportions, about six meters tall, planted upright on the ground like a doorway into nothing. A lone woman in a long burnt-orange wool coat walks toward it from the foreground, seen from behind, small in the frame, slightly left of center. The sky is a clean seamless gradient from cream to pale apricot, a faint haze near the horizon. Quiet, monumental, minimal, reminiscent of Roger Deakins and Denis Villeneuve. ${FILM}`,
		motion:
			"Slow, steady cinematic dolly forward toward the giant steel frame. The woman in the orange coat walks calmly toward the frame, her long coat and hair moving gently in the wind. Fine salt dust drifts low across the ground and the warm sunlight shimmers subtly. Smooth stabilized camera, one continuous shot, no cuts.",
		seconds: 6,
	},
	{
		id: "portrait",
		image: `Intimate cinematic close-up portrait of a woman in her late twenties with light freckles and loose dark auburn hair, face in three-quarter profile turned slightly to the left, centered in frame. She is lit by warm late-afternoon window light raking through sheer linen curtains, a sharp beam of sun across her cheek, soft falloff into deep warm shadow. A few floating dust particles glow in the light beam. Background is a softly out-of-focus warm plaster wall. 85mm lens, shallow depth of field, calm and understated, rich natural skin tones. ${FILM}`,
		motion:
			"She stays almost perfectly still in the same three-quarter profile pose, calm and present. Only a slow natural blink and a soft breath; a few loose strands of hair stir faintly and glowing dust particles drift slowly through the sunbeam. Her face, freckles and features stay exactly the same throughout. Very slow, subtle push-in, stable camera, one continuous shot, no cuts.",
		seconds: 6,
		model: "minimax/h3-max/image-to-video",
	},
	{
		id: "dancer",
		image: `A contemporary dancer in a long flowing burnt-orange silk dress captured mid-turn in an empty minimalist photo studio with a seamless warm off-white cyclorama wall and floor. The fabric of the dress swirls outward in a wide graceful arc, one arm extended. Full body, centered, generous negative space around her. Large soft key light from the right, a clean soft shadow on the floor. Elegant, graphic, editorial fashion film. ${FILM}`,
		motion:
			"The dancer spins gracefully in slow motion, the burnt-orange silk dress flares and ripples in a wide arc around her and her arms sweep through the air. Static locked-off camera, soft studio light, one continuous shot, no cuts.",
		seconds: 6,
	},
	{
		id: "ink",
		image: `Macro photograph of a single plume of vivid burnt-orange ink blooming and curling through perfectly clear still water, against a pure deep black background. Silky fluid tendrils, delicate filaments and soft billowing clouds, dramatic warm side lighting that makes the ink glow, crisp detail, centered composition with plenty of black space. High-speed fluid photography. ${FILM}`,
		motion:
			"The orange ink plume slowly blooms, curls and unfurls through the water with silky tendrils and soft billowing clouds, in graceful slow motion. Locked-off macro camera, one continuous shot, no cuts.",
		seconds: 6,
	},
];

const section = (name: string, ms: number, styles: string[], avoid: string[] = []) => ({
	section_name: name,
	duration_ms: ms,
	positive_local_styles: styles,
	negative_local_styles: avoid,
	lines: [],
});

/**
 * Section durations mirror the film's scene cuts (see timeline in film.ts), so
 * musical changes land exactly on picture changes.
 */
export const SCORE = {
	positive_global_styles: [
		"instrumental",
		"modern cinematic electronic",
		"premium product film score",
		"felt piano",
		"warm analog synthesizer",
		"deep round sub bass",
		"crisp tight percussion",
		"100 BPM",
		"elegant and confident",
		"clean high-end mix",
	],
	negative_global_styles: [
		"vocals",
		"lyrics",
		"choir",
		"dubstep",
		"heavy distortion",
		"cyberpunk",
		"lo-fi hiss",
		"guitar solo",
	],
	sections: [
		section("Open", 3000, ["solo felt piano", "three sparse notes", "intimate", "lots of silence", "soft room reverb"], ["drums", "bass"]),
		section("Film", 5400, ["warm string pad and deep sub swell enter on the downbeat", "slow cinematic chords", "felt piano melody continues"], ["drums", "kick"]),
		section("Grade", 5400, ["plucked synth ostinato in eighth notes", "soft shaker", "gently building tension", "short riser in the last bar"], ["kick"]),
		section("Motion", 4800, ["the drop: punchy kick and tight snare land on the first downbeat", "driving bass", "plucked arpeggio", "confident groove"]),
		section("Effects", 4200, ["full groove continues", "extra percussion fills", "short rhythmic stabs", "energetic"]),
		section("Code", 3600, ["sudden low-pass filtered breakdown", "ticking clock-like hi-hat", "muted pulse", "suspense"]),
		section("Resolve", 3600, ["one huge warm major chord hit on the downbeat with piano and strings", "long natural reverb tail ringing out through the entire section"], ["abrupt ending", "drums"]),
	],
};
