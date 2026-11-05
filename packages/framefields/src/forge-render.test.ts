/**
 * Characters built with `framefields/forge` render and pose through the
 * compositor like any glTF: a Mixamo-named humanoid (drawn as its bone
 * gizmo) answers `pose`, `aim` and `retargetPose` with the `mixamo` preset.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	boneGizmo,
	GltfDocument,
	humanoidSkeleton,
	limb,
	Skeleton,
	sculpt,
} from "./forge/index.js";
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
let arm = "";

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

	// A sculpted arm standing up from y = 0: elbow at 120, wrist at 220.
	const armRig = new Skeleton()
		.add("Arm", { at: [0, 0, 0] })
		.add("ForeArm", { at: [0, 120, 0], parent: "Arm" })
		.add("Hand", { at: [0, 220, 0], parent: "ForeArm" });
	const armDoc = new GltfDocument();
	const armSkin = armDoc.addSkeleton(armRig);
	const flat = armDoc.addMaterial({ color: "#ffffff", unlit: true });
	const body = sculpt({
		skeleton: armRig,
		parts: [
			limb(armRig, "Arm", { radii: [22, 17], material: flat }),
			limb(armRig, "ForeArm", { radii: [17, 13], blend: 14, material: flat }),
		],
		cell: 2,
		triangles: 6000,
	});
	armDoc.addNode({
		mesh: armDoc.addMesh({ primitives: body.primitives }),
		skin: armSkin.skin,
	});
	arm = path.join(dir, "arm.glb");
	await fs.writeFile(arm, armDoc.toGlb());
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

async function render(options: Record<string, unknown>, model = file) {
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
		Layer.glb(model, {
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

	it("bends a sculpted, auto-skinned elbow without a gap", async () => {
		// Feet of the arm at FEET; the elbow 120 px up the screen.
		const straight = await render({}, arm);
		const bent = await render({ pose: { ForeArm: { rotateZ: 90 } } }, arm);
		const elbowY = FEET - 120;
		// Straight: the forearm stands above the elbow.
		expect(straight(C - 5, elbowY - 90, C + 5, elbowY - 60)).toBeGreaterThan(
			200,
		);
		// Bent: the forearm points to the screen left of the elbow instead…
		expect(bent(C - 5, elbowY - 90, C + 5, elbowY - 60)).toBe(0);
		expect(bent(C - 90, elbowY - 5, C - 60, elbowY + 5)).toBeGreaterThan(200);
		// …and the elbow's inside corner stays filled: no crack between the bones.
		expect(bent(C - 22, elbowY - 4, C + 4, elbowY + 4)).toBe(26 * 8);
	});
});
