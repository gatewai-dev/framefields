/**
 * Characters built with `framefields/forge` render and pose through the
 * compositor like any glTF: a Mixamo-named humanoid (drawn as its bone
 * gizmo) answers `pose`, `aim` and `retargetPose` with the `mixamo` preset.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boneGizmo, GltfDocument, humanoidSkeleton } from "./forge/index.js";
import {
	Composition,
	Layer,
	type LayoutNode,
	type PoseSource,
	retargetPose,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 400;
const C = SIZE / 2;
const FEET = C + 150;

let dir = "";
let file = "";

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-forge-"));
	file = path.join(dir, "humanoid.glb");
	const skeleton = humanoidSkeleton({ height: 300 });
	const doc = new GltfDocument();
	const rig = doc.addSkeleton(skeleton);
	const white = doc.addMaterial({ color: "#ffffff", unlit: true });
	const bones = doc.addMesh({
		name: "Bones",
		primitives: [{ ...boneGizmo(skeleton, { width: 0.25 }), material: white }],
	});
	doc.addNode({ name: "Gizmo", mesh: bones, skin: rig.skin });
	await fs.writeFile(file, doc.toGlb());
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

async function render(options: Record<string, unknown>) {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: 30,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
	comp.add([
		Layer.camera({
			x: C,
			y: C,
			z: -C / Math.tan((25 * Math.PI) / 180),
			targetX: C,
			targetY: C,
			targetZ: 0,
		}),
		Layer.glb(file, {
			x: C,
			y: FEET,
			z: 0,
			rotateX: 180,
			...options,
		}) as LayoutNode,
	]);
	const { pixels } = await decodePngPixels(
		await comp.renderFrame({ frame: 0 }),
	);
	/** Lit pixels in a screen box. */
	return (x0: number, y0: number, x1: number, y1: number) => {
		let n = 0;
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++)
				if ((pixels[(y * SIZE + x) * 4] ?? 0) > 128) n++;
		return n;
	};
}

// The character's left arm hangs to screen right (it faces the camera).
// At rest the hand sits below the shoulder; raised, above it.
const above = [C + 60, 15, C + 130, 95] as const;
const below = [C + 60, 125, C + 130, 205] as const;

describe("forge characters", () => {
	it("stands in its A-pose rest", async () => {
		const lit = await render({});
		expect(lit(...below)).toBeGreaterThan(80);
		expect(lit(...above)).toBe(0);
		// Both arms: the right hangs to screen left.
		expect(lit(C - 130, 125, C - 60, 205)).toBeGreaterThan(80);
	});

	it("raises the arm by joint pose", async () => {
		const lit = await render({ pose: { LeftArm: { rotateZ: 90 } } });
		expect(lit(...above)).toBeGreaterThan(80);
		expect(lit(...below)).toBe(0);
	});

	it("follows a retargeted performer through the mixamo preset", async () => {
		// A performer (scene coordinates, y down) with the left arm straight up-and-out.
		const at: Record<string, [number, number]> = {
			leftShoulder: [C + 30, 110],
			leftElbow: [C + 70, 70],
			leftWrist: [C + 110, 30],
		};
		const source: PoseSource = {
			point: (name) => {
				const p = at[name];
				return p
					? { x: p[0], y: p[1], visibility: 1 }
					: { x: 0, y: 0, visibility: 0 };
			},
		};
		const lit = await render({
			aim: retargetPose(source, {
				rig: "mixamo",
				bones: ["leftUpperArm", "leftLowerArm"],
			}),
		});
		expect(lit(...above)).toBeGreaterThan(80);
		expect(lit(...below)).toBe(0);
	});
});
