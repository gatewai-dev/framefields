/**
 * `exportModel` writes a frame's 3D scene as glTF that the Khronos
 * validator accepts, and that the engine, loading the file back, draws as
 * the frame was drawn: same shapes in the same places, same colors.
 */
/// <reference path="../../webgpu-renderers/src/gltf/gltf-validator.d.ts" />
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateBytes } from "gltf-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
} from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const W = 400;
const H = 300;

let dir = "";
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-export-"));
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function stage(layers: LayoutNode[]): Composition {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	c.add([
		Layer.camera({ x: 200, y: 140, z: -560, targetX: 200, targetY: 150 }),
		// Physically based shading, which is what glTF materials describe.
		Layer.environment("studio", { intensity: 0.6 }),
		Layer.directionalLight({
			id: "sun",
			x: -200,
			y: -500,
			z: -400,
			targetX: 200,
			targetY: 150,
			targetZ: 0,
			intensity: 1.2,
		}),
		...layers,
	]);
	return c;
}

/** Every kind of draw an export has to carry. */
function scene(): LayoutNode[] {
	return [
		Layer3D.roundedBox({
			id: "crate",
			x: 80,
			y: 140,
			z: 20,
			width: 90,
			height: 90,
			depth: 90,
			radius: 10,
			rotateY: 30,
			rotateX: 15,
			color: "#3d7bd9",
		}),
		Layer3D.clay({
			id: "bust",
			x: 210,
			y: 130,
			rotateY: -20,
			// Triangles, as the file has them, so the two pictures can agree to the pixel.
			draw: "mesh",
			resolution: 96,
			ops: [
				{ type: "sphere", radius: 55, color: "#e0b080" },
				{
					type: "capsule",
					radius: 18,
					height: 60,
					center: [0, -60, 0],
					rotation: [0, 0, 70],
					smoothness: 14,
					color: "#c04040",
				},
				{ type: "sphere", radius: 18, center: [0, 0, -50], mode: "carve" },
			],
		}),
		Layer3D.sphere({
			id: "orb",
			x: 330,
			y: 120,
			radius: 45,
			color: "#dddddd",
			metallic: 1,
			roughness: 0.3,
			emissive: "#ff6600",
			emissiveIntensity: 0.4,
		}),
		// A 2D layer in the 3D scene: a picture on a plane.
		Layer.box({
			id: "card",
			x: 250,
			y: 20,
			z: 80,
			rotateY: 25,
			width: 110,
			height: 60,
			background: "#ffcc00",
		}),
		Layer3D.instances({
			id: "pegs",
			x: 200,
			y: 240,
			mesh: Layer3D.roundedBox({
				width: 30,
				height: 30,
				depth: 30,
				radius: 4,
				color: "#ffffff",
			}),
			transforms: [
				{ x: -120, y: 0, z: 0, color: "#ff3030" },
				{
					x: 0,
					y: 0,
					z: 0,
					rotation: [0, 45, 0],
					scale: 1.3,
					color: "#30ff30",
				},
				{ x: 120, y: 0, z: 0, color: "#3030ff" },
			],
		}),
	] as LayoutNode[];
}

/** The JSON chunk of a GLB. */
function glbJson(glb: Uint8Array): Record<string, unknown> {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const length = view.getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

async function pixels(c: Composition, frame = 0): Promise<Uint8ClampedArray> {
	return (await decodePngPixels(await c.renderFrame({ frame }))).pixels;
}

/** Share of the drawn pixels two frames disagree on by more than 24 levels. */
function disagreement(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	let covered = 0;
	let differ = 0;
	for (let i = 0; i < a.length; i += 4) {
		if (a[i] + a[i + 1] + a[i + 2] > 30 || b[i] + b[i + 1] + b[i + 2] > 30)
			covered++;
		const d = Math.max(
			Math.abs(a[i] - b[i]),
			Math.abs(a[i + 1] - b[i + 1]),
			Math.abs(a[i + 2] - b[i + 2]),
		);
		if (d > 24) differ++;
	}
	expect(covered).toBeGreaterThan(2000);
	return differ / covered;
}

describe("Composition.exportModel", () => {
	it("writes a GLB the Khronos validator accepts", async () => {
		const out = path.join(dir, "scene.glb");
		const result = await stage(scene()).exportModel({ outputPath: out });
		expect(result.filePath).toBe(out);
		expect(result.skipped).toEqual([]);
		// crate, bust, orb, card and three pegs.
		expect(result.meshes).toBe(7);
		const report = await validateBytes(new Uint8Array(await fs.readFile(out)));
		const problems = report.issues.messages.filter(
			(m: { severity: number }) => m.severity <= 1,
		);
		expect(problems).toEqual([]);

		const json = glbJson(result.glb) as {
			cameras: unknown[];
			extensionsUsed: string[];
			nodes: Array<{ name?: string; camera?: number }>;
		};
		expect(json.cameras).toHaveLength(1);
		expect(json.extensionsUsed).toContain("KHR_lights_punctual");
		expect(json.nodes.map((n) => n.name)).toEqual(
			expect.arrayContaining([
				"crate",
				"bust",
				"orb",
				"card",
				"pegs",
				"pegs.0",
				"pegs.2",
				"Camera",
				"sun",
			]),
		);
	});

	it("loads back as the frame it was exported from", async () => {
		const out = path.join(dir, "roundtrip.glb");
		const original = await pixels(stage(scene()));
		await stage(scene()).exportModel({ outputPath: out, lights: false });
		// Meters back to px, y up back to y down.
		const reloaded = await pixels(
			stage([Layer.glb(out, { scale: 100, rotateX: 180 }) as LayoutNode]),
		);
		let covered = 0;
		let differ = 0;
		for (let i = 0; i < original.length; i += 4) {
			const a = original[i] + original[i + 1] + original[i + 2];
			const b = reloaded[i] + reloaded[i + 1] + reloaded[i + 2];
			if (a > 30 || b > 30) covered++;
			const d = Math.max(
				Math.abs(original[i] - reloaded[i]),
				Math.abs(original[i + 1] - reloaded[i + 1]),
				Math.abs(original[i + 2] - reloaded[i + 2]),
			);
			if (d > 24) differ++;
		}
		expect(covered).toBeGreaterThan(8000);
		// The card's edge alone may differ: the quad shader antialiases it, a mesh edge does not.
		expect(differ / covered).toBeLessThan(0.005);
	});
});

const FRAMES = 24;

/** A short film: a moving camera over `layers`. */
function film(layers: LayoutNode[]): Composition {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: FRAMES,
		backgroundColor: "#000000",
	});
	c.add([
		Layer.camera({
			x: 200,
			y: 140,
			z: -560,
			targetX: 200,
			targetY: 150,
		}).animate(
			LayerAnimation.create().keys("x", [
				[0, 120],
				[FRAMES - 1, 280, "sine.inOut"],
			]),
		),
		Layer.environment("studio", { intensity: 0.6 }),
		Layer.directionalLight({
			id: "sun",
			x: -200,
			y: -500,
			z: -400,
			targetX: 200,
			targetY: 150,
			targetZ: 0,
			intensity: 1.2,
		}),
		...layers,
	]);
	return c;
}

/** A crate sliding at a constant speed, a spinning ring, a cube that stands still, an orb arriving late, pegs that spread. */
function motion(): LayoutNode[] {
	return [
		Layer3D.roundedBox({
			id: "crate",
			x: 80,
			y: 150,
			width: 70,
			height: 70,
			depth: 70,
			radius: 8,
			color: "#3d7bd9",
		}).animate(
			LayerAnimation.create().keys("x", [
				[0, 80],
				[FRAMES - 1, 320],
			]),
		),
		Layer3D.torus({
			id: "ring",
			x: 200,
			y: 90,
			radius: 40,
			tube: 10,
			color: "#e0b080",
		}).animate(
			LayerAnimation.create().keys("rotateY", [
				[0, 0],
				[FRAMES - 1, 300],
			]),
		),
		Layer3D.sphere({
			id: "still",
			x: 200,
			y: 230,
			radius: 22,
			color: "#888888",
		}),
		Layer3D.sphere({
			id: "orb",
			x: 320,
			y: 90,
			radius: 30,
			color: "#dddddd",
			startFrame: 10,
			durationFrames: FRAMES - 10,
		}),
		Layer3D.instances({
			id: "pegs",
			x: 200,
			y: 270,
			mesh: Layer3D.roundedBox({
				width: 16,
				height: 16,
				depth: 16,
				radius: 3,
				color: "#ffffff",
			}),
			transforms: [-1, 0, 1].map((i) => ({ x: i * 40, y: 0, z: 0 })),
		}).animate(
			LayerAnimation.create().keys("scale", [
				[0, 1],
				[FRAMES - 1, 2],
			]),
		),
	] as LayoutNode[];
}

type Json = {
	nodes: Array<{
		name?: string;
		matrix?: number[];
		translation?: number[];
		children?: number[];
	}>;
	animations?: Array<{
		channels: Array<{
			sampler: number;
			target: { node: number; path: string };
		}>;
		samplers: Array<{ input: number; interpolation?: string }>;
	}>;
	accessors: Array<{ count: number }>;
};

describe("Composition.exportModel({ animation })", () => {
	it("writes each layer's motion as channels the validator accepts", async () => {
		const result = await film(motion()).exportModel({ animation: true });
		expect(result.frames).toBe(FRAMES);
		expect(result.skipped).toEqual([]);
		const report = await validateBytes(result.glb);
		const problems = report.issues.messages.filter(
			(m: { severity: number }) => m.severity <= 1,
		);
		expect(problems).toEqual([]);

		const json = glbJson(result.glb) as Json;
		const [clip] = json.animations ?? [];
		expect(json.animations).toHaveLength(1);
		const byNode = new Map<
			string,
			Array<{ path: string; keys: number; step: boolean }>
		>();
		for (const c of clip.channels) {
			const name = json.nodes[c.target.node].name ?? "";
			const sampler = clip.samplers[c.sampler];
			const list = byNode.get(name) ?? [];
			list.push({
				path: c.target.path,
				keys: json.accessors[sampler.input].count,
				step: sampler.interpolation === "STEP",
			});
			byNode.set(name, list);
		}
		// Constant speed: two keys carry 24 frames, and a third holds the last for its frame time.
		expect(byNode.get("crate")).toEqual([
			{ path: "translation", keys: 3, step: false },
		]);
		expect(byNode.get("ring")?.map((c) => c.path)).toEqual(["rotation"]);
		expect(byNode.has("still")).toBe(false);
		expect(json.nodes.find((n) => n.name === "still")?.matrix).toHaveLength(16);
		// Drawn from frame 10: hidden, then shown, by a stepped scale on its mesh's node.
		expect(byNode.get("orb:0")).toEqual([
			{ path: "scale", keys: 2, step: true },
		]);
		expect(byNode.get("pegs")?.map((c) => c.path)).toEqual(["scale"]);
		expect(byNode.get("Camera")?.map((c) => c.path)).toContain("translation");
		expect(result.channels).toBe(clip.channels.length);
	});

	it("plays back in the engine as the frames were drawn", async () => {
		const out = path.join(dir, "animated.glb");
		await film(motion()).exportModel({
			animation: true,
			lights: false,
			outputPath: out,
		});
		const reloaded = film([
			Layer.glb(out, { scale: 100, rotateX: 180 }) as LayoutNode,
		]);
		for (const frame of [0, 9, 10, 17, FRAMES - 1]) {
			const original = await pixels(film(motion()), frame);
			const back = await pixels(reloaded, frame);
			expect(disagreement(original, back), `frame ${frame}`).toBeLessThan(0.01);
		}
	});

	it("exports a range, with its clip starting at the range's first frame", async () => {
		const result = await film(motion()).exportModel({
			animation: { startFrame: 10, durationFrames: 8 },
		});
		expect(result.frames).toBe(8);
		const json = glbJson(result.glb) as Json;
		// The orb is drawn throughout the range: no visibility channel, its mesh on its node.
		expect(json.nodes.some((n) => n.name === "orb:0")).toBe(false);
		await expect(
			film(motion()).exportModel({
				animation: { startFrame: 20, durationFrames: 8 },
			}),
		).rejects.toThrow(/runs past/);
	});
});
