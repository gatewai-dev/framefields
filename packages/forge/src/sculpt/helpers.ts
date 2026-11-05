/**
 * Shortcuts for sculpting on a skeleton: a limb from a joint to its child,
 * and the right side from the left.
 */
import type { Skeleton, Vec3 } from "../skeleton.js";
import type { Part } from "./field.js";

type PartExtras = Omit<Part, keyof ShapeKeys | "shape">;
type ShapeKeys = {
	from: 0;
	to: 0;
	radii: 0;
	radius: 0;
	points: 0;
	size: 0;
	height: 0;
	tube: 0;
	profile: 0;
};

export interface LimbOptions extends PartExtras {
	/** Radius at the joint and at its child (or `to`). */
	radii: [number, number];
	/** End at this joint instead of the first child. */
	to?: string;
	/** Push the ends past the joints by this fraction of the bone (overlap into the next part). Default [0, 0]. */
	extend?: [number, number];
}

/**
 * A round cone along a bone, from `joint` to its first child (or `to`),
 * moved by that joint: `limb(skeleton, "LeftForeArm", { radii: [4.2, 3.2], blend: 3 })`.
 */
export function limb(
	skeleton: Skeleton,
	joint: string,
	options: LimbOptions,
): Part {
	const j = skeleton.joint(joint);
	const end = options.to
		? skeleton.joint(options.to)
		: skeleton.children(joint)[0];
	if (!end) throw new Error(`limb: joint "${joint}" has no child; give \`to\``);
	const { radii, to: _to, extend, ...rest } = options;
	const d: Vec3 = [
		end.at[0] - j.at[0],
		end.at[1] - j.at[1],
		end.at[2] - j.at[2],
	];
	const [e0, e1] = extend ?? [0, 0];
	return {
		...rest,
		shape: "roundCone",
		from: [j.at[0] - d[0] * e0, j.at[1] - d[1] * e0, j.at[2] - d[2] * e0],
		to: [end.at[0] + d[0] * e1, end.at[1] + d[1] * e1, end.at[2] + d[2] * e1],
		radii,
		joint: rest.joint ?? joint,
		name: rest.name ?? joint,
	};
}

export interface MirrorPartsOptions {
	/** Name fragment swapped in joint and part names. Default "Left". */
	from?: string;
	/** Default "Right". */
	to?: string;
}

const flip = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];

/** The part with its segment endpoints reflected; other shapes are symmetric about their frame. */
function mirrorGeometry(p: Part): Part {
	switch (p.shape) {
		case "capsule":
		case "roundCone":
			return { ...p, from: flip(p.from), to: flip(p.to) };
		case "tube":
			return { ...p, points: p.points.map(flip) };
		default:
			return { ...p };
	}
}

/**
 * The parts reflected across x (the character's left ↔ right), with "Left"
 * and "Right" swapped in their joint names. Returns the originals followed
 * by the copies, so `parts: [...torso, ...mirrorParts(leftArm)]` builds both arms.
 */
export function mirrorParts(
	parts: Part[],
	options: MirrorPartsOptions = {},
): Part[] {
	const from = options.from ?? "Left";
	const to = options.to ?? "Right";
	const rename = (n: string) => n.split(from).join(to);
	const copies = parts.map((p): Part => {
		const out: Part = {
			...mirrorGeometry(p),
			...(p.at ? { at: flip(p.at) } : {}),
			// Reflecting x negates the turns about y and z.
			...(p.rotation
				? { rotation: [p.rotation[0], -p.rotation[1], -p.rotation[2]] as Vec3 }
				: {}),
			...(p.bend ? { bend: -p.bend } : {}),
			...(p.twist ? { twist: -p.twist } : {}),
		};
		if (p.joint !== undefined)
			out.joint =
				typeof p.joint === "string" ? rename(p.joint) : p.joint.map(rename);
		if (p.name) out.name = rename(p.name);
		return out;
	});
	return [...parts, ...copies];
}
