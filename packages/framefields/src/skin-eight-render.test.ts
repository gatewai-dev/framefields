/**
 * Skins with eight influences per vertex (glTF JOINTS_1 / WEIGHTS_1): a
 * quad whose vertices give 60% of their weight to a joint that appears only
 * in the second set follows that joint. Before the second set was read, the
 * quad ignored it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GltfDocument, Skeleton } from "@framefields/gltf-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Composition, Layer, type LayoutNode } from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 320;
const C = SIZE / 2;

let dir = "";
let file = "";

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-skin8-"));
	file = path.join(dir, "quad.glb");
	const skeleton = new Skeleton().add("Root", { at: [0, 0, 0] });
	for (const n of ["A", "B", "C", "D", "Mover"])
		skeleton.add(n, { at: [0, 0, 0], parent: "Root" });
	const doc = new GltfDocument();
	const rig = doc.addSkeleton(skeleton);
	const white = doc.addMaterial({ color: "#ffffff", unlit: true });
	const h = 40;
	// Per vertex: 10% each on Root, A, B, C (set 0), 60% on Mover (set 1).
	const joints = new Array(4).fill([0, 1, 2, 3, 5, 0, 0, 0]).flat();
	const weights = new Array(4).fill([0.1, 0.1, 0.1, 0.1, 0.6, 0, 0, 0]).flat();
	doc.addNode({
		mesh: doc.addMesh({
			primitives: [
				{
					positions: [-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0],
					normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
					indices: [0, 1, 2, 0, 2, 3],
					joints,
					weights,
					material: white,
				},
			],
		}),
		skin: rig.skin,
	});
	await fs.writeFile(file, doc.toGlb());
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

/** The x center of the lit pixels. */
async function centerX(options: Record<string, unknown>) {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps: 30,
		durationFrames: 1,
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
			y: C,
			z: 0,
			rotateX: 180,
			...options,
		}) as LayoutNode,
	]);
	const { pixels } = await decodePngPixels(
		await comp.renderFrame({ frame: 0 }),
	);
	let sum = 0;
	let n = 0;
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++)
			if ((pixels[(y * SIZE + x) * 4] ?? 0) > 128) {
				sum += x;
				n++;
			}
	return sum / n;
}

describe("eight skin influences", () => {
	it("moves a vertex by its second influence set", async () => {
		const still = await centerX({});
		const moved = await centerX({ pose: { Mover: { x: 50 } } });
		expect(Math.abs(still - C)).toBeLessThan(2);
		// 60% of a 50-unit move.
		expect(moved - still).toBeGreaterThan(24);
		expect(moved - still).toBeLessThan(36);
	});
});
