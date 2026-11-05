/**
 * Facial blend shapes under ARKit's names, built from MakeHuman's CC0
 * expression units (one set per ethnic base, blended like the body). Units
 * made for one side map directly; symmetric mouth units are split into a
 * left and a right half with a soft seam across the midline, so each side
 * of a smile or a frown moves on its own. A face animated with ARKit names
 * (capture apps, other rigs) drives these unchanged.
 */

/** One ARKit-named shape: MakeHuman units (path under `expression/units/<ethnicity>/`) and the half it keeps. */
interface ShapeSource {
	units: string[];
	/** Keep the character's left (+x) or right (−x) half of a symmetric unit. */
	half?: "left" | "right";
}

const sided = (name: string, unit: (side: "left" | "right") => string) => ({
	[`${name}Left`]: { units: [unit("left")] },
	[`${name}Right`]: { units: [unit("right")] },
});
const split = (name: string, unit: string) => ({
	[`${name}Left`]: { units: [unit], half: "left" as const },
	[`${name}Right`]: { units: [unit], half: "right" as const },
});

/** The shapes `human()` builds, by ARKit name (plus a few MakeHuman extras with descriptive names). */
export const FACE_SHAPES: Readonly<Record<string, ShapeSource>> = {
	...sided("eyeBlink", (s) => `eye-${s}-closure`),
	...sided("eyeWide", (s) => `eye-${s}-opened-up`),
	...sided("eyeSquint", (s) => `eye-${s}-slit`),
	...sided("browDown", (s) => `eyebrows-${s}-down`),
	...sided("browOuterUp", (s) => `eyebrows-${s}-extern-up`),
	browInnerUp: { units: ["eyebrows-left-inner-up", "eyebrows-right-inner-up"] },
	...sided("noseSneer", (s) => `nose-${s}-elevation`),
	jawOpen: { units: ["mouth-open"] },
	mouthPucker: { units: ["mouth-pursing"] },
	mouthFunnel: { units: ["mouth-protusion"] },
	mouthRollLower: { units: ["mouth-eversion"] },
	...split("mouthSmile", "mouth-corner-puller"),
	...split("mouthFrown", "mouth-depression"),
	...split("mouthPress", "mouth-compression"),
	...split("mouthStretch", "mouth-retraction"),
	...split("mouthUpperUp", "mouth-elevation"),
	...split("mouthLowerDown", "mouth-depression-retraction"),
	...split("mouthDimple", "mouth-upward-retraction"),
	// Not in ARKit's set.
	...sided("noseFlare", (s) => `nose-${s}-dilatation`),
	noseWrinkle: { units: ["nose-compression"] },
	mouthPart: { units: ["mouth-parling"] },
	neckTense: { units: ["neck-platysma"] },
};

/** Weight of the kept half at x (base mesh units, decimeters): a seam 2 cm wide across the midline. */
export function halfWeight(
	half: "left" | "right" | undefined,
	x: number,
): number {
	if (!half) return 1;
	const w = 0.1;
	const t = Math.min(1, Math.max(0, (x + w) / (2 * w)));
	const s = t * t * (3 - 2 * t);
	return half === "left" ? s : 1 - s;
}

export const ETHNIC_UNITS = ["african", "asian", "caucasian"] as const;
