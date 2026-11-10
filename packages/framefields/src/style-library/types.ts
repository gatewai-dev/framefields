/**
 * The style library's model: a video's direction is one look, one format, one
 * genre, and the media it's made with (chosen per request, or left to the
 * agent). Each part owns its own sections, so parts
 * combine without overriding each other. Presets name good combinations.
 */

/** The four parts a direction is made of. */
export type StylePartKind = "look" | "format" | "genre" | "medium";
export type StyleKind = StylePartKind | "preset";

/** A part by kind and id, e.g. `"format/vertical"`. */
export type StyleRef = `${StylePartKind}/${string}`;

/** A section of a part's guidance, under its own heading. */
export interface StyleSection {
	title: string;
	body: string;
}

interface StylePartBase {
	id: string;
	name: string;
	/** One line, for cards and tables. */
	summary: string;
	tags: string[];
	/** Parts this one goes well with: suggestions, never requirements. */
	pairsWell: StyleRef[];
	/** Parts that pull against this one: a hint for the user and the agent, never a block. */
	clashes: StyleRef[];
	sections: StyleSection[];
}

/** Words added to every image and video prompt so generated media matches the look. */
export interface LookArtDirection {
	direction: string;
	avoid: string;
	motion: string;
}

export interface Look extends StylePartBase {
	kind: "look";
	/** The palette, most used first. */
	palette: string[];
	/** Font families by role (Google Fonts names). */
	fonts: { display: string; body: string; mono?: string };
	ai: LookArtDirection;
}

export interface Format extends StylePartBase {
	kind: "format";
	width: number;
	height: number;
	fps: number;
	/** Recommended length, seconds. */
	durationSec: { min: number; max: number };
	/** Where platform UI covers the frame, px at this format's size. */
	safeArea: { top: number; right: number; bottom: number; left: number };
}

export type GenreAudio = "voice" | "music" | "lyrics" | "sound";

export interface Genre extends StylePartBase {
	kind: "genre";
	/** The structure, in order. */
	beats: string[];
	audio: GenreAudio[];
}

export interface Medium extends StylePartBase {
	kind: "medium";
	/** Whether producing with it spends gateway credit. */
	credit: boolean;
	/** Gateway model ids by role ("still", "image-to-video", "music", …), current picks. */
	models: Record<string, string>;
}

export interface Preset {
	kind: "preset";
	id: string;
	name: string;
	summary: string;
	/** Shown first in pickers. */
	featured: boolean;
	look: string;
	format: string;
	genre: string;
	/** Guidance this combination adds, if any. */
	note: string;
}

export type StylePart = Look | Format | Genre | Medium;

export interface StyleLibrary {
	looks: Look[];
	formats: Format[];
	genres: Genre[];
	media: Medium[];
	presets: Preset[];
}

/** What a session or film is directed by. */
export interface StyleMix {
	look: string;
	format: string;
	genre: string;
	/**
	 * How it's made (code-drawn, 3D, footage, AI-generated). Left out, the brief lists the
	 * options and the agent picks from the request.
	 */
	media?: string[];
	/** The preset the mix started from; it adds its note while the mix still matches it. */
	preset?: string;
}

/**
 * The headings each kind may use, in the order they are written. A part that
 * writes outside its own area (a look that sets a duration, a format that sets
 * colors) fails to parse.
 */
export const SECTIONS: Record<
	StylePartKind,
	readonly { title: string; required: boolean }[]
> = {
	look: [
		{ title: "Look", required: true },
		{ title: "Type", required: true },
		{ title: "Motion", required: true },
		{ title: "Grade", required: false },
		{ title: "Build it with", required: true },
		{ title: "Avoid", required: false },
	],
	format: [
		{ title: "Frame", required: true },
		{ title: "Timing", required: true },
		{ title: "Safe areas", required: false },
		{ title: "Build it with", required: false },
	],
	genre: [
		{ title: "Beats", required: true },
		{ title: "Audio", required: true },
		{ title: "On screen", required: true },
		{ title: "Build it with", required: false },
	],
	medium: [
		{ title: "Pipeline", required: true },
		{ title: "Cost", required: false },
		{ title: "Consistency", required: false },
		{ title: "Verify", required: true },
		{ title: "Build it with", required: false },
	],
};

/** Folder names in the skill, by kind. */
export const KIND_DIRS: Record<StyleKind, string> = {
	look: "looks",
	format: "formats",
	genre: "genres",
	medium: "media",
	preset: "presets",
};
