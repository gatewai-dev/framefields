/**
 * The exporter across frames, fed synthetic passes (mesh draws need no GPU
 * work until a texture or instance buffer is read): which draws become
 * nodes, which change shape, and how the clip is timed.
 */
import { describe, expect, it } from "vitest";
import type { Mesh3DData } from "../loaders/types.js";
import type { Camera3DPose } from "../math3d/camera3d.js";
import type { Mat4 } from "../math3d/matrix4.js";
import type { Scene3DItem, Scene3DPass } from "../renderer3d/scene-capture.js";
import { Scene3DExporter } from "./scene-exporter.js";

const device = {} as GPUDevice;
const encoder = {} as GPUCommandEncoder;

function triangle(size: number): Mesh3DData {
	return {
		positions: Float32Array.of(0, 0, 0, size, 0, 0, 0, size, 0),
		normals: Float32Array.of(0, 0, -1, 0, 0, -1, 0, 0, -1),
		uvs: Float32Array.of(0, 0, 1, 0, 0, 1),
		indices: Uint16Array.of(0, 1, 2),
	};
}

const at = (x: number): Mat4 => [
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
	x,
	0,
	0,
	1,
];

const camera: Camera3DPose = {
	eye: [0, 0, -500],
	target: [0, 0, 0],
	up: [0, -1, 0],
	fov: 40,
	aspect: 1,
	near: 1,
	far: 5000,
	zoom: 1,
} as Camera3DPose;

function pass(items: Scene3DItem[]): Scene3DPass {
	return { items, camera, lights: [], width: 100, height: 100 };
}

const draw = (owner: string, mesh: Mesh3DData, x: number): Scene3DItem => ({
	kind: "mesh",
	mesh,
	opts: {},
	matrix: at(x),
	owner,
});

type Json = {
	nodes: Array<{ name?: string; mesh?: number; children?: number[] }>;
	meshes: unknown[];
	animations?: Array<{
		channels: Array<{
			sampler: number;
			target: { node: number; path: string };
		}>;
		samplers: Array<{ input: number; interpolation?: string }>;
	}>;
	accessors: Array<{ count: number; max?: number[] }>;
};

function json(glb: Uint8Array): Json {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const length = view.getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

async function record(frames: Scene3DItem[][], duration?: number) {
	const exporter = new Scene3DExporter({ lights: false });
	for (const [f, items] of frames.entries()) {
		exporter.beginFrame(f / 30);
		exporter.capture(device, encoder, pass(items));
		await exporter.endFrame();
	}
	return exporter.finish(duration);
}

describe("Scene3DExporter across frames", () => {
	it("gives a draw that changes shape one child per shape, shown in turn", async () => {
		const small = triangle(10);
		const large = triangle(20);
		// Equal to `small` but another object: matched by content, not written twice.
		const smallAgain = triangle(10);
		const result = await record([
			[draw("a", small, 0)],
			[draw("a", large, 5)],
			[draw("a", smallAgain, 10)],
		]);
		const doc = json(result.glb);
		expect(doc.meshes).toHaveLength(2);
		const names = doc.nodes.map((n) => n.name);
		expect(names).toEqual(expect.arrayContaining(["a", "a:0", "a:1"]));
		const parent = doc.nodes.find((n) => n.name === "a");
		expect(parent?.mesh).toBeUndefined();
		expect(parent?.children).toHaveLength(2);
		const clip = doc.animations?.[0];
		const visibility = clip?.channels.filter(
			(c) => clip.samplers[c.sampler].interpolation === "STEP",
		);
		expect(visibility).toHaveLength(2);
		expect(result.skipped).toEqual([]);
	});

	it("keeps a mesh reused frame to frame on its node, and says nothing is lost", async () => {
		const mesh = triangle(10);
		const result = await record([
			[draw("a", mesh, 0), draw("a", mesh, 50)],
			[draw("a", mesh, 10), draw("a", mesh, 50)],
		]);
		const doc = json(result.glb);
		// Two draws of one layer: two nodes, one shared mesh.
		expect(doc.meshes).toHaveLength(1);
		expect(doc.nodes.filter((n) => n.name === "a")).toHaveLength(2);
		// Only the first moves.
		expect(doc.animations?.[0].channels.map((c) => c.target.path)).toEqual([
			"translation",
		]);
	});

	it("lasts its duration, the last frame holding to the end", async () => {
		const mesh = triangle(10);
		const frames = [0, 1, 2, 3].map((f) => [draw("a", mesh, f * 10)]);
		const doc = json((await record(frames, 4 / 30)).glb);
		const clip = doc.animations?.[0];
		const input = clip?.samplers[clip.channels[0].sampler].input as number;
		expect(doc.accessors[input].max?.[0]).toBeCloseTo(4 / 30, 6);
	});

	it("writes a single frame as a still scene", async () => {
		const exporter = new Scene3DExporter({ lights: false });
		exporter.capture(device, encoder, pass([draw("a", triangle(10), 0)]));
		const result = await exporter.finish();
		expect(result.channels).toBe(0);
		expect(json(result.glb).animations).toBeUndefined();
	});

	it("refuses frames out of order", () => {
		const exporter = new Scene3DExporter();
		exporter.beginFrame(0.1);
		expect(() => exporter.beginFrame(0.1)).toThrow(/increase/);
	});
});
