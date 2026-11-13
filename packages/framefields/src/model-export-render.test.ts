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
import { Composition, Layer, Layer3D, type LayoutNode } from "./index.js";
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

async function pixels(c: Composition): Promise<Uint8ClampedArray> {
	return (await decodePngPixels(await c.renderFrame({ frame: 0 }))).pixels;
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
