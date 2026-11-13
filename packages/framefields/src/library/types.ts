/**
 * The framefields library: curated code and media on framefields.dev, in the
 * component registry's format. Every item is a registry item; it may carry
 * source files (copied into the project, like a component), media (pinned by
 * content in `framefields.json` and downloaded verified), or both. Media
 * items ship a small generated module next to their files that names the
 * pinned path and the analysis (duration, beats, size), so code reads it the
 * way it reads any import.
 */

/** What an item is. Code kinds are copied in; media kinds are pinned. */
export const LIBRARY_KINDS = [
	"template",
	"component",
	"shader",
	"vfx",
	"music",
	"sfx",
	"ambience",
	"background",
	"footage",
	"overlay",
	"texture",
	"lut",
	"hdri",
	"model",
	"lottie",
] as const;

export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** The kinds that are source code, edited by the project once added. */
export const CODE_KINDS: ReadonlySet<LibraryKind> = new Set([
	"template",
	"component",
	"shader",
	"vfx",
]);

/** How people see each kind: the desktop app's categories and the CLI. */
export const KIND_LABELS: Record<LibraryKind, string> = {
	template: "Templates",
	component: "Components",
	shader: "Shaders",
	vfx: "VFX",
	music: "Music",
	sfx: "SFX",
	ambience: "Ambience",
	background: "Backgrounds",
	footage: "Footage",
	overlay: "Overlays",
	texture: "Textures",
	lut: "LUTs",
	hdri: "HDRIs",
	model: "3D models",
	lottie: "Lottie",
};

export function isLibraryKind(value: unknown): value is LibraryKind {
	return (
		typeof value === "string" &&
		(LIBRARY_KINDS as readonly string[]).includes(value)
	);
}

/** Under what terms an item may be used; every library item has one. */
export interface LibraryLicense {
	/** SPDX id (`CC0-1.0`, `Apache-2.0`), or `framefields` for media we own and license royalty-free. */
	id: string;
	/** May be used in paid, commercial work. */
	commercial: boolean;
	/** Credit the license asks for, when it asks for one. */
	attribution?: string;
	/** Where the item came from (the original page), for provenance. */
	source?: string;
}

/**
 * What a card shows. Paths are relative to the library's base URL and point
 * at content-addressed files, so they never change under a cache.
 */
export interface LibraryPreview {
	/** A still, WebP or PNG. */
	poster?: string;
	/** A short muted loop (MP4) played on hover; audio items play `audio`. */
	clip?: string;
	/** What an audio item plays on hover; usually the item's own file. */
	audio?: string;
	/** Seconds into `audio` the audition starts (the strongest stretch). */
	start?: number;
	/** Width over height of the poster and clip. */
	aspect?: number;
	/** Dominant color, for the card before its poster arrives. */
	color?: string;
	/** Audio level over the whole item, 0–1, for the waveform (about 96 values). */
	peaks?: number[];
}

/** What search filters on, without loading the item. */
export interface LibraryFacets {
	/** Seconds, for audio and video. */
	duration?: number;
	/** Tempo, for music. */
	bpm?: number;
	/** Plays seamlessly on repeat. */
	loop?: boolean;
	/** Has transparency (overlays, cutouts). */
	alpha?: boolean;
	width?: number;
	height?: number;
}

/** A pinned media file an item installs. */
export interface LibraryAsset {
	/** Where it goes, under the project's `assets/library/`: `music/neon-drive.mp3`. */
	path: string;
	sha256: string;
	size: number;
	/** Where it downloads from: relative to the library's base URL, or absolute. */
	url: string;
}

/** Measured once when the item is published, so every project reuses it. */
export interface LibraryAnalysis {
	/** Seconds. */
	duration?: number;
	/** Onsets in seconds (beats for music, hits for SFX). */
	beats?: number[];
	bpm?: number;
	/** Seconds until the sound starts: line an SFX's onset up with the frame it marks. */
	onset?: number;
	width?: number;
	height?: number;
	fps?: number;
}

/** Where `framefields add` puts library media, relative to the project. */
export const LIBRARY_ASSETS_DIR = "assets/library";

/** The library on framefields.dev. `FRAMEFIELDS_LIBRARY` overrides it. */
export const LIBRARY_URL = "https://cdn.framefields.dev/library/";

/** A library path (`files/ab….webp`) or URL, as an absolute URL. */
export function libraryUrl(path: string, base = LIBRARY_URL): string {
	return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
}
