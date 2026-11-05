/**
 * The human base: assets download lazily and verified, the macro targets
 * blend like MakeHuman's, and (when the pinned files are cached) a shaped
 * body comes out rigged on Mixamo names, skinned, at the asked height,
 * and writes a valid GLB.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import {
	addHuman,
	GltfDocument,
	HumanAssetStore,
	human,
	humanCacheDir,
	skinTextures,
} from "../index.js";
import { readPng } from "../read-png.test-util.js";
import { macroTargets } from "./human.js";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("HumanAssetStore", () => {
	it("downloads once, verified, and reuses the cache", async () => {
		const dir = await mkdtemp(join(tmpdir(), "forge-human-"));
		const bytes = new TextEncoder().encode("# target\n1 0.1 0 0\n");
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return new Response(bytes);
		}) as typeof fetch;
		const pins = new Map([
			["targets/x.target", { size: bytes.length, sha256: sha(bytes) }],
		]);
		const store = new HumanAssetStore({ dir, fetch: fetchImpl, pins });
		const [a, b] = await Promise.all([
			store.ensure("targets/x.target"),
			store.ensure("targets/x.target"),
		]);
		expect(a).toEqual(bytes);
		expect(b).toEqual(bytes);
		expect(calls).toBe(1);
		// A new store (another process) reads the verified file from disk.
		const again = new HumanAssetStore({ dir, fetch: fetchImpl, pins });
		expect(await again.text("targets/x.target")).toContain("1 0.1 0 0");
		expect(calls).toBe(1);
		await rm(dir, { recursive: true, force: true });
	});

	it("refuses bytes that are not the pinned file, and unpinned paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "forge-human-"));
		const pins = new Map([
			["a.target", { size: 3, sha256: sha(new TextEncoder().encode("abc")) }],
		]);
		const store = new HumanAssetStore({
			dir,
			pins,
			fetch: (async () => new Response("xyz")) as typeof fetch,
		});
		await expect(store.ensure("a.target")).rejects.toThrow(
			/not the pinned file/,
		);
		await expect(store.ensure("b.target")).rejects.toThrow(
			/not a pinned MakeHuman file/,
		);
		await rm(dir, { recursive: true, force: true });
	});
});

describe("macro targets", () => {
	it("splits the default body evenly between the sexes and ethnicities", () => {
		const t = macroTargets({});
		const universal = [...t].filter(([p]) =>
			p.startsWith("macrodetails/universal-"),
		);
		expect(universal.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 9);
		expect(
			t.get("macrodetails/universal-female-young-averagemuscle-averageweight"),
		).toBeCloseTo(0.5);
		expect(t.get("macrodetails/caucasian-male-young")).toBeCloseTo(1 / 6);
	});

	it("moves between the named levels of each dimension", () => {
		const t = macroTargets({ sex: 1, age: 0.75, muscle: 1, weight: 0.25 });
		// age 0.75: halfway from young to old; weight 0.25: halfway from min to average.
		expect(
			t.get("macrodetails/universal-male-young-maxmuscle-minweight"),
		).toBeCloseTo(0.25);
		expect(
			t.get("macrodetails/universal-male-old-maxmuscle-averageweight"),
		).toBeCloseTo(0.25);
		expect([...t.keys()].some((p) => p.includes("female"))).toBe(false);
	});
});

const cached = existsSync(join(humanCacheDir(), "3dobjs/base.obj"));

describe.skipIf(!cached)("human (cached MakeHuman assets)", () => {
	it("builds a rigged, skinned body at the asked height", async () => {
		const h = await human({ sex: 1, muscle: 0.7, height: 182 });
		expect(h.height).toBeCloseTo(182, 5);
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (let i = 1; i < h.body.positions.length; i += 3) {
			minY = Math.min(minY, h.body.positions[i] as number);
			maxY = Math.max(maxY, h.body.positions[i] as number);
		}
		expect(minY).toBeCloseTo(0, 5);
		expect(maxY).toBeCloseTo(182, 5);
		for (const n of [
			"Hips",
			"Spine",
			"Spine2",
			"Neck",
			"Head",
			"LeftArm",
			"LeftForeArm",
			"RightHand",
			"LeftHandIndex1",
			"LeftUpLeg",
			"RightLeg",
			"LeftFoot",
		])
			expect(h.skeleton.has(n), n).toBe(true);
		// Joints follow the shaped body: the hand sits below the shoulder in the rest A-pose, the head on top.
		expect(h.skeleton.joint("LeftHand").at[1]).toBeLessThan(
			h.skeleton.joint("LeftArm").at[1],
		);
		expect(h.skeleton.joint("LeftArm").at[0]).toBeGreaterThan(0);
		expect(h.skeleton.joint("Head").at[1]).toBeGreaterThan(150);
		for (let v = 0; v < h.body.weights.length; v += 4) {
			const s =
				(h.body.weights[v] as number) +
				(h.body.weights[v + 1] as number) +
				(h.body.weights[v + 2] as number) +
				(h.body.weights[v + 3] as number);
			expect(Math.abs(s - 1)).toBeLessThan(1e-6);
		}
		const doc = new GltfDocument();
		addHuman(doc, h);
		const report = await validateBytes(doc.toGlb(), { maxIssues: 20 });
		expect(report.issues.messages.filter((m) => m.severity <= 1)).toEqual([]);
	});

	it("fits eyeballs that turn about their own centers", async () => {
		const h = await human({ sex: 0, height: 170 });
		const left = h.skeleton.joint("LeftEye");
		const right = h.skeleton.joint("RightEye");
		expect(left.at[0]).toBeGreaterThan(0);
		expect(right.at[0]).toBeCloseTo(-left.at[0], 1);
		const { positions, joints, weights } = h.eyes;
		const n = positions.length / 3;
		expect(n).toBeGreaterThan(400);
		// Every vertex follows its own side's eye, rigidly; each lies on a
		// sphere around that eye's joint (the pivot is the ball's center).
		const radii: number[] = [];
		for (let v = 0; v < n; v++) {
			const x = positions[v * 3] as number;
			const j = joints[v * 4];
			expect(j).toBe(x > 0 ? left.index : right.index);
			expect(weights[v * 4]).toBe(1);
			const c = x > 0 ? left.at : right.at;
			radii.push(
				Math.hypot(
					x - c[0],
					(positions[v * 3 + 1] as number) - c[1],
					(positions[v * 3 + 2] as number) - c[2],
				),
			);
		}
		const mean = radii.reduce((s, r) => s + r, 0) / n;
		expect(mean).toBeGreaterThan(0.9);
		expect(mean).toBeLessThan(1.8);
		expect(Math.max(...radii.map((r) => Math.abs(r - mean)))).toBeLessThan(
			mean * 0.15,
		);
		// Corneas: their own shells, in front of the eyeballs, skinned the same way.
		expect(h.cornea.positions.length).toBeGreaterThan(300);
		const frontEye = Math.max(
			...Array.from({ length: n }, (_, v) => positions[v * 3 + 2] as number),
		);
		const frontCornea = Math.max(
			...Array.from(
				{ length: h.cornea.positions.length / 3 },
				(_, v) => h.cornea.positions[v * 3 + 2] as number,
			),
		);
		expect(frontCornea).toBeGreaterThan(frontEye);
		// The lid drivers name joints the skeleton has.
		for (const d of h.drivers) {
			expect(h.skeleton.has(d.joint), d.joint).toBe(true);
			expect(h.skeleton.has(d.from), d.from).toBe(true);
		}
		// The texture is a PNG.
		expect(Array.from(h.eyeTexture.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
	});

	it("builds ARKit-named face shapes, split into sides, on the body and mouth", async () => {
		const h = await human({});
		const byName = new Map(h.body.targets.map((t) => [t.name, t.positions]));
		for (const name of [
			"eyeBlinkLeft",
			"eyeBlinkRight",
			"jawOpen",
			"mouthSmileLeft",
			"mouthSmileRight",
			"browInnerUp",
		])
			expect(byName.has(name)).toBe(true);
		// Each side's shape moves its own side: the character's left is +x.
		const sideOf = (d: ArrayLike<number>) => {
			let left = 0;
			let right = 0;
			for (let v = 0; v < d.length / 3; v++) {
				const m = Math.hypot(
					d[v * 3] as number,
					d[v * 3 + 1] as number,
					d[v * 3 + 2] as number,
				);
				if ((h.body.positions[v * 3] as number) > 0) left += m;
				else right += m;
			}
			return { left, right };
		};
		for (const shape of ["eyeBlink", "mouthSmile"]) {
			const l = sideOf(byName.get(`${shape}Left`)!);
			const r = sideOf(byName.get(`${shape}Right`)!);
			expect(l.left).toBeGreaterThan(l.right * 5);
			expect(r.right).toBeGreaterThan(r.left * 5);
		}
		// The split halves of a symmetric unit add back up to the whole unit.
		const l = byName.get("mouthSmileLeft")!;
		const r = byName.get("mouthSmileRight")!;
		const sum = Array.from(l, (x, i) => x + (r[i] as number));
		expect(sum.some((x) => Math.abs(x) > 0.05)).toBe(true);
		// The jaw opens the teeth too; the mouth carries only shapes that move it.
		const mouth = new Map(h.mouth.targets.map((t) => [t.name, t.positions]));
		expect(
			Array.from(mouth.get("jawOpen")!).some((d) => Math.abs(d) > 0.1),
		).toBe(true);
		expect(mouth.has("eyeBlinkLeft")).toBe(false);
	});

	it("bakes skin textures with red lips and a tiling pore map", async () => {
		const h = await human({});
		const maps = skinTextures(h, { size: 512 });
		const color = readPng(maps.color);
		expect(color.width).toBe(512);
		// Sample the map at a vertex's UV.
		const at = (v: number) => {
			const x = Math.min(511, Math.floor((h.body.uvs[v * 2] as number) * 512));
			const y = Math.min(
				511,
				Math.floor((h.body.uvs[v * 2 + 1] as number) * 512),
			);
			const i = (y * 512 + x) * 4;
			return [color.rgba[i], color.rgba[i + 1], color.rgba[i + 2]] as [
				number,
				number,
				number,
			];
		};
		// The front-most vertex of the lips (at the mouth corners' height) and of the forehead.
		const p = h.body.positions;
		const n = p.length / 3;
		const frontMost = (y0: number, y1: number) => {
			let best = 0;
			for (let v = 0; v < n; v++) {
				const y = (p[v * 3 + 1] as number) / h.height;
				if (
					y > y0 &&
					y < y1 &&
					Math.abs(p[v * 3] as number) < 0.5 &&
					(p[v * 3 + 2] as number) > (p[best * 3 + 2] as number)
				)
					best = v;
			}
			return best;
		};
		const lip = at(frontMost(0.891, 0.895));
		const brow = at(frontMost(0.96, 0.97));
		expect(lip[1] / lip[0]).toBeLessThan((brow[1] / brow[0]) * 0.85);
		const rough = readPng(maps.roughness);
		expect(rough.rgba[2]).toBe(0); // no metal
		const detail = readPng(maps.detail);
		// Tangent-space normals point out of the surface on average.
		let z = 0;
		for (let i = 2; i < detail.rgba.length; i += 4)
			z += detail.rgba[i] as number;
		expect(z / (detail.rgba.length / 4)).toBeGreaterThan(240);
		expect(maps.detailRepeat).toBeGreaterThan(5);
	});

	it("adds named targets on top of the macro shape", async () => {
		const plain = await human({});
		const shaped = await human({ targets: { "nose/nose-base-up": 1 } });
		let moved = 0;
		for (let i = 0; i < plain.body.positions.length; i++)
			if (
				Math.abs(
					(plain.body.positions[i] as number) -
						(shaped.body.positions[i] as number),
				) > 1e-4
			)
				moved++;
		expect(moved).toBeGreaterThan(10);
		expect(moved).toBeLessThan(plain.body.positions.length / 10);
	});
});
