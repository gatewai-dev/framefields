/**
 * Preview scenes for the library's code items: templates, shaders and VFX
 * (component folders whose meta has that `kind`). Plain components are not
 * in the library; agents find them with `framefields list`. Each scene draws
 * its item the way the registry installs it, on a 1280×720 canvas; `poster`
 * is the frame the still shows, and the hover clip plays frames 0 to
 * `frames`. An item without a scene lists without pictures.
 */
import type { Composition } from "framefields";

export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 720;

type Node = Parameters<Composition["add"]>[0];

export interface Shot {
	/** The frame the poster shows: something settled. */
	poster: number;
	/** Length of the hover clip, in frames at 30 fps. */
	frames: number;
	build(): Node;
}

/** By registry name. */
export const SHOTS: Record<string, Shot> = {};
