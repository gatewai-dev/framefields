/**
 * The generated layers of the compositing chapter (pnpm images): each prompt
 * is written for the one operation that image demonstrates.
 */
import { asset } from "./paths.js";

export const IMAGE_SIZE = { width: 1920, height: 1088 };

export const IMAGES = {
	backdrop:
		"Minimal sunlit architecture: curved white concrete walls and a wide staircase under a clear pale blue sky, soft long shadows, airy pastel tones, editorial architectural photography, lots of empty space in the centre, no people, no text",
	subject:
		"A vintage cine film camera, chrome and glossy cobalt blue body, three-quarter view, floating, sharp edges, studio product photography, against a perfectly flat uniform pure chroma key green (#00FF00) background with no gradient and no shadow on the background, centred, no text",
	leak: "Abstract warm golden-orange and soft magenta anamorphic light leak with long horizontal lens flare streaks and bokeh, on a pure black background, film burn, no objects, no text",
	paper:
		"Flat even scan of off-white risograph paper: subtle fibres, faint halftone dot texture and grain, uniform lighting edge to edge, no objects, no text, seamless",
} as const;

export type ImageName = keyof typeof IMAGES;
export const image = (name: ImageName) => asset(`images/${name}.png`);
