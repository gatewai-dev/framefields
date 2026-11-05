/**
 * Each material map samples with its own glTF sampler: a striped normal map
 * set to repeat, tiled six times by its texture transform, stripes the whole
 * quad even though the base color map clamps. Before maps had their own
 * samplers, every map took the base color's clamp and the stripes stopped
 * after the first tile.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng, GltfDocument } from "./forge/index.js";
import { Composition, Layer, type LayoutNode } from "./index.js";
import { decodePngPixels } from "./test-utils/pixels.js";

const SIZE = 320;
const C = SIZE / 2;
const HALF = 120;
const TILES = 6;

let dir = "";
let file = "";

/** 16 × 16 tangent-space normals in vertical bands 4 texels wide, tilted alternately left and right. */
function stripes(): Uint8Array {
	const n = 16;
	const rgba = new Uint8Array(n * n * 4);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const tilt = Math.floor(x / 4) % 2 ? 0.7 : -0.7;
			const z = Math.sqrt(1 - tilt * tilt);
			rgba.set(
				[
					Math.round((tilt * 0.5 + 0.5) * 255),
					128,
					Math.round((z * 0.5 + 0.5) * 255),
					255,
				],
				(y * n + x) * 4,
			);
		}
	return encodePng(rgba, n, n);
}

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-samplers-"));
	file = path.join(dir, "quad.glb");
	const doc = new GltfDocument();
	const white = encodePng(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
	const material = doc.addMaterial({
		roughness: 0.9,
		colorTexture: doc.addTexture({
			image: white,
			mimeType: "image/png",
			wrap: "clamp",
		}),
		normalTexture: {
			texture: doc.addTexture({
				image: stripes(),
				mimeType: "image/png",
				wrap: "repeat",
			}),
			transform: { scale: [TILES, TILES] },
		},
	});
	doc.addNode({
		mesh: doc.addMesh({
			primitives: [
				{
					positions: [
						-HALF,
						-HALF,
						0,
						HALF,
						-HALF,
						0,
						HALF,
						HALF,
						0,
						-HALF,
						HALF,
						0,
					],
					normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
					uvs: [0, 1, 1, 1, 1, 0, 0, 0],
					indices: [0, 1, 2, 0, 2, 3],
					material,
				},
			],
		}),
	});
	await fs.writeFile(file, doc.toGlb());
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("per-map samplers", () => {
	it("tiles a repeating normal map across a quad whose base color clamps", async () => {
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
			// Grazing from the left: the two tilts light differently.
			Layer.directionalLight({
				x: C - 1000,
				y: C,
				z: -300,
				targetX: C,
				targetY: C,
				targetZ: 0,
				intensity: 2,
			}),
			Layer.glb(file, { x: C, y: C, z: 0, rotateX: 180 }) as LayoutNode,
		]);
		const { pixels } = await decodePngPixels(
			await comp.renderFrame({ frame: 0 }),
		);
		// Bands along the middle row: light / dark changes past the mean.
		const row = Array.from({ length: 2 * HALF - 20 }, (_, i) => {
			const x = C - HALF + 10 + i;
			return pixels[(C * SIZE + x) * 4 + 1] ?? 0;
		});
		const mean = row.reduce((a, b) => a + b, 0) / row.length;
		let changes = 0;
		for (let i = 1; i < row.length; i++)
			if (row[i - 1]! > mean !== row[i]! > mean) changes++;
		// Six tiles of four bands: about 24 changes. One clamped tile gives about 4.
		expect(changes).toBeGreaterThan(16);
	});
});
