import path from "node:path";
import { fileURLToPath } from "node:url";
import { audioRegistry, webgpuRegistry } from "@gitframes/node-sdk";
import { describe, expect, it } from "vitest";
import {
	discoverAndRegisterNodeRenderers,
	findNodesDir,
} from "../dynamic-node-discovery.js";
import {
	loadNodeManifests,
	NODE_KINDS,
	NodeManifestError,
	parseNodeManifest,
} from "../node-manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const nodesDir = findNodesDir(here);

describe("node manifests (package.json `gitframes` block)", () => {
	it("locates the workspace nodes directory", () => {
		expect(nodesDir).toBeTruthy();
	});

	it("every node declares a valid, unique op and kind", () => {
		// Throws NodeManifestError listing every offender if any node is missing
		// its block, has a malformed one, or reuses an op/alias.
		const manifests = loadNodeManifests(nodesDir as string);
		expect(manifests.length).toBeGreaterThan(0);
		for (const manifest of manifests) {
			expect(manifest.type, manifest.dir).toMatch(/^[A-Z][A-Za-z0-9]*$/);
			expect(NODE_KINDS, manifest.dir).toContain(manifest.kind);
		}
	});

	it("declares the ops that name derivation used to get wrong", () => {
		const byDir = new Map(
			loadNodeManifests(nodesDir as string).map((m) => [m.dir, m]),
		);
		expect(byDir.get("node-apply-lut")?.type).toBe("ApplyLUT");
		expect(byDir.get("node-colorkey")?.type).toBe("ColorKey");
		expect(byDir.get("node-kenburns")?.type).toBe("KenBurns");
		expect(byDir.get("node-camera-parallax-3d")?.type).toBe("CameraParallax3D");
		expect(byDir.get("node-procedural-vfx")?.type).toBe("ProceduralVFX");
		expect(byDir.get("node-refraction-caustics")?.type).toBe(
			"RefractionCaustics3D",
		);
		expect(byDir.get("node-extract-lut")?.type).toBe("ExtractLUT");
		expect(byDir.get("node-yolo")?.aliases).toEqual(["MediaPipe"]);
		expect(byDir.get("node-deflicker")?.aliases).toEqual(["Deflicker"]);
	});

	it("a renderer's own op literal agrees with its declared op", async () => {
		const fs = await import("node:fs");
		const mismatches: string[] = [];
		for (const manifest of loadNodeManifests(nodesDir as string)) {
			const file = path.join(
				manifest.path,
				"src",
				"renderers",
				"webgpu-renderer.ts",
			);
			if (!fs.existsSync(file)) continue;
			// Every op literal the renderer compares against, e.g. the opening
			// guard `if (op?.op !== "X") return;`.
			const accepted = [
				...fs.readFileSync(file, "utf-8").matchAll(/\.op\s*[!=]==\s*"(\w+)"/g),
			].map((m) => m[1]);
			if (accepted.length === 0) continue;
			const declared = [manifest.type, ...manifest.aliases];
			if (!accepted.includes(manifest.type)) {
				mismatches.push(
					`${manifest.dir}: declares ${declared.join("/")} but its renderer accepts ${accepted.join("/")}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});
});

describe("parseNodeManifest", () => {
	it("rejects a package with no gitframes block", () => {
		const { manifest, problems } = parseNodeManifest(
			{ name: "@gitframes/node-x" },
			"node-x",
		);
		expect(manifest).toBeUndefined();
		expect(problems[0]).toContain('no "gitframes" block');
	});

	it("rejects a missing type and an unknown kind", () => {
		const { manifest, problems } = parseNodeManifest(
			{ gitframes: { kind: "filter" } },
			"node-x",
		);
		expect(manifest).toBeUndefined();
		expect(problems).toHaveLength(2);
	});

	it("does not derive an op from the package name", () => {
		const { manifest } = parseNodeManifest(
			{ name: "@gitframes/node-lut", gitframes: { kind: "effect" } },
			"node-apply-lut",
		);
		expect(manifest).toBeUndefined();
	});

	it("reads optional fields and the legacy opt-out", () => {
		const { manifest, problems } = parseNodeManifest(
			{
				name: "@gitframes/node-x",
				gatewai: { enabled: false },
				exports: { "./renderer": { development: "./src/renderers/index.ts" } },
				gitframes: {
					type: "ApplyLUT",
					kind: "effect",
					aliases: ["Lut"],
					schema: "LutNodeConfigSchema",
					factory: "applyLut",
					custom: true,
				},
			},
			"node-x",
		);
		expect(problems).toEqual([]);
		expect(manifest).toMatchObject({
			type: "ApplyLUT",
			kind: "effect",
			aliases: ["Lut"],
			schema: "LutNodeConfigSchema",
			factory: "applyLut",
			custom: true,
			enabled: false,
			rendererExports: { development: "./src/renderers/index.ts" },
		});
	});

	it("NodeManifestError lists every problem", () => {
		const error = new NodeManifestError(["a: bad", "b: bad"]);
		expect(error.message).toContain("a: bad");
		expect(error.message).toContain("b: bad");
		expect(error.problems).toHaveLength(2);
	});
});

describe("discoverAndRegisterNodeRenderers", () => {
	it("registers declared ops and aliases, and no derived names", async () => {
		await discoverAndRegisterNodeRenderers();

		for (const op of [
			"ApplyLUT",
			"ColorKey",
			"KenBurns",
			"CameraParallax3D",
			"RefractionCaustics3D",
			"ExtractLUT",
			"Blur",
			"Vignette",
			"ColorBalance",
			"Yolo",
			"MediaPipe",
			"TemporalDeflicker",
			"Deflicker",
			"Relight3D",
		]) {
			expect(webgpuRegistry.has(op), op).toBe(true);
		}

		// Names the old PascalCase derivation produced. Nothing renders them.
		for (const op of [
			"Lut",
			"Colorkey",
			"Kenburns",
			"CameraParallax3d",
			"RefractionCaustics",
			"ExtractLut",
			"Relight3d",
		]) {
			expect(webgpuRegistry.has(op), op).toBe(false);
		}

		// Disabled packages are not registered.
		expect(webgpuRegistry.has("ProceduralVFX")).toBe(false);

		expect(audioRegistry.get("AudioCompressor")).not.toBeNull();
		expect(audioRegistry.get("StereoPanning")).not.toBeNull();
	}, 60_000);
});
