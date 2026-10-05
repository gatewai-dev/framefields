/**
 * glTF beyond static meshes: material textures, node hierarchies and skinned
 * meshes posed by animation clips (rotation tracks through a joint chain).
 * Each scene is a GLB built in the test and checked by its pixels.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";

const SIZE = 400;
const BG = "#000000";

/** Accumulates typed arrays into one binary buffer and the accessors that view them. */
class GlbBuilder {
	private chunks: Buffer[] = [];
	private length = 0;
	readonly bufferViews: object[] = [];
	readonly accessors: object[] = [];

	private view(data: Buffer): number {
		const pad = (4 - (this.length % 4)) % 4;
		if (pad) {
			this.chunks.push(Buffer.alloc(pad));
			this.length += pad;
		}
		this.bufferViews.push({
			buffer: 0,
			byteOffset: this.length,
			byteLength: data.length,
		});
		this.chunks.push(data);
		this.length += data.length;
		return this.bufferViews.length - 1;
	}

	accessor(
		data: Float32Array | Uint16Array,
		type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4",
	): number {
		const bufferView = this.view(
			Buffer.from(data.buffer, data.byteOffset, data.byteLength),
		);
		const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
		this.accessors.push({
			bufferView,
			componentType: data instanceof Float32Array ? 5126 : 5123,
			count: data.length / size,
			type,
		});
		return this.accessors.length - 1;
	}

	image(png: Buffer): number {
		return this.view(png);
	}

	build(json: Record<string, unknown>): Buffer {
		const bin = Buffer.concat(this.chunks);
		const doc = Buffer.from(
			JSON.stringify({
				asset: { version: "2.0" },
				...json,
				buffers: [{ byteLength: bin.length }],
				bufferViews: this.bufferViews,
				accessors: this.accessors,
			}),
		);
		const docPadded = Buffer.concat([
			doc,
			Buffer.alloc((4 - (doc.length % 4)) % 4, 0x20),
		]);
		const binPadded = Buffer.concat([
			bin,
			Buffer.alloc((4 - (bin.length % 4)) % 4),
		]);
		const header = Buffer.alloc(12);
		header.writeUInt32LE(0x46546c67, 0);
		header.writeUInt32LE(2, 4);
		header.writeUInt32LE(
			12 + 8 + docPadded.length + 8 + binPadded.length,
			8,
		);
		const chunk = (data: Buffer, type: number) => {
			const h = Buffer.alloc(8);
			h.writeUInt32LE(data.length, 0);
			h.writeUInt32LE(type, 4);
			return Buffer.concat([h, data]);
		};
		return Buffer.concat([
			header,
			chunk(docPadded, 0x4e4f534a),
			chunk(binPadded, 0x004e4942),
		]);
	}
}

/** An axis-aligned rectangle in the XY plane as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number) {
	return {
		positions: [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0],
		uvs: [0, 1, 1, 1, 1, 0, 0, 0],
		indices: [0, 1, 2, 0, 2, 3],
	};
}

async function solidPng(color: string): Promise<Buffer> {
	const canvas = new Canvas(8, 8);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 8, 8);
	return canvas.toBuffer("png");
}

async function pixels(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	return (x: number, y: number) => {
		const i = (Math.round(y) * img.width + Math.round(x)) * 4;
		return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
	};
}

/** Renders a GLB centred in a SIZE² frame, model units = pixels, Y up flipped to the screen's Y down. */
async function render(file: string, frame = 0, fps = 30) {
	const comp = new Composition({
		width: SIZE,
		height: SIZE,
		fps,
		durationFrames: 120,
		backgroundColor: BG,
	});
	comp.add(
		Layer.camera({
			id: "cam",
			x: SIZE / 2,
			y: SIZE / 2,
			// At this distance a 50° field of view maps one model unit to one pixel.
			z: -SIZE / 2 / Math.tan((25 * Math.PI) / 180),
			targetX: SIZE / 2,
			targetY: SIZE / 2,
			targetZ: 0,
		}),
	);
	comp.add(
		Layer.glb(file, {
			id: "model",
			x: SIZE / 2,
			y: SIZE / 2,
			z: 0,
			rotateX: 180,
			material: "unlit",
			loop: false,
		}),
	);
	return pixels(await comp.renderFrame({ frame }));
}

let dir = "";
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "framefields-gltf-scene-"));
});
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("glTF scene rendering", () => {
	it("samples a material's embedded base-color texture", async () => {
		const g = new GlbBuilder();
		const q = rect(-100, -100, 100, 100);
		const file = path.join(dir, "textured.glb");
		await fs.writeFile(
			file,
			g.build({
				meshes: [
					{
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
									TEXCOORD_0: g.accessor(new Float32Array(q.uvs), "VEC2"),
								},
								indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
								material: 0,
							},
						],
					},
				],
				materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
				textures: [{ source: 0 }],
				images: [{ bufferView: g.image(await solidPng("#ff2000")), mimeType: "image/png" }],
			}),
		);
		const px = await render(file);
		const [r, gr, b] = px(SIZE / 2, SIZE / 2);
		expect(r).toBeGreaterThan(220);
		expect(gr).toBeLessThan(60);
		expect(b).toBeLessThan(40);
	});

	it("poses a skinned mesh through its joint chain from a rotation track", async () => {
		// A 20×200 strip: the lower half on joint 0 (origin), the upper on
		// joint 1 (100 up, child of joint 0). The clip turns joint 1 by 90°
		// about Z over one second, folding the upper half to the left.
		const g = new GlbBuilder();
		const positions = [-10, 0, 0, 10, 0, 0, -10, 100, 0, 10, 100, 0, -10, 200, 0, 10, 200, 0];
		const joints = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
		const weights = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
		const ibm = [
			...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -100, 0, 1],
		];
		const s45 = Math.SQRT1_2;
		const file = path.join(dir, "skinned.glb");
		await fs.writeFile(
			file,
			g.build({
				scenes: [{ nodes: [0, 1] }],
				nodes: [
					{ mesh: 0, skin: 0 },
					{ name: "root", children: [2] },
					{ name: "tip", translation: [0, 100, 0] },
				],
				skins: [{ joints: [1, 2], inverseBindMatrices: g.accessor(new Float32Array(ibm), "MAT4") }],
				meshes: [
					{
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(positions), "VEC3"),
									JOINTS_0: g.accessor(new Uint16Array(joints), "VEC4"),
									WEIGHTS_0: g.accessor(new Float32Array(weights), "VEC4"),
								},
								indices: g.accessor(new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]), "SCALAR"),
								material: 0,
							},
						],
					},
				],
				materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
				animations: [
					{
						channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
						samplers: [
							{
								input: g.accessor(new Float32Array([0, 1]), "SCALAR"),
								output: g.accessor(new Float32Array([0, 0, 0, 1, 0, 0, s45, s45]), "VEC4"),
							},
						],
					},
				],
			}),
		);
		// Model (x, y) lands on screen (SIZE/2 + x, SIZE/2 - y).
		const lit = (px: (x: number, y: number) => number[], x: number, y: number) =>
			(px(SIZE / 2 + x, SIZE / 2 - y)[0] ?? 0) > 128;
		const rest = await render(file, 0);
		expect(lit(rest, 0, 150)).toBe(true);
		expect(lit(rest, -60, 100)).toBe(false);
		const bent = await render(file, 30);
		expect(lit(bent, 0, 150)).toBe(false);
		expect(lit(bent, -60, 100)).toBe(true);
		expect(lit(bent, 0, 50)).toBe(true);
	});

	it("places an unskinned mesh by its node's parent chain", async () => {
		const g = new GlbBuilder();
		const q = rect(-20, -20, 20, 20);
		const file = path.join(dir, "nested.glb");
		await fs.writeFile(
			file,
			g.build({
				scenes: [{ nodes: [0] }],
				nodes: [
					// Turned 90° about Z, so the child's +X offset points up.
					{ children: [1], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
					{ mesh: 0, translation: [120, 0, 0] },
				],
				meshes: [
					{
						primitives: [
							{
								attributes: { POSITION: g.accessor(new Float32Array(q.positions), "VEC3") },
								indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
							},
						],
					},
				],
			}),
		);
		const px = await render(file);
		expect((px(SIZE / 2, SIZE / 2 - 120)[0] ?? 0) > 128).toBe(true);
		expect((px(SIZE / 2 + 120, SIZE / 2)[0] ?? 0) > 128).toBe(false);
	});
});
