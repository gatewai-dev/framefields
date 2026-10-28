/**
 * glTF beyond static meshes: material textures, node hierarchies and skinned
 * meshes posed by animation clips (rotation tracks through a joint chain).
 * Each scene is a GLB built in the test and checked by its pixels.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
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
		header.writeUInt32LE(12 + 8 + docPadded.length + 8 + binPadded.length, 8);
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
async function render(file: string, frame = 0, fps = 30, lit = false) {
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
			material: lit ? "lit" : "unlit",
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
				materials: [
					{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
				],
				textures: [{ source: 0 }],
				images: [
					{
						bufferView: g.image(await solidPng("#ff2000")),
						mimeType: "image/png",
					},
				],
			}),
		);
		const px = await render(file);
		const [r, gr, b] = px(SIZE / 2, SIZE / 2);
		expect(r).toBeGreaterThan(220);
		expect(gr).toBeLessThan(60);
		expect(b).toBeLessThan(40);
	});

	it("reports unsupported required extensions instead of rendering a blank model", async () => {
		const file = path.join(dir, "unsupported.gltf");
		await fs.writeFile(
			file,
			JSON.stringify({
				asset: { version: "2.0" },
				extensionsRequired: ["VENDOR_unknown"],
			}),
		);
		const comp = new Composition({
			width: SIZE,
			height: SIZE,
			fps: 30,
			durationMs: 1000,
			backgroundColor: BG,
		});
		comp.add(
			Layer.camera({
				x: 200,
				y: 200,
				z: -600,
				targetX: 200,
				targetY: 200,
				targetZ: 0,
			}),
		);
		comp.add(Layer.glb(file, { id: "unsupported", x: 200, y: 200 }));
		await expect(comp.renderFrame({ frame: 0 })).rejects.toThrow(
			/VENDOR_unknown/,
		);
	});

	it.each([
		"etc1s",
		"uastc-ldr",
	])("renders required KTX2/Basis %s textures offline", async (format) => {
		const g = new GlbBuilder();
		const q = rect(-100, -100, 100, 100);
		const image = await fs.readFile(
			new URL(
				`../../webgpu-renderers/src/renderer3d/fixtures/${format}.ktx2`,
				import.meta.url,
			),
		);
		const file = path.join(dir, `${format}.glb`);
		await fs.writeFile(
			file,
			g.build({
				extensionsUsed: ["KHR_texture_basisu"],
				extensionsRequired: ["KHR_texture_basisu"],
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
				materials: [
					{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
				],
				textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
				images: [{ bufferView: g.image(image), mimeType: "image/ktx2" }],
			}),
		);
		const color = (await render(file))(200, 200);
		expect(color[0]).toBeGreaterThan(180);
		expect(color[1]).toBeLessThan(60);
		expect(color[2]).toBeLessThan(50);
	});

	it("blends an ETC1S KTX2 texture with alpha", async () => {
		const g = new GlbBuilder();
		const q = rect(-100, -100, 100, 100);
		const image = await fs.readFile(
			new URL(
				"../../webgpu-renderers/src/renderer3d/fixtures/etc1s-alpha.ktx2",
				import.meta.url,
			),
		);
		const file = path.join(dir, "ktx-alpha.glb");
		await fs.writeFile(
			file,
			g.build({
				extensionsUsed: ["KHR_texture_basisu"],
				extensionsRequired: ["KHR_texture_basisu"],
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
				materials: [
					{
						alphaMode: "BLEND",
						pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
					},
				],
				textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
				images: [{ bufferView: g.image(image), mimeType: "image/ktx2" }],
			}),
		);
		const color = (await render(file))(200, 200);
		expect(color[0]).toBeGreaterThan(100);
		expect(color[0]).toBeLessThan(135);
	});

	it("renders meshopt-compressed glTF through the compositor", async () => {
		const encoded = Buffer.from(
			"oAAAAAEzAAAA//8AAAABDAAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjCAADIwgAAAAA=",
			"base64",
		);
		const file = path.join(dir, "meshopt.gltf");
		await fs.writeFile(
			file,
			JSON.stringify({
				asset: { version: "2.0" },
				extensionsUsed: ["EXT_meshopt_compression"],
				extensionsRequired: ["EXT_meshopt_compression"],
				buffers: [
					{
						byteLength: encoded.length,
						uri: `data:application/octet-stream;base64,${encoded.toString("base64")}`,
					},
				],
				bufferViews: [
					{
						buffer: 0,
						byteLength: 48,
						byteStride: 12,
						extensions: {
							EXT_meshopt_compression: {
								buffer: 0,
								byteOffset: 0,
								byteLength: encoded.length,
								byteStride: 12,
								count: 4,
								mode: "ATTRIBUTES",
							},
						},
					},
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
				],
				meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 6 }] }],
			}),
		);
		expect((await render(file))(200, 200)[0]).toBeGreaterThan(180);
	});

	it("renders Draco-compressed glTF through the compositor", async () => {
		const requireFromRenderer = createRequire(
			import.meta.resolve("@framefields/webgpu-renderers"),
		);
		const dracoRoot = path.dirname(requireFromRenderer.resolve("draco3dgltf"));
		const encoded = await fs.readFile(path.join(dracoRoot, "bunny.drc"));
		const file = path.join(dir, "draco.gltf");
		await fs.writeFile(
			file,
			JSON.stringify({
				asset: { version: "2.0" },
				extensionsUsed: ["KHR_draco_mesh_compression"],
				extensionsRequired: ["KHR_draco_mesh_compression"],
				buffers: [
					{
						byteLength: encoded.length,
						uri: `data:application/octet-stream;base64,${encoded.toString("base64")}`,
					},
				],
				bufferViews: [{ buffer: 0, byteLength: encoded.length }],
				accessors: [
					{ componentType: 5126, count: 34834, type: "VEC3" },
					{ componentType: 5125, count: 69451 * 3, type: "SCALAR" },
				],
				meshes: [
					{
						primitives: [
							{
								attributes: { POSITION: 0 },
								indices: 1,
								extensions: {
									KHR_draco_mesh_compression: {
										bufferView: 0,
										attributes: { POSITION: 0 },
									},
								},
							},
						],
					},
				],
			}),
		);
		const comp = new Composition({
			width: SIZE,
			height: SIZE,
			fps: 30,
			durationMs: 1000,
			backgroundColor: BG,
		});
		comp.add(
			Layer.camera({
				x: 200,
				y: 200,
				z: -600,
				targetX: 200,
				targetY: 200,
				targetZ: 0,
			}),
		);
		comp.add(
			Layer.glb(file, {
				x: 200,
				y: 200,
				center: true,
				normalizeSize: 240,
				material: "unlit",
			}),
		);
		const px = await pixels(await comp.renderFrame({ frame: 0 }));
		let lit = 0;
		for (let y = 100; y < 300; y += 4)
			for (let x = 100; x < 300; x += 4) if ((px(x, y)[0] ?? 0) > 50) lit++;
		expect(lit).toBeGreaterThan(100);
	});

	it.each([
		0, 1, 2, 3, 5, 6,
	])("renders glTF primitive mode %i", async (mode) => {
		const g = new GlbBuilder();
		const file = path.join(dir, `primitive-${mode}.glb`);
		const q = rect(-100, -100, 100, 100);
		await fs.writeFile(
			file,
			g.build({
				meshes: [
					{
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
								},
								mode,
							},
						],
					},
				],
			}),
		);
		const px = await render(file);
		const litNear = (x: number, y: number) => {
			for (let dy = -2; dy <= 2; dy++)
				for (let dx = -2; dx <= 2; dx++) {
					if ((px(x + dx, y + dy)[0] ?? 0) > 50) return true;
				}
			return false;
		};
		if (mode === 0) expect(litNear(100, 300)).toBe(true);
		else if (mode < 4) expect(litNear(200, 300)).toBe(true);
		else expect(litNear(200, 200)).toBe(true);
	});

	it("samples an emissive map using its own UV set and transform", async () => {
		const canvas = new Canvas(8, 8);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#ff0000";
		ctx.fillRect(0, 0, 4, 8);
		ctx.fillStyle = "#00ff00";
		ctx.fillRect(4, 0, 4, 8);
		const image = await canvas.toBuffer("png");
		const renderUv = async (offset: number) => {
			const g = new GlbBuilder();
			const q = rect(-100, -100, 100, 100);
			const file = path.join(dir, `map-uv-${offset}.glb`);
			await fs.writeFile(
				file,
				g.build({
					meshes: [
						{
							primitives: [
								{
									attributes: {
										POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
										TEXCOORD_0: g.accessor(
											new Float32Array([
												0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5,
											]),
											"VEC2",
										),
										TEXCOORD_1: g.accessor(
											new Float32Array([
												0.75, 0.5, 0.75, 0.5, 0.75, 0.5, 0.75, 0.5,
											]),
											"VEC2",
										),
									},
									indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
									material: 0,
								},
							],
						},
					],
					materials: [
						{
							pbrMetallicRoughness: {
								baseColorFactor: [0, 0, 0, 1],
								baseColorTexture: { index: 0, texCoord: 0 },
							},
							emissiveFactor: [1, 1, 1],
							emissiveTexture: {
								index: 0,
								texCoord: 1,
								extensions: { KHR_texture_transform: { offset: [offset, 0] } },
							},
						},
					],
					textures: [{ source: 0 }],
					images: [{ bufferView: g.image(image), mimeType: "image/png" }],
				}),
			);
			return (await render(file, 0, 30, true))(SIZE / 2, SIZE / 2);
		};
		const green = await renderUv(0);
		const red = await renderUv(-0.5);
		expect(green[1]).toBeGreaterThan(200);
		expect(green[0]).toBeLessThan(40);
		expect(red[0]).toBeGreaterThan(200);
		expect(red[1]).toBeLessThan(40);
	});

	it("applies animated morph weights to mesh positions", async () => {
		const g = new GlbBuilder();
		const q = rect(-100, -30, -40, 30);
		const file = path.join(dir, "morph.glb");
		const delta = new Float32Array([
			120, 0, 0, 120, 0, 0, 120, 0, 0, 120, 0, 0,
		]);
		await fs.writeFile(
			file,
			g.build({
				nodes: [{ mesh: 0 }],
				scenes: [{ nodes: [0] }],
				meshes: [
					{
						weights: [0],
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
								},
								indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
								targets: [{ POSITION: g.accessor(delta, "VEC3") }],
							},
						],
					},
				],
				animations: [
					{
						channels: [{ sampler: 0, target: { node: 0, path: "weights" } }],
						samplers: [
							{
								input: g.accessor(new Float32Array([0, 1]), "SCALAR"),
								output: g.accessor(new Float32Array([0, 1]), "SCALAR"),
								interpolation: "LINEAR",
							},
						],
					},
				],
			}),
		);
		const rest = await render(file, 0);
		const halfway = await render(file, 15);
		const end = await render(file, 30);
		expect(rest(130, 200)[0]).toBeGreaterThan(200);
		expect(rest(250, 200)[0]).toBeLessThan(10);
		expect(halfway(190, 200)[0]).toBeGreaterThan(200);
		expect(end(130, 200)[0]).toBeLessThan(10);
		expect(end(250, 200)[0]).toBeGreaterThan(200);
	});

	it("applies morph deltas before the skin's joint transform", async () => {
		const g = new GlbBuilder();
		const q = rect(-100, -20, -60, 20);
		const file = path.join(dir, "morph-skin.glb");
		const delta = new Float32Array([50, 0, 0, 50, 0, 0, 50, 0, 0, 50, 0, 0]);
		const joints = new Uint16Array(16);
		const weights = new Float32Array([
			1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
		]);
		await fs.writeFile(
			file,
			g.build({
				nodes: [
					{ mesh: 0, skin: 0, weights: [1] },
					{ translation: [40, 0, 0] },
				],
				scenes: [{ nodes: [0, 1] }],
				skins: [{ joints: [1] }],
				meshes: [
					{
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
									JOINTS_0: g.accessor(joints, "VEC4"),
									WEIGHTS_0: g.accessor(weights, "VEC4"),
								},
								indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
								targets: [{ POSITION: g.accessor(delta, "VEC3") }],
							},
						],
					},
				],
			}),
		);
		const px = await render(file);
		expect(px(210, 200)[0]).toBeGreaterThan(200);
		expect(px(120, 200)[0]).toBeLessThan(10);
	});

	it("keeps independent default weights on instances of the same morph mesh", async () => {
		const g = new GlbBuilder();
		const q = rect(-20, -20, 20, 20);
		const file = path.join(dir, "morph-instances.glb");
		const delta = new Float32Array([
			100, 0, 0, 100, 0, 0, 100, 0, 0, 100, 0, 0,
		]);
		await fs.writeFile(
			file,
			g.build({
				nodes: [
					{ mesh: 0, translation: [-100, 70, 0], weights: [0] },
					{ mesh: 0, translation: [-100, -70, 0], weights: [1] },
				],
				scenes: [{ nodes: [0, 1] }],
				meshes: [
					{
						weights: [0],
						primitives: [
							{
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
								},
								indices: g.accessor(new Uint16Array(q.indices), "SCALAR"),
								targets: [{ POSITION: g.accessor(delta, "VEC3") }],
							},
						],
					},
				],
			}),
		);
		const px = await render(file);
		expect(px(100, 130)[0]).toBeGreaterThan(200);
		expect(px(200, 270)[0]).toBeGreaterThan(200);
		expect(px(100, 270)[0]).toBeLessThan(10);
	});

	it("poses a skinned mesh through its joint chain from a rotation track", async () => {
		// A 20×200 strip: the lower half on joint 0 (origin), the upper on
		// joint 1 (100 up, child of joint 0). The clip turns joint 1 by 90°
		// about Z over one second, folding the upper half to the left.
		const g = new GlbBuilder();
		const positions = [
			-10, 0, 0, 10, 0, 0, -10, 100, 0, 10, 100, 0, -10, 200, 0, 10, 200, 0,
		];
		const joints = [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
		];
		const weights = [
			1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
		];
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
				skins: [
					{
						joints: [1, 2],
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
								indices: g.accessor(
									new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]),
									"SCALAR",
								),
								material: 0,
							},
						],
					},
				],
				materials: [
					{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
				],
				animations: [
					{
						channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
						samplers: [
							{
								input: g.accessor(new Float32Array([0, 1]), "SCALAR"),
								output: g.accessor(
									new Float32Array([0, 0, 0, 1, 0, 0, s45, s45]),
									"VEC4",
								),
							},
						],
					},
				],
			}),
		);
		// Model (x, y) lands on screen (SIZE/2 + x, SIZE/2 - y).
		const lit = (
			px: (x: number, y: number) => number[],
			x: number,
			y: number,
		) => (px(SIZE / 2 + x, SIZE / 2 - y)[0] ?? 0) > 128;
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
								attributes: {
									POSITION: g.accessor(new Float32Array(q.positions), "VEC3"),
								},
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
