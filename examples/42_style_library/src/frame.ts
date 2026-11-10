/**
 * What every reference shares: the three crops, a size unit that keeps type
 * the same physical size across them, and the look's own tokens read from
 * the style library, so a reference can't drift from the text it proves.
 */
import { Composition, type LayoutNode } from "framefields";
import { type Format, type Look, styleLibrary } from "framefields/styles";
import { registerFonts } from "./fonts.js";

/** Each crop is a format of the library: its size and safe area come from there. */
const CROP_FORMATS = {
	"16:9": "widescreen",
	"9:16": "vertical",
	"1:1": "square",
} as const;
export type CropId = keyof typeof CROP_FORMATS;
export const CROP_IDS = Object.keys(CROP_FORMATS) as CropId[];

export function cropFormat(id: CropId): Format {
	const format = styleLibrary.formats.find((f) => f.id === CROP_FORMATS[id]);
	if (!format)
		throw new Error(`No format "${CROP_FORMATS[id]}" in the style library.`);
	return format;
}
export const FPS = 30;

export interface Crop {
	id: CropId;
	width: number;
	height: number;
	/** 1 at 1080 px on the short side. */
	u: number;
	/** Portrait (9:16): stack instead of placing side by side. */
	tall: boolean;
	/** Where type and key detail may go: the frame minus the format's safe area. */
	safe: { x: number; y: number; width: number; height: number };
}

export const crop = (id: CropId): Crop => {
	const { width, height, safeArea: s } = cropFormat(id);
	return {
		id,
		width,
		height,
		u: Math.min(width, height) / 1080,
		tall: height > width,
		safe: {
			x: s.left,
			y: s.top,
			width: width - s.left - s.right,
			height: height - s.top - s.bottom,
		},
	};
};

export function lookTokens(id: string): Look {
	const look = styleLibrary.looks.find((l) => l.id === id);
	if (!look) throw new Error(`No look "${id}" in the style library.`);
	return look;
}

/** A look's reference: a short clip and the frame that represents it. */
export interface Reference {
	look: string;
	/** Frames in the clip. */
	frames: number;
	/** The moment the cards show. */
	hero: number;
	/** What the hero frame shows, for people who can't see it. */
	alt: string;
	build(c: Crop): LayoutNode[] | Promise<LayoutNode[]>;
	/** Grade over the whole frame, as the look's Grade section says. */
	grade?(comp: Composition): void;
}

const fontsOf = (look: Look) => [
	...new Set([
		look.fonts.display,
		look.fonts.body,
		...(look.fonts.mono ? [look.fonts.mono] : []),
	]),
];

export async function referenceComposition(
	ref: Reference,
	id: CropId,
): Promise<Composition> {
	const look = lookTokens(ref.look);
	const c = crop(id);
	const fonts = await registerFonts(fontsOf(look));
	const comp = new Composition({
		width: c.width,
		height: c.height,
		fps: FPS,
		durationMs: (ref.frames / FPS) * 1000,
		backgroundColor: look.palette[0],
		fonts,
	});
	comp.add(await ref.build(c));
	ref.grade?.(comp);
	return comp;
}

/** The edges to lay out against: the safe area, but never closer to the frame than `min` px. */
export function edges(c: Crop, min: number) {
	return {
		left: Math.max(min, c.safe.x),
		top: Math.max(min, c.safe.y),
		right: c.width - Math.max(min, c.width - c.safe.x - c.safe.width),
		bottom: c.height - Math.max(min, c.height - c.safe.y - c.safe.height),
	};
}
