/**
 * Character animation through the compositor: clip layers, IK, look-at,
 * spring bones and skinned crowds, on a GLB built here: a 20-wide strip
 * skinned to a three-joint chain (root at 0, knee 80 up, foot 160 up,
 * the strip reaching 200), with a "fold" clip (knee +90° about z over 1 s)
 * and a "curl" clip (knee -90°).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	Composition,
	CompositorProgramSchema,
	Layer,
	Layer3D,
	type LayoutNode,
} from "./index.js";
import { GlbBuilder } from "./test-utils/glb.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 400;
const C = SIZE / 2;

let dir = "";
let file = "";

function quarter(sign: number): Float32Array {
	const s = Math.SQRT1_2;
	return new Float32Array([0, 0, 0, 1, 0, 0, sign * s, s]);
}

function buildRig(): Buffer {
	const g = new GlbBuilder();
	const ys = [0, 40, 80, 120, 160, 200];
	const joint = [0, 0, 1, 1, 2, 2];
	const positions: number[] = [];
	const joints: number[] = [];
	const weights: number[] = [];
	ys.forEach((y, k) => {
		for (const x of [-10, 10]) {
			positions.push(x, y, 0);
			joints.push(joint[k]!, 0, 0, 0);
			weights.push(1, 0, 0, 0);
		}
	});
	const indices: number[] = [];
	for (let k = 0; k + 1 < ys.length; k++) {
		const a = k * 2;
		indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
	}
	const ibm = [0, -80, -160].flatMap((ty) => [
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		ty,
		0,
		1,
	]);
	const times = g.accessor(new Float32Array([0, 1]), "SCALAR");
	const clip = (name: string, sign: number) => ({
		name,
		channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
		samplers: [{ input: times, output: g.accessor(quarter(sign), "VEC4") }],
	});
	return g.build({
		scenes: [{ nodes: [0, 1] }],
		nodes: [
			{ mesh: 0, skin: 0 },
			{ name: "root", children: [2] },
			{ name: "knee", translation: [0, 80, 0], children: [3] },
			{ name: "foot", translation: [0, 80, 0] },
		],
		skins: [
			{
				joints: [1, 2, 3],
				inverseBindMatrices: g.accessor(new Float32Array(ibm), "MAT4"),
			},
		],
		meshes: [
			{
				primitives: [
					{
						attributes: {
							POSITION: g.accessor(new Float32Array(positions), "VEC3"),
							JOINTS_0: g.accessor(new Uint16Array(joints), "VEC4"),
							WEIGHTS_0: g.accessor(new Float32Array(weights), "VEC4"),
						},
						indices: g.accessor(new Uint16Array(indices), "SCALAR"),
						material: 0,
					},
				],
			},
		],
		materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
		animations: [clip("fold", 1), clip("curl", -1)],
	});
}

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-character-"));
	file = path.join(dir, "leg.glb");
	await fs.writeFile(file, buildRig());
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function scene(layers: LayoutNode[]): Composition {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: 30,
		durationFrames: 120,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: C,
			y: C,
			// A 50° field of view at this distance maps one model unit to one pixel.
			z: -C / Math.tan((25 * Math.PI) / 180),
			targetX: C,
			targetY: C,
			targetZ: 0,
		}),
		...layers,
	]);
	return comp;
}

/** The leg, its root at the frame's center; model +y is up on screen. */
const leg = (extra: Record<string, unknown> = {}) =>
	Layer.glb(file, {
		id: "leg",
		x: C,
		y: C,
		z: 0,
		rotateX: 180,
		material: "unlit",
		...extra,
	});

/** Whether model point (x, y) is drawn (white), for a model rooted at screen (ox, oy). */
async function probe(comp: Composition, frame = 0) {
	const { pixels } = await decodePngPixels(await comp.renderFrame({ frame }));
	return (x: number, y: number, ox = C, oy = C) => {
		const i = (Math.round(oy - y) * SIZE + Math.round(ox + x)) * 4;
		return (pixels[i] ?? 0) > 128;
	};
}

describe("character animation", () => {
	it("blends clip layers by weight, over the pose beneath", async () => {
		const at = (weight: number) =>
			probe(
				scene([
					leg({
						animationLayers: [
							{ clip: "fold", timeOffset: 1, loop: false },
							{ clip: "curl", timeOffset: 1, loop: false, weight },
						],
					}),
				]),
			);
		// Folded +90°: the shin points -x. Blended halfway back toward -90°… the
		// two cancel at weight 0.5 by slerp: straight up again.
		const folded = await at(0);
		expect(folded(-60, 80)).toBe(true);
		expect(folded(0, 140)).toBe(false);
		const straight = await at(0.5);
		expect(straight(0, 140)).toBe(true);
		const curled = await at(1);
		expect(curled(60, 80)).toBe(true);
	});

	it("reaches an IK target with the foot, the knee toward the pole", async () => {
		// Target model (100, 60): scene (C + 100, C - 60).
		const lit = await probe(
			scene([
				leg({
					ik: [
						{
							chain: ["root", "knee", "foot"],
							target: [C + 100, C - 60, 0],
							poleTarget: [C + 200, C - 200, 0],
						},
					],
				}),
			]),
		);
		expect(lit(100, 60)).toBe(true);
		expect(lit(0, 140)).toBe(false);
		// The knee, 80 from both root and target, sits on the pole's side of
		// the root→target line: (50, 30) + 54.8 · (-0.514, 0.857).
		const knee: [number, number] = [22, 77];
		expect(lit(...knee)).toBe(true);
	});

	it("turns a joint toward a look-at target within its limit", async () => {
		const look = (max: number) =>
			probe(
				scene([
					leg({
						lookAt: [
							{
								joint: "root",
								target: [C + 300, C, 0],
								axis: [0, 1, 0],
								maxAngleDeg: max,
							},
						],
					}),
				]),
			);
		const full = await look(180);
		expect(full(150, 0)).toBe(true);
		expect(full(0, 150)).toBe(false);
		const limited = await look(45);
		expect(limited(150 * Math.SQRT1_2, 150 * Math.SQRT1_2)).toBe(true);
	});

	it("simulates spring bones deterministically from frame 0", async () => {
		const comp = scene([
			leg({
				// The foot's chain swings under sideways gravity; the knee clip is still.
				springBones: [
					{
						joints: ["knee"],
						stiffness: 0,
						damping: 0.9,
						gravity: [600, 0, 0],
					},
				],
			}),
		]);
		const first = await probe(comp, 0);
		expect(first(0, 140)).toBe(true);
		const later = await probe(comp, 40);
		expect(later(0, 150)).toBe(false);
		// Rendering an earlier frame, then frame 40 again, gives the same picture.
		await comp.renderFrame({ frame: 10 });
		const again = await comp.renderFrame({ frame: 40 });
		expect(again).toEqual(await comp.renderFrame({ frame: 40 }));
		const { pixels: a } = await decodePngPixels(again);
		const fresh = scene([
			leg({
				springBones: [
					{
						joints: ["knee"],
						stiffness: 0,
						damping: 0.9,
						gravity: [600, 0, 0],
					},
				],
			}),
		]);
		const { pixels: b } = await decodePngPixels(
			await fresh.renderFrame({ frame: 40 }),
		);
		expect(a).toEqual(b);
	});

	it("draws a skinned crowd, each instance at its own point in its clip", async () => {
		// The mesh node's own rotateX (the leg is y-up) applies under each instance's.
		const crowd = Layer3D.instances({
			mesh: leg(),
			x: C,
			y: C,
			z: 0,
			material: "unlit",
			crowd: { clips: ["fold", "curl"], phase: "sync" },
			transforms: [
				{ x: -120, y: 0, z: 0, clip: 0, animOffset: 0 },
				{ x: 0, y: 0, z: 0, clip: 0, animOffset: 0.5 },
				{ x: 120, y: 0, z: 0, clip: 1, animOffset: 0.98 },
			],
		});
		const lit = await probe(scene([crowd]));
		// Straight, folded 45° left, curled ~90° right.
		expect(lit(0, 140, C - 120)).toBe(true);
		expect(lit(-40, 120, C)).toBe(true);
		expect(lit(0, 150, C)).toBe(false);
		expect(lit(60, 80, C + 120)).toBe(true);
		expect(lit(0, 150, C + 120)).toBe(false);
	});

	it("keeps character options schema-valid", () => {
		const comp = scene([
			leg({
				animationLayers: [
					{
						clip: "fold",
						weight: [
							[0, 0],
							[30, 1],
						],
						mask: ["knee"],
					},
				],
				ik: [{ chain: ["root", "knee", "foot"], target: [[0, 1, 2, 3]] }],
				lookAt: [{ joint: "root", target: [0, 0, 0], maxAngleDeg: 30 }],
				springBones: [{ joints: ["knee"], gravity: [0, 980, 0] }],
			}),
			Layer3D.instances({
				mesh: leg(),
				count: 2,
				crowd: { clips: ["fold"], fps: 24 },
			}),
		]);
		expect(CompositorProgramSchema.safeParse(comp.toSpec()).success).toBe(true);
		const bad = scene([leg({ springBones: [{ joints: [] }] })]);
		expect(CompositorProgramSchema.safeParse(bad.toSpec()).success).toBe(false);
	});
});
