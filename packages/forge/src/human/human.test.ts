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
	GltfDocument,
	HumanAssetStore,
	human,
	humanCacheDir,
} from "../index.js";
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
		const rig = doc.addSkeleton(h.skeleton);
		doc.addNode({
			mesh: doc.addMesh({ primitives: [h.body] }),
			skin: rig.skin,
		});
		const report = await validateBytes(doc.toGlb(), { maxIssues: 20 });
		expect(report.issues.messages.filter((m) => m.severity <= 1)).toEqual([]);
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
