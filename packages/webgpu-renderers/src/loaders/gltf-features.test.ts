import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptEncoder } from "meshoptimizer/encoder";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GltfLoader, loadGLTF } from "./gltf-loader.js";

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** A one-quad glTF with two UV sets (TEXCOORD_1 = TEXCOORD_0 + 10) and the given material. */
function quadGltf(
	material: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
	const uv0 = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
	const uv1 = uv0.map((v) => v + 10);
	const bin = Buffer.concat([pos, uv0, uv1].map((a) => Buffer.from(a.buffer)));
	return {
		asset: { version: "2.0" },
		buffers: [
			{
				byteLength: bin.length,
				uri: `data:application/octet-stream;base64,${bin.toString("base64")}`,
			},
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: 48 },
			{ buffer: 0, byteOffset: 48, byteLength: 32 },
			{ buffer: 0, byteOffset: 80, byteLength: 32 },
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
			{ bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
			{ bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
		],
		meshes: [
			{
				primitives: [
					{
						attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 },
						material: 0,
					},
				],
			},
		],
		images: [{ uri: IMAGE }, { uri: "data:image/webp;base64,UklGRg==" }],
		textures: [{ source: 0, sampler: 0 }],
		samplers: [{}],
		materials: [{ name: "M", ...material }],
		...extra,
	};
}

const parse = (doc: Record<string, unknown>) =>
	GltfLoader.parse(JSON.stringify(doc));

describe("glTF texture features", () => {
	afterEach(() => vi.restoreAllMocks());

	it("bakes KHR_texture_transform into the mesh UVs", () => {
		const model = parse(
			quadGltf({
				pbrMetallicRoughness: {
					baseColorTexture: {
						index: 0,
						extensions: {
							KHR_texture_transform: {
								offset: [0.5, 0.25],
								scale: [2, 4],
								rotation: Math.PI / 2,
							},
						},
					},
				},
			}),
		);
		const uvs = Array.from(model.meshes[0]!.uvs);
		// uv (1, 0): scaled to (2, 0), rotated to (0, 2), offset to (0.5, 2.25).
		expect(uvs[2]).toBeCloseTo(0.5, 5);
		expect(uvs[3]).toBeCloseTo(2.25, 5);
		// uv (0, 1): scaled to (0, 4), rotated to (-4, 0), offset to (-3.5, 0.25).
		expect(uvs[4]).toBeCloseTo(-3.5, 5);
		expect(uvs[5]).toBeCloseTo(0.25, 5);
	});

	it("keeps each map's UV set and texture transform", () => {
		const model = parse(
			quadGltf({
				pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } },
				occlusionTexture: {
					index: 0,
					extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
				},
			}),
		);
		expect(Array.from(model.meshes[0]!.uvs.slice(0, 4))).toEqual([
			10, 10, 11, 10,
		]);
		expect(model.materials.M?.diffuseTextureBuffer).toBeDefined();
		expect(model.materials.M?.occlusionTextureBuffer).toBeDefined();
		expect(Array.from(model.meshes[0]!.mapUvs!.occlusion!.slice(0, 4))).toEqual(
			[0.25, 0.5, 1.25, 0.5],
		);
	});

	it("reads the sampler's NEAREST magnification and clamp wrap", () => {
		const doc = quadGltf({
			pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
		});
		doc.samplers = [{ magFilter: 9728, wrapS: 33071 }];
		const mat = parse(doc).materials.M!;
		expect(mat.textureFilter).toBe("nearest");
		expect(mat.textureWrap).toBe("clamp");
	});

	it("prefers WebP and Basis extension sources", () => {
		const doc = quadGltf({
			pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
			normalTexture: { index: 1 },
		});
		doc.textures = [
			{ source: 0, extensions: { EXT_texture_webp: { source: 1 } } },
			{ extensions: { KHR_texture_basisu: { source: 0 } } },
		];
		const mat = parse(doc).materials.M!;
		expect(mat.diffuseTextureMime).toBe("image/webp");
		expect(mat.normalTextureBuffer).toBeDefined();
	});

	it("fails clearly on required mesh compression", () => {
		expect(() =>
			parse(
				quadGltf({}, { extensionsRequired: ["KHR_draco_mesh_compression"] }),
			),
		).toThrow(/KHR_draco_mesh_compression.*cannot decode/);
		expect(() =>
			parse(quadGltf({}, { extensionsRequired: ["EXT_meshopt_compression"] })),
		).toThrow(/EXT_meshopt_compression/);
	});

	it("decodes Draco positions and per-map UV attributes", async () => {
		const encoded = Buffer.from(
			"RFJBQ08CAgEBAAAAAwEBAQAAAQf/AREBAQAC/wAAAAAAAQAJAwAAAAEDCQIAAQAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAA=",
			"base64",
		);
		const doc = quadGltf(
			{ normalTexture: { index: 0 } },
			{
				extensionsRequired: ["KHR_draco_mesh_compression"],
				buffers: [
					{
						byteLength: encoded.length,
						uri: `data:application/octet-stream;base64,${encoded.toString("base64")}`,
					},
				],
				bufferViews: [{ buffer: 0, byteLength: encoded.length }],
				accessors: [
					{ componentType: 5126, count: 3, type: "VEC3" },
					{ componentType: 5126, count: 3, type: "VEC2" },
				],
				meshes: [
					{
						primitives: [
							{
								attributes: { POSITION: 0, TEXCOORD_0: 1 },
								material: 0,
								extensions: {
									KHR_draco_mesh_compression: {
										bufferView: 0,
										attributes: { POSITION: 0, TEXCOORD_0: 1 },
									},
								},
							},
						],
					},
				],
			},
		);
		const result = await GltfLoader.parseAsync(JSON.stringify(doc));
		const mesh = result.meshes[0]!;
		expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		expect(Array.from(mesh.mapUvs!.normal!)).toEqual([0, 0, 1, 0, 0, 1]);
		doc.extensionsRequired = [];
		expect(() => parse(doc)).toThrow(/requires GltfLoader.parseAsync/);
	});

	it("decodes a required Draco-compressed mesh asynchronously", async () => {
		const dracoRoot = path.dirname(
			fileURLToPath(import.meta.resolve("draco3dgltf")),
		);
		const encoded = fs.readFileSync(path.join(dracoRoot, "bunny.drc"));
		const doc = quadGltf(
			{},
			{
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
			},
		);
		const result = await GltfLoader.parseAsync(JSON.stringify(doc));
		expect(result.meshes[0]!.positions.length).toBe(34834 * 3);
		expect(result.meshes[0]!.indices.length).toBe(69451 * 3);
		expect(result.bounds.size.every((v) => v > 0)).toBe(true);
	});

	it.each([
		"EXT_meshopt_compression",
		"KHR_meshopt_compression",
	])("decodes required %s vertex buffers asynchronously", async (extension) => {
		await MeshoptEncoder.ready;
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		const compressed = MeshoptEncoder.encodeGltfBuffer(
			new Uint8Array(positions.buffer),
			3,
			12,
			"ATTRIBUTES",
			extension.startsWith("KHR_") ? 1 : 0,
		);
		const doc = quadGltf(
			{},
			{
				extensionsUsed: [extension],
				extensionsRequired: [extension],
				buffers: [
					{
						byteLength: compressed.length,
						uri: `data:application/octet-stream;base64,${Buffer.from(compressed).toString("base64")}`,
					},
				],
				bufferViews: [
					{
						buffer: 0,
						byteLength: positions.byteLength,
						byteStride: 12,
						extensions: {
							[extension]: {
								buffer: 0,
								byteOffset: 0,
								byteLength: compressed.length,
								byteStride: 12,
								count: 3,
								mode: "ATTRIBUTES",
							},
						},
					},
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
				],
				meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
			},
		);
		const result = await GltfLoader.parseAsync(JSON.stringify(doc));
		expect(Array.from(result.meshes[0]!.positions)).toEqual(
			Array.from(positions),
		);
	});

	it("applies sparse accessor values over an implicit zero base", () => {
		const position = new Float32Array([7, 8, 9]);
		const bytes = Buffer.concat([
			Buffer.from([1, 0, 0, 0]),
			Buffer.from(position.buffer),
		]);
		const doc = quadGltf(
			{},
			{
				buffers: [
					{
						byteLength: bytes.length,
						uri: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
					},
				],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: 1 },
					{ buffer: 0, byteOffset: 4, byteLength: 12 },
				],
				accessors: [
					{
						componentType: 5126,
						count: 3,
						type: "VEC3",
						sparse: {
							count: 1,
							indices: { bufferView: 0, componentType: 5121 },
							values: { bufferView: 1 },
						},
					},
				],
				meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
			},
		);
		expect(Array.from(parse(doc).meshes[0]!.positions)).toEqual([
			0, 0, 0, 7, 8, 9, 0, 0, 0,
		]);
	});

	it("rejects unknown required extensions", () => {
		for (const ext of ["VENDOR_unknown", "KHR_materials_transmission"]) {
			expect(() => parse(quadGltf({}, { extensionsRequired: [ext] }))).toThrow(
				ext,
			);
		}
	});

	it.each([
		[5, [0, 1, 2, 2, 1, 3]],
		[6, [0, 1, 2, 0, 2, 3]],
	])("expands triangle primitive mode %i", (mode, expected) => {
		const doc = quadGltf(
			{},
			{ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode }] }] },
		);
		expect(Array.from(parse(doc).meshes[0]!.indices)).toEqual(expected);
	});

	it.each([
		[0, "point-list", [0, 1, 2, 3]],
		[1, "line-list", [0, 1, 2, 3]],
		[2, "line-list", [0, 1, 1, 2, 2, 3, 3, 0]],
		[3, "line-list", [0, 1, 1, 2, 2, 3]],
	] as const)("converts glTF primitive mode %i", (mode, topology, expected) => {
		const doc = quadGltf(
			{},
			{ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode }] }] },
		);
		const mesh = parse(doc).meshes[0]!;
		expect(mesh.topology).toBe(topology);
		expect(Array.from(mesh.indices)).toEqual(expected);
	});

	it("loads a model from a bare relative path", () => {
		const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-gltf-rel-"));
		try {
			fs.writeFileSync(
				path.join(dir, "quad.gltf"),
				JSON.stringify(quadGltf({})),
			);
			// No "./" prefix, as in Layer.glb("models/robot.glb").
			const bare = `${path.basename(dir)}/quad.gltf`;
			expect(loadGLTF(bare).meshes).toHaveLength(1);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
