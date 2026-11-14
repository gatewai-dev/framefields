/**
 * Randomized scenes from the scenario sampler: varied shapes, surfaces
 * (matte, plastic, metal, glass), pattern textures, lighting rigs and
 * cameras, objects either dropped (Rapier) or resting still.
 */
import { scenario } from "../sampler.js";

export const scenes = scenario({
	name: "scenes",
	description:
		"3 to 7 objects (box, sphere, cylinder, capsule, torus) with random surfaces (matte, plastic, metal, glass), pattern textures, lighting rig and camera; dropped onto the floor or resting still. `params` holds every draw.",
	motion: ["drop", "still"],
});

export const scenesMultiView = scenario({
	name: "scenes-multiview",
	description:
		"The scenes env seen from three cameras 50 degrees apart, rendered from one shared simulation.",
	motion: ["drop", "still"],
	cameras: { views: 3 },
});
