import fs from "node:fs";
import path from "node:path";
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
		// uv (1, 0): scaled to (2, 0), rotated to (0, -2), offset to (0.5, -1.75).
		expect(uvs[2]).toBeCloseTo(0.5, 5);
		expect(uvs[3]).toBeCloseTo(-1.75, 5);
		// uv (0, 1): scaled to (0, 4), rotated to (4, 0), offset to (4.5, 0.25).
		expect(uvs[4]).toBeCloseTo(4.5, 5);
		expect(uvs[5]).toBeCloseTo(0.25, 5);
	});

	it("draws with the base color's UV set and skips maps on another set", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const model = parse(
			quadGltf({
				pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } },
				occlusionTexture: { index: 0 },
			}),
		);
		expect(Array.from(model.meshes[0]!.uvs.slice(0, 4))).toEqual([
			10, 10, 11, 10,
		]);
		expect(model.materials.M?.diffuseTextureBuffer).toBeDefined();
		expect(model.materials.M?.occlusionTextureBuffer).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('occlusion map of material "M" uses UV set 0'),
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

	it("prefers EXT_texture_webp and skips KTX2 / Basis textures", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
		expect(mat.normalTextureBuffer).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("KTX2 / Basis"));
	});

	it("fails clearly on required mesh compression", () => {
		expect(() =>
			parse(
				quadGltf({}, { extensionsRequired: ["KHR_draco_mesh_compression"] }),
			),
		).toThrow(/KHR_draco_mesh_compression.*cannot decode/);
		expect(() =>
			parse(quadGltf({}, { extensionsRequired: ["EXT_meshopt_compression"] })),
		).toThrow(/meshopt/);
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
