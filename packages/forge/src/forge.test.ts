/**
 * Forge output is standard glTF: the Khronos validator finds no errors or
 * warnings, and the engine's own loader reads back exactly what was written
 * (geometry, 32-bit indices, skins, named morph targets, materials, clips).
 */
import { denseMorphDeltas, parseGLB } from "@framefields/webgpu-renderers";
import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import {
	boneGizmo,
	encodePng,
	GltfDocument,
	humanoidSkeleton,
	linearRgba,
	Skeleton,
} from "./index.js";
import { readPng } from "./read-png.test-util.js";

async function validate(glb: Uint8Array) {
	const report = await validateBytes(glb, { maxIssues: 50 });
	const issues = report.issues.messages
		.filter((m: { severity: number }) => m.severity <= 1)
		.map(
			(m: { code: string; message: string; pointer?: string }) =>
				`${m.code} ${m.pointer ?? ""}: ${m.message}`,
		);
	return {
		errors: report.issues.numErrors,
		warnings: report.issues.numWarnings,
		issues,
	};
}

/** A quad strip of `rows` segments along +y, two vertices wide. */
function strip(rows: number, height: number) {
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rows; r++) {
		const y = (r / rows) * height;
		positions.push(-5, y, 0, 5, y, 0);
		normals.push(0, 0, 1, 0, 0, 1);
		if (r < rows) {
			const a = r * 2;
			indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
		}
	}
	return { positions, normals, indices };
}

describe("GltfDocument", () => {
	it("writes a skinned, morphing, animated character that validates and loads back", async () => {
		const skel = new Skeleton()
			.add("Root", { at: [0, 0, 0] })
			.add("Mid", { at: [0, 50, 0], parent: "Root" })
			.add("Tip", { at: [0, 100, 0], parent: "Mid" });
		const doc = new GltfDocument();
		const rig = doc.addSkeleton(skel);
		const s = strip(4, 100);
		const n = s.positions.length / 3;
		const joints: number[] = [];
		const weights: number[] = [];
		for (let v = 0; v < n; v++) {
			const y = s.positions[v * 3 + 1] as number;
			joints.push(y < 50 ? 0 : 1, y < 50 ? 1 : 2, 0, 0);
			weights.push(3, 1, 0, 0); // normalized on write
		}
		const bulge = s.positions.map((_, i) =>
			i % 3 === 0 ? s.positions[i]! * 0.5 : 0,
		);
		const material = doc.addMaterial({
			name: "Lacquer",
			color: "#d99a2b",
			roughness: 0.35,
			clearcoat: { factor: 1, roughness: 0.05 },
			sheen: { color: "#ffd9c0", roughness: 0.4 },
			doubleSided: true,
		});
		const mesh = doc.addMesh({
			name: "Strip",
			primitives: [
				{
					...s,
					joints,
					weights,
					material,
					targets: [
						{ name: "wide", positions: bulge },
						{ name: "flat", positions: new Array(n * 3).fill(0) },
					],
				},
			],
			weights: [0, 0],
		});
		const body = doc.addNode({ name: "Body", mesh, skin: rig.skin });
		const t = [0, 1];
		doc.addAnimation({
			name: "Bend",
			channels: [
				{
					node: rig.joints.get("Mid")!,
					path: "rotation",
					times: t,
					values: [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2],
				},
				{ node: body, path: "weights", times: t, values: [0, 0, 1, 0] },
			],
		});
		const glb = doc.toGlb();

		const report = await validate(glb);
		expect(report.issues).toEqual([]);
		expect(report.errors).toBe(0);

		const model = parseGLB(glb);
		const m = model.meshes[0]!;
		expect(Array.from(m.positions)).toEqual(s.positions);
		expect(Array.from(m.indices)).toEqual(s.indices);
		expect(m.morphTargets).toHaveLength(2);
		expect(Array.from(m.morphTargets![0]!.positions!)).toEqual(bulge);
		expect(Array.from(m.jointWeights!.slice(0, 4))).toEqual([0.75, 0.25, 0, 0]);
		const skin = model.skins![0]!;
		expect(skin.joints.map((j) => model.nodes![j]!.name)).toEqual([
			"Root",
			"Mid",
			"Tip",
		]);
		// Inverse bind matrices undo each joint's rest position.
		expect(
			Array.from(skin.inverseBindMatrices.slice(16 + 12, 16 + 15)),
		).toEqual([0, -50, 0]);
		expect(model.nodes![skin.joints[2]!]!.translation).toEqual([0, 50, 0]);
		const clip = model.animations.find((a) => a.name === "Bend")!;
		expect(clip.duration).toBeCloseTo(1);
		expect(clip.tracks.some((k) => k.weights)).toBe(true);
		const mat = Object.values(model.materials)[0]!;
		expect(mat.roughness).toBeCloseTo(0.35);
		expect(mat.twoSided).toBe(true);
		// Factors are linear in the file; the loader hands back display color.
		const [r] = linearRgba("#d99a2b");
		expect(r).toBeLessThan(0.75);
		expect(mat.diffuseColor?.[0]).toBeCloseTo(0xd9 / 255, 2);
		const json = doc.json() as {
			meshes: { extras: { targetNames: string[] } }[];
			extensionsUsed: string[];
		};
		expect(json.meshes[0]!.extras.targetNames).toEqual(["wide", "flat"]);
		expect(json.extensionsUsed).toEqual([
			"KHR_materials_clearcoat",
			"KHR_materials_sheen",
		]);
	});

	it("switches to 32-bit indices past 65,535 vertices", async () => {
		const s = strip(40000, 1000);
		const doc = new GltfDocument();
		doc.addNode({ mesh: doc.addMesh({ primitives: [s] }) });
		const glb = doc.toGlb();
		expect((await validate(glb)).errors).toBe(0);
		const m = parseGLB(glb).meshes[0]!;
		expect(m.indices).toBeInstanceOf(Uint32Array);
		expect(m.indices[m.indices.length - 1]).toBe(
			s.indices[s.indices.length - 1],
		);
	});

	it("stores morph targets that move few vertices as sparse accessors", async () => {
		const s = strip(20, 100);
		const n = s.positions.length / 3;
		const poke = new Array<number>(n * 3).fill(0);
		poke[7 * 3 + 2] = 4; // one vertex out along +z
		const doc = new GltfDocument();
		doc.addNode({
			mesh: doc.addMesh({
				primitives: [
					{
						...s,
						targets: [
							{
								name: "poke",
								positions: poke,
								normals: new Array(n * 3).fill(0),
							},
						],
					},
				],
			}),
		});
		const glb = doc.toGlb();
		const report = await validate(glb);
		expect(report.issues).toEqual([]);
		const jsonLength = new DataView(glb.buffer, glb.byteOffset).getUint32(
			12,
			true,
		);
		const json = JSON.parse(
			new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)),
		) as {
			meshes: { primitives: { targets: { POSITION: number }[] }[] }[];
			accessors: { sparse?: { count: number }; max?: number[] }[];
		};
		const acc =
			json.accessors[json.meshes[0]!.primitives[0]!.targets[0]!.POSITION]!;
		expect(acc.sparse?.count).toBe(1);
		expect(acc.max).toEqual([0, 0, 4]);
		const m = parseGLB(glb).meshes[0]!;
		expect(Array.from(denseMorphDeltas(m.morphTargets![0]!, n))).toEqual(poke);
		// Kept sparse in memory: only the moved vertex.
		expect(Array.from(m.morphTargets![0]!.indices!)).toEqual([7]);
		expect(m.morphTargetNames).toEqual(["poke"]);
	});

	it("encodes PNGs that decode to the same pixels", () => {
		const w = 7;
		const h = 5;
		const rgba = Uint8Array.from(
			{ length: w * h * 4 },
			(_, i) => (i * 37 + (i >> 3) * 11) & 0xff,
		);
		const png = encodePng(rgba, w, h);
		expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
		const back = readPng(png);
		expect([back.width, back.height]).toEqual([w, h]);
		expect(Array.from(back.rgba)).toEqual(Array.from(rgba));
	});

	it("writes texture transforms that tile a map, and the loader applies them to that map alone", async () => {
		const s = strip(1, 10);
		const uvs = [0, 1, 1, 1, 0, 0, 1, 0];
		const doc = new GltfDocument();
		const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
		const material = doc.addMaterial({
			colorTexture: doc.addTexture({ image: png, mimeType: "image/png" }),
			normalTexture: {
				texture: doc.addTexture({ image: png, mimeType: "image/png" }),
				scale: 0.5,
				transform: { scale: [8, 8] },
			},
		});
		doc.addNode({
			mesh: doc.addMesh({ primitives: [{ ...s, uvs, material }] }),
		});
		const glb = doc.toGlb();
		const report = await validate(glb);
		expect(report.issues).toEqual([]);
		expect(
			(doc.json() as { extensionsUsed: string[] }).extensionsUsed,
		).toContain("KHR_texture_transform");
		const m = parseGLB(glb).meshes[0]!;
		expect(Array.from(m.uvs ?? [])).toEqual(uvs);
		expect(Array.from(m.mapUvs?.normal ?? [])).toEqual(uvs.map((x) => x * 8));
	});

	it("writes every material extension in a valid form", async () => {
		const doc = new GltfDocument();
		const material = doc.addMaterial({
			color: "#ffffffcc",
			alphaMode: "mask",
			alphaCutoff: 0.4,
			emissive: "#ff7a2e",
			emissiveStrength: 6,
			specular: { factor: 0.6, color: "#fff4e0" },
			ior: 1.38,
			transmission: 0.3,
			volume: {
				thickness: 2,
				attenuationColor: "#d99a2b",
				attenuationDistance: 5,
			},
			iridescence: { factor: 0.8, ior: 1.4, thickness: [120, 420] },
			anisotropy: { strength: 0.6, rotation: 90 },
		});
		doc.addNode({
			mesh: doc.addMesh({ primitives: [{ ...strip(1, 10), material }] }),
		});
		const report = await validate(doc.toGlb());
		expect(report.issues).toEqual([]);
		expect(report.errors).toBe(0);
	});

	it("writes layered lobes the engine loader reads back", () => {
		const doc = new GltfDocument();
		const material = doc.addMaterial({
			color: "#e8cfb0",
			clearcoat: { factor: 0.6, roughness: 0.1 },
			sheen: { color: "#ffd9c0", roughness: 0.4 },
			anisotropy: { strength: 0.5, rotation: 30 },
			iridescence: { factor: 0.7, ior: 1.4, thickness: [100, 380] },
			subsurface: { factor: 0.8, color: "#ff5040" },
		});
		doc.addNode({
			mesh: doc.addMesh({ primitives: [{ ...strip(1, 10), material }] }),
		});
		const surface = Object.values(parseGLB(doc.toGlb()).materials)[0]?.surface;
		expect(surface?.clearcoat).toBeCloseTo(0.6);
		expect(surface?.clearcoatRoughness).toBeCloseTo(0.1);
		expect(surface?.sheen).toBeCloseTo(1);
		// Display colors come back as written.
		expect(surface?.sheenColor?.[0]).toBeCloseTo(1, 2);
		expect(surface?.sheenColor?.[1]).toBeCloseTo(0xd9 / 0xff, 2);
		expect(surface?.anisotropyRotation).toBeCloseTo(30);
		expect(surface?.iridescenceThickness).toBeCloseTo(380);
		expect(surface?.subsurface).toBeCloseTo(0.8);
		expect(surface?.subsurfaceColor?.[1]).toBeCloseTo(0x50 / 0xff, 2);
	});

	it("writes rig drivers and transmissive glass the loader reads", () => {
		const doc = new GltfDocument();
		const glass = doc.addMaterial({
			transmission: 1,
			ior: 1.376,
			volume: { thickness: 0.3 },
		});
		doc.addNode({
			mesh: doc.addMesh({ primitives: [{ ...strip(1, 10), material: glass }] }),
		});
		doc.addDriver({ joint: "lid", from: "eye", rotate: { x: 0.65 } });
		const model = parseGLB(doc.toGlb());
		expect(model.drivers).toEqual([
			{ joint: "lid", from: "eye", rotate: { x: 0.65 } },
		]);
		const m = Object.values(model.materials)[0];
		expect(m?.shading).toBe("glass");
		expect(m?.ior).toBeCloseTo(1.376);
		expect(m?.thickness).toBeCloseTo(0.3);
		expect(() => doc.addDriver({ joint: "a", from: "b", rotate: {} })).toThrow(
			/finite share/,
		);
	});

	it("refuses inconsistent input where it is given", () => {
		const doc = new GltfDocument();
		expect(() =>
			doc.addMesh({
				primitives: [{ positions: [0, 0, 0, 1, 0, 0], normals: [0, 0, 1] }],
			}),
		).toThrow(/1 entries for 2 vertices/);
		expect(() =>
			doc.addMesh({ primitives: [{ ...strip(1, 1), indices: [0, 1, 9] }] }),
		).toThrow(/outside 0\.\.3/);
		const skinned = doc.addMesh({
			primitives: [
				{
					...strip(1, 1),
					joints: new Array(16).fill(0).map((_, i) => (i % 4 ? 0 : 3)),
					weights: new Array(16).fill(0).map((_, i) => (i % 4 ? 0 : 1)),
				},
			],
		});
		const rig = doc.addSkeleton(new Skeleton().add("A", { at: [0, 0, 0] }));
		expect(() => doc.addNode({ mesh: skinned, skin: rig.skin })).toThrow(
			/joint 3 but the skin has 1/,
		);
		expect(() => doc.addMaterial({ roughness: 2 })).toThrow(/outside 0\.\.1/);
	});
});

describe("Skeleton", () => {
	it("mirrors left joints to the right, under mirrored parents", () => {
		const s = new Skeleton()
			.add("Spine", { at: [0, 100, 0] })
			.add("LeftShoulder", { at: [5, 140, 0], parent: "Spine" })
			.add("LeftArm", { at: [20, 140, 0], parent: "LeftShoulder" })
			.mirror();
		expect(s.joint("RightArm").at).toEqual([-20, 140, 0]);
		expect(s.joint("RightArm").parent).toBe("RightShoulder");
		expect(s.joint("RightShoulder").parent).toBe("Spine");
	});

	it("builds a proportioned Mixamo humanoid", () => {
		const s = humanoidSkeleton({ height: 186, heads: 8 });
		for (const name of [
			"Hips",
			"Spine",
			"Spine2",
			"Neck",
			"Head",
			"LeftArm",
			"LeftForeArm",
			"RightHand",
			"RightHandIndex4",
			"LeftHandThumb4",
			"LeftUpLeg",
			"RightLeg",
			"RightToe_End",
		])
			expect(s.has(name), name).toBe(true);
		expect(s.joint("HeadTop_End").at[1]).toBeCloseTo(186);
		expect(Math.min(...s.joints.map((j) => j.at[1]))).toBeGreaterThanOrEqual(0);
		// Symmetric, and arm spans scale with the figure.
		expect(s.joint("RightForeArm").at[0]).toBeCloseTo(
			-s.joint("LeftForeArm").at[0],
		);
		expect(s.length("LeftForeArm")).toBeCloseTo(0.186 * 186, 5);
		// A T-pose holds the arms level.
		const t = humanoidSkeleton({ armAngle: 0 });
		expect(t.joint("LeftHand").at[1]).toBeCloseTo(t.joint("LeftArm").at[1]);
		expect(
			humanoidSkeleton({ prefix: "mixamorig:" }).has("mixamorig:LeftArm"),
		).toBe(true);
	});

	it("keeps rest orientations: node rotations, inverse bind matrices, mirrored copies", async () => {
		// A forearm turned 90° about z at rest: its local x points up.
		const turn: [number, number, number, number] = [
			0,
			0,
			Math.SQRT1_2,
			Math.SQRT1_2,
		];
		const s = new Skeleton()
			.add("Root", { at: [0, 0, 0] })
			.add("LeftArm", { at: [10, 0, 0], parent: "Root", orient: turn })
			.add("LeftHand", { at: [10, 8, 0], parent: "LeftArm", orient: turn })
			.mirror();
		expect(s.local("LeftHand")).toEqual([
			expect.closeTo(8, 9),
			expect.closeTo(0, 9),
			expect.closeTo(0, 9),
		]);
		const r = s.joint("RightArm").orient!;
		expect(
			[r[0], r[1], r[2], r[3]].map((x) => Math.round(x * 1e6) / 1e6 + 0),
		).toEqual([0, 0, -0.707107, 0.707107]);
		const doc = new GltfDocument();
		doc.addSkeleton(s);
		const glb = doc.toGlb();
		expect((await validate(glb)).issues).toEqual([]);
		const model = parseGLB(glb);
		const skin = model.skins![0]!;
		const names = skin.joints.map((j) => model.nodes![j]!.name);
		// Each inverse bind matrix takes its joint's rest position to the origin.
		names.forEach((n, i) => {
			const at = s.joint(n).at;
			const m = skin.inverseBindMatrices;
			for (let r = 0; r < 3; r++)
				expect(
					m[i * 16 + r]! * at[0] +
						m[i * 16 + 4 + r]! * at[1] +
						m[i * 16 + 8 + r]! * at[2] +
						m[i * 16 + 12 + r]!,
				).toBeCloseTo(0, 5);
		});
		// The hand's node holds no extra turn: it rests as its parent does.
		const hand = model.nodes![skin.joints[names.indexOf("LeftHand")]!]!;
		expect(hand.rotation ?? [0, 0, 0, 1]).toEqual(
			[0, 0, 0, 1].map((v) => expect.closeTo(v, 9)),
		);
		expect(hand.translation?.[0]).toBeCloseTo(8, 6);
	});

	it("writes a skeleton with its bone gizmo as a valid skinned GLB", async () => {
		const skeleton = humanoidSkeleton();
		const doc = new GltfDocument();
		const rig = doc.addSkeleton(skeleton);
		const bones = doc.addMesh({
			name: "Bones",
			primitives: [boneGizmo(skeleton)],
		});
		doc.addNode({ name: "Gizmo", mesh: bones, skin: rig.skin });
		const glb = doc.toGlb();
		const report = await validate(glb);
		expect(report.issues).toEqual([]);
		const model = parseGLB(glb);
		expect(model.skins![0]!.joints).toHaveLength(skeleton.joints.length);
	});
});
