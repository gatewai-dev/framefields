import { describe, expect, it } from "vitest";
import type { Vec3 } from "../math3d/index.js";
import { sampleLocalPose } from "./pose.js";
import {
	applyConstraints,
	applyDriver,
	applyJointPose,
	blendClipLayers,
	RigPose,
	SpringBones,
	solveLookAt,
	solveTwoBoneIk,
} from "./rig.js";
import type { AnimationClip3D, Model3DData, ModelNode3D } from "./types.js";

const node = (name: string, parent: number, t: Vec3): ModelNode3D => ({
	name,
	parent,
	translation: t,
	rotation: [0, 0, 0, 1],
	scale: [1, 1, 1],
});

/** A straight leg down +y: hip at the origin, knee 100 below, foot 100 below that; a 3-joint tail. */
const NODES: ModelNode3D[] = [
	node("hip", -1, [0, 0, 0]),
	node("knee", 0, [0, 100, 0]),
	node("foot", 1, [0, 100, 0]),
	node("tail0", -1, [50, 0, 0]),
	node("tail1", 3, [40, 0, 0]),
	node("tail2", 4, [40, 0, 0]),
];

/** Turns the hip a quarter turn about z over one second. */
const SWING: AnimationClip3D = {
	name: "swing",
	duration: 1,
	fps: 30,
	tracks: [
		{
			nodeName: "hip",
			node: 0,
			times: new Float32Array([0, 1]),
			rotations: new Float32Array([
				0,
				0,
				0,
				1,
				0,
				0,
				Math.SQRT1_2,
				Math.SQRT1_2,
			]),
		},
		{
			nodeName: "tail0",
			node: 3,
			times: new Float32Array([0, 1]),
			translations: new Float32Array([50, 0, 0, 50, -200, 0]),
		},
	],
} as unknown as AnimationClip3D;

const MODEL = {
	meshes: [],
	materials: {},
	animations: [SWING],
	nodes: NODES,
} as unknown as Model3DData;

const rest = () => new RigPose(NODES, sampleLocalPose(NODES, undefined, 0));
const dist = (a: Vec3, b: Vec3) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("rig", () => {
	it("blends clip layers by weight and mask", () => {
		const full = blendClipLayers(MODEL, [{ clip: SWING, time: 1, weight: 1 }]);
		// A quarter turn about z sends the foot from +y to -x.
		const foot = full.position(2);
		expect(foot[0]).toBeCloseTo(-200, 3);
		expect(foot[1]).toBeCloseTo(0, 3);
		const half = blendClipLayers(MODEL, [
			{ clip: SWING, time: 1, weight: 0.5 },
		]);
		// Half the rotation: 45°.
		expect(half.position(2)[0]).toBeCloseTo(-200 * Math.SQRT1_2, 3);
		const masked = blendClipLayers(MODEL, [
			{ clip: SWING, time: 1, weight: 1, mask: ["tail0"] },
		]);
		expect(masked.position(2)).toEqual([0, 200, 0]);
		expect(masked.position(3)[1]).toBeCloseTo(-200, 3);
	});

	it("reaches an IK target and bends toward the pole", () => {
		for (const target of [
			[60, 120, 0],
			[-80, 90, 40],
			[0, 150, -60],
		] as Vec3[]) {
			for (const pole of [
				[0, 100, 200],
				[200, 100, 0],
			] as Vec3[]) {
				const rig = rest();
				solveTwoBoneIk(rig, {
					chain: ["hip", "knee", "foot"],
					target,
					pole,
					weight: 1,
				});
				expect(dist(rig.position(2), target)).toBeLessThan(0.01);
				// Bone lengths hold.
				expect(dist(rig.position(0), rig.position(1))).toBeCloseTo(100, 4);
				expect(dist(rig.position(1), rig.position(2))).toBeCloseTo(100, 4);
				// The knee sits on the pole's side of the hip→foot line.
				const knee = rig.position(1);
				const axis = target.map((v) => v / Math.hypot(...target)) as Vec3;
				const off = (p: Vec3) => {
					const d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
					return p.map((v, i) => v - d * axis[i]!) as Vec3;
				};
				const k = off(knee);
				const p = off(pole);
				expect(k[0] * p[0] + k[1] * p[1] + k[2] * p[2]).toBeGreaterThan(0);
			}
		}
		// Out of reach: the leg straightens toward it.
		const far = rest();
		solveTwoBoneIk(far, {
			chain: ["hip", "knee", "foot"],
			target: [400, 0, 0],
			weight: 1,
		});
		expect(far.position(2)[0]).toBeGreaterThan(199);
		// Half weight lands between.
		const half = rest();
		solveTwoBoneIk(half, {
			chain: ["hip", "knee", "foot"],
			target: [60, 120, 0],
			weight: 0.5,
		});
		expect(dist(half.position(2), [60, 120, 0])).toBeGreaterThan(5);
		expect(dist(half.position(2), [0, 200, 0])).toBeGreaterThan(5);
	});

	it("drives a joint by a share of another joint's turn", () => {
		const rig = rest();
		// The hip turns 90° about z; tail0 (not its child) follows by half.
		applyJointPose(rig, {
			joint: "hip",
			rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
			offset: [0, 0, 0],
			weight: 1,
			mode: "additive",
		});
		applyDriver(rig, { joint: "tail0", from: "hip", rotate: { z: 0.5 } });
		// tail1 sits 40 along tail0's x: after 45° about z it is at 45°.
		const p = rig.position(4);
		const a = (Math.atan2(p[1], p[0] - 50) * 180) / Math.PI;
		expect(a).toBeCloseTo(45, 3);
		// Unnamed joints and zero shares change nothing.
		const still = rest();
		applyDriver(still, { joint: "nope", from: "hip", rotate: { z: 1 } });
		applyDriver(still, { joint: "tail0", from: "hip", rotate: { z: 1 } });
		expect(still.position(4)).toEqual(rest().position(4));
	});

	it("turns a joint toward a target within its limit", () => {
		const rig = rest();
		solveLookAt(rig, {
			joint: "hip",
			target: [100, 0, 0],
			weight: 1,
			maxAngleDeg: 180,
			axis: [0, 1, 0],
		});
		expect(rig.position(2)[0]).toBeCloseTo(200, 3);
		const limited = rest();
		solveLookAt(limited, {
			joint: "hip",
			target: [100, 0, 0],
			weight: 1,
			maxAngleDeg: 30,
			axis: [0, 1, 0],
		});
		const f = limited.position(2);
		expect((Math.atan2(f[0], f[1]) * 180) / Math.PI).toBeCloseTo(30, 3);
		const both = rest();
		applyConstraints(both, {
			lookAt: [
				{
					joint: "tail0",
					target: [50, 100, 0],
					weight: 1,
					maxAngleDeg: 90,
					axis: [1, 0, 0],
				},
			],
			ik: [{ chain: ["hip", "knee", "foot"], target: [50, 150, 0], weight: 1 }],
		});
		expect(dist(both.position(2), [50, 150, 0])).toBeLessThan(0.01);
		expect(both.position(5)[1]).toBeCloseTo(80, 3);
	});

	it("simulates spring bones deterministically, lagging then settling", () => {
		const run = (frames: number) => {
			const springs = new SpringBones(rest(), [
				{ joints: ["tail0"], stiffness: 4, damping: 0.5, gravity: [0, 0, 0] },
			]);
			let rig = rest();
			for (let f = 0; f <= frames; f++) {
				rig = blendClipLayers(MODEL, [
					{ clip: SWING, time: Math.min(1, f / 30), weight: 1 },
				]);
				springs.step(rig, 1 / 30);
				springs.apply(rig);
			}
			return rig;
		};
		const mid = run(4);
		const animated = blendClipLayers(MODEL, [
			{ clip: SWING, time: 4 / 30, weight: 1 },
		]);
		// The root rides the animation; just after it starts moving (-y) the tip trails.
		expect(dist(mid.position(3), animated.position(3))).toBeLessThan(1e-6);
		expect(mid.position(5)[1]).toBeGreaterThan(animated.position(5)[1] + 3);
		// Lengths hold.
		expect(dist(mid.position(4), mid.position(5))).toBeCloseTo(40, 3);
		expect(run(4).position(5)).toEqual(mid.position(5));
		// Long after the motion stops it settles back onto the animated pose.
		const settled = run(400);
		const end = blendClipLayers(MODEL, [{ clip: SWING, time: 1, weight: 1 }]);
		expect(dist(settled.position(5), end.position(5))).toBeLessThan(0.5);
	});

	it("poses joints on the animated pose or the rest pose, by weight", () => {
		const qz = (deg: number): [number, number, number, number] => [
			0,
			0,
			Math.sin((deg * Math.PI) / 360),
			Math.cos((deg * Math.PI) / 360),
		];
		// The swing clip turns the hip 90°; an additive +90° adds to it.
		const added = blendClipLayers(MODEL, [{ clip: SWING, time: 1, weight: 1 }]);
		applyJointPose(added, {
			joint: "hip",
			rotation: qz(90),
			offset: [0, 0, 0],
			weight: 1,
			mode: "additive",
		});
		expect(added.position(2)[1]).toBeCloseTo(-200, 3);
		// From rest, the clip's turn is ignored.
		const fromRest = blendClipLayers(MODEL, [
			{ clip: SWING, time: 1, weight: 1 },
		]);
		applyJointPose(fromRest, {
			joint: "hip",
			rotation: qz(90),
			offset: [0, 0, 0],
			weight: 1,
			mode: "rest",
		});
		expect(fromRest.position(2)[0]).toBeCloseTo(-200, 3);
		// Half weight from rest: 45°; offsets move the joint.
		const half = rest();
		applyJointPose(half, {
			joint: "hip",
			rotation: qz(90),
			offset: [10, 0, 0],
			weight: 0.5,
			mode: "rest",
		});
		expect(half.position(0)[0]).toBeCloseTo(5, 6);
		expect(half.position(2)[0]).toBeCloseTo(5 - 200 * Math.SQRT1_2, 3);
	});

	it("aims bones along directions, parents first, by their own axis", () => {
		const rig = rest();
		applyConstraints(rig, {
			aim: [
				{ joint: "hip", direction: [1, 0, 0], weight: 1 },
				{ joint: "knee", direction: [0, -1, 0], weight: 1 },
			],
		});
		// Thigh points +x, shin then points -y from the knee.
		const knee = rig.position(1);
		const foot = rig.position(2);
		expect(knee[0]).toBeCloseTo(100, 3);
		expect(knee[1]).toBeCloseTo(0, 3);
		expect(foot[0]).toBeCloseTo(100, 3);
		expect(foot[1]).toBeCloseTo(-100, 3);
		// Bone lengths hold.
		expect(dist(knee, foot)).toBeCloseTo(100, 4);
	});

	it("finds joints by name without their namespace or case", () => {
		const nodes = NODES.map((n) => ({ ...n, name: `mixamorig:${n.name}` }));
		const rig = new RigPose(nodes, sampleLocalPose(nodes, undefined, 0));
		expect(rig.index("knee")).toBe(1);
		expect(rig.index("mixamorig:Foot")).toBe(2);
		expect(rig.index("Tail2")).toBe(5);
		expect(rig.index("nothing")).toBeUndefined();
	});
});
