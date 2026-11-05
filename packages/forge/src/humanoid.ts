/**
 * A proportioned human skeleton on Mixamo joint names, so clips, `pose`,
 * `aim` and pose retargeting (`rig: "mixamo"`) drive it unchanged.
 * Proportions are classical figure-drawing ratios measured in head
 * heights; stylized characters change `heads` (8 is heroic, 6 is stocky)
 * and the width multipliers.
 */
import { Skeleton, type Vec3 } from "./skeleton.js";

export interface HumanoidOptions {
	/** Standing height, top of the head to the soles, model units. Default 180. */
	height?: number;
	/** Height in head heights: 7.5 natural, 8 heroic, 6 stocky. Default 7.5. */
	heads?: number;
	/** Multiplies the shoulder width. Default 1. */
	shoulderWidth?: number;
	/** Multiplies the hip width. Default 1. */
	hipWidth?: number;
	/** Arms' angle below horizontal at rest: 0 is a T-pose. Default 45 (an A-pose, which skins better). */
	armAngle?: number;
	/** Thumb and four fingers, three bones each. Default true. */
	fingers?: boolean;
	/** Toe joints. Default true. */
	toes?: boolean;
	/** Joint name prefix, e.g. "mixamorig:". Default none. */
	prefix?: string;
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [
	a[0] + b[0] * s,
	a[1] + b[1] * s,
	a[2] + b[2] * s,
];
const unit = (v: Vec3): Vec3 => {
	const l = Math.hypot(v[0], v[1], v[2]);
	return [v[0] / l, v[1] / l, v[2] / l];
};

/** Bone lengths of each finger as fractions of the hand, and its spread across the palm (fraction of height, +z is the thumb side). */
const FINGERS = [
	{ name: "Index", spread: 0.012, lengths: [0.21, 0.13, 0.1] },
	{ name: "Middle", spread: 0.004, lengths: [0.23, 0.15, 0.11] },
	{ name: "Ring", spread: -0.004, lengths: [0.21, 0.14, 0.1] },
	{ name: "Pinky", spread: -0.012, lengths: [0.17, 0.11, 0.09] },
] as const;

/**
 * A humanoid skeleton standing on y = 0, facing +z, its left at +x. Joint
 * names follow Mixamo: Hips, Spine, Spine1, Spine2, Neck, Head,
 * HeadTop_End; Left/Right Shoulder, Arm, ForeArm, Hand, HandThumb1–4,
 * HandIndex1–4 …; UpLeg, Leg, Foot, ToeBase, Toe_End.
 */
export function humanoidSkeleton(options: HumanoidOptions = {}): Skeleton {
	const H = options.height ?? 180;
	const heads = options.heads ?? 7.5;
	const sw = options.shoulderWidth ?? 1;
	const hw = options.hipWidth ?? 1;
	const p = options.prefix ?? "";
	const n = (name: string) => `${p}${name}`;
	const head = H / heads;
	const k = (f: number) => f * H;

	const s = new Skeleton();
	s.add(n("Hips"), { at: [0, k(0.53), 0] });
	s.add(n("Spine"), { at: [0, k(0.585), -k(0.004)], parent: n("Hips") });
	s.add(n("Spine1"), { at: [0, k(0.645), -k(0.008)], parent: n("Spine") });
	s.add(n("Spine2"), { at: [0, k(0.715), -k(0.008)], parent: n("Spine1") });
	s.add(n("Neck"), {
		at: [0, H - 1.25 * head, -k(0.006)],
		parent: n("Spine2"),
	});
	s.add(n("Head"), { at: [0, H - 0.78 * head, k(0.004)], parent: n("Neck") });
	s.add(n("HeadTop_End"), { at: [0, H, k(0.004)], parent: n("Head") });

	// Arms hang from the shoulder line, about 1.45 heads below the crown.
	const shoulderY = H - 1.45 * head;
	const angle = ((options.armAngle ?? 45) * Math.PI) / 180;
	const down: Vec3 = [Math.cos(angle), -Math.sin(angle), 0];
	const arm: Vec3 = [k(0.105) * sw, shoulderY, -k(0.006)];
	const elbow = add(arm, down, k(0.186));
	const wrist = add(elbow, down, k(0.146));
	const hand = k(0.108);
	s.add(n("LeftShoulder"), {
		at: [k(0.022) * sw, shoulderY + k(0.012), -k(0.006)],
		parent: n("Spine2"),
	});
	s.add(n("LeftArm"), { at: arm, parent: n("LeftShoulder") });
	s.add(n("LeftForeArm"), { at: elbow, parent: n("LeftArm") });
	s.add(n("LeftHand"), { at: wrist, parent: n("LeftForeArm") });

	if (options.fingers ?? true) {
		const knuckles = add(wrist, down, 0.45 * hand);
		for (const f of FINGERS) {
			let at = add(knuckles, [0, 0, 1], k(f.spread));
			const points: Vec3[] = [at];
			for (const len of f.lengths) {
				at = add(at, down, len * hand);
				points.push(at);
			}
			s.chain(n(`LeftHand${f.name}`), points, { parent: n("LeftHand") });
		}
		// The thumb leaves the palm forward and down, across the index.
		const thumbDir = unit(add(add(down, [0, 0, 1], 0.9), [0, -1, 0], 0.25));
		let at = add(add(wrist, down, 0.12 * hand), [0, 0, 1], k(0.012));
		const thumb: Vec3[] = [at];
		for (const len of [0.2, 0.17, 0.13]) {
			at = add(at, thumbDir, len * hand);
			thumb.push(at);
		}
		s.chain(n("LeftHandThumb"), thumb, { parent: n("LeftHand") });
	}

	// Hip joints sit about 9 cm from the midline on a 180 cm figure; knees
	// come in under them and the feet stand about hip-width apart.
	const hipX = k(0.051) * hw;
	s.add(n("LeftUpLeg"), { at: [hipX, k(0.5), 0], parent: n("Hips") });
	s.add(n("LeftLeg"), {
		at: [hipX * 0.92, k(0.282), k(0.008)],
		parent: n("LeftUpLeg"),
	});
	s.add(n("LeftFoot"), {
		at: [hipX * 0.98, k(0.045), -k(0.01)],
		parent: n("LeftLeg"),
	});
	if (options.toes ?? true) {
		s.add(n("LeftToeBase"), {
			at: [hipX * 1.08, k(0.012), k(0.095)],
			parent: n("LeftFoot"),
		});
		s.add(n("LeftToe_End"), {
			at: [hipX * 1.12, k(0.012), k(0.145)],
			parent: n("LeftToeBase"),
		});
	}
	return s.mirror({ from: "Left", to: "Right" });
}
