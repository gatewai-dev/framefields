import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { signal } from "@framefields/core";
import { findNodesDir, loadNodeManifests } from "@framefields/renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as effects from "./index.js";
import { withDefaults } from "./with-defaults.js";

/**
 * Guardrails for the generated authoring surface (spec/sync-node.md §9).
 *
 * A node is "migrated" once its package.json names a `framefields.schema`; its
 * class then comes from `scripts/generate-effects.mts`.
 */
const nodesDir = findNodesDir(import.meta.dirname) as string;
const repoRoot = path.dirname(nodesDir);
const authoringNodes = loadNodeManifests(nodesDir).filter(
	(m) => m.kind === "effect" || m.kind === "audio",
);
const migrated = authoringNodes.filter((m) => m.schema);

/**
 * Effect and audio nodes that do not have a generated class yet. This list
 * may only shrink: a new node must declare `framefields.schema` instead of being
 * added here. It is empty once Phase 4 of the spec is done.
 */
const NOT_YET_MIGRATED = [
	"node-apply-lut",
	"node-audio-compressor",
	"node-audio-delay",
	"node-audio-fade",
	"node-audio-noise-gate",
	"node-audio-parametric-eq",
	"node-audio-reverb",
	"node-audio-signal-extractor",
	"node-camera-parallax-3d",
	"node-channel-merger",
	"node-channel-splitter",
	"node-corner-pin",
	"node-crop",
	"node-curves",
	"node-deflicker",
	"node-displacement-map",
	"node-extract-lut",
	"node-film-grain",
	"node-flip",
	"node-gradient-map",
	"node-halftone-screen",
	"node-high-pass",
	"node-kenburns",
	"node-layer-style",
	"node-levels",
	"node-liquify",
	"node-mask-math",
	"node-mesh-warp",
	"node-modulate",
	"node-noise-generator",
	"node-paint",
	"node-patch-heal",
	"node-procedural-vfx",
	"node-refine-edge",
	"node-refraction-caustics",
	"node-relight-3d",
	"node-resizer-scaler",
	"node-selective-color",
	"node-shadows-highlights",
	"node-stereo-panning",
	"node-tile-offset",
	"node-unsharp-mask",
	"node-vision",
];

const exported = effects as unknown as Record<string, unknown>;
type EffectClass = new (
	config?: Record<string, unknown>,
) => {
	op: string;
	config: Record<string, unknown>;
	resolveUniforms: (ctx?: never) => Record<string, unknown>;
};

describe("generated effects: coverage", () => {
	it("found the workspace nodes", () => {
		expect(migrated.length).toBeGreaterThan(0);
	});

	it("every effect/audio node is generated or explicitly pending", () => {
		const pending = authoringNodes.filter((m) => !m.schema).map((m) => m.dir);
		expect(pending).toEqual(NOT_YET_MIGRATED);
	});

	it("generated files are current", () => {
		const run = () =>
			execFileSync(
				process.execPath,
				[
					"--conditions",
					"development",
					"--import",
					"tsx",
					"scripts/generate-effects.mts",
					"--check",
				],
				{ cwd: repoRoot, encoding: "utf-8", stdio: "pipe" },
			);
		expect(run).not.toThrow();
	}, 60_000);
});

describe.each(
	migrated.map((m) => [m.dir, m] as const),
)("generated effect for %s", (_dir, manifest) => {
	const className = manifest.className ?? manifest.type;
	const factory =
		manifest.factory ?? className.charAt(0).toLowerCase() + className.slice(1);
	const Class = exported[className] as EffectClass;

	it("exports a class whose op is the declared op", () => {
		expect(Class, `${className} is not exported from effects`).toBeTypeOf(
			"function",
		);
		expect(new Class().op).toBe(manifest.type);
	});

	it("has a factory and prop metadata", () => {
		const factories = effects.effectFactories as Record<string, unknown>;
		expect(factories[factory]).toBeTypeOf("function");
		expect(
			(effects.effectMeta as Record<string, unknown>)[className],
		).toBeDefined();
	});

	it("class defaults equal the schema defaults", async () => {
		const mod = (await import(
			pathToFileURL(path.join(manifest.path, "src", "shared", "config.ts")).href
		)) as Record<
			string,
			{
				safeParse: (v: unknown) => {
					success: boolean;
					data?: Record<string, unknown>;
				};
			}
		>;
		const parsed = mod[manifest.schema as string].safeParse({});
		// A schema with required fields has no all-defaults value to compare.
		if (!parsed.success) return;
		const uniforms = new Class().resolveUniforms();
		for (const [key, value] of Object.entries(uniforms)) {
			expect(value, `${className}.${key}`).toEqual(parsed.data?.[key]);
		}
	});

	it("a hand-written subclass exists exactly when declared", () => {
		const file = path.join(
			import.meta.dirname,
			"custom",
			`${manifest.dir.replace(/^node-/, "")}.ts`,
		);
		expect(fs.existsSync(file)).toBe(manifest.custom);
	});
});

describe("withDefaults", () => {
	const meta = {
		strength: { min: 0, max: 100 },
		mode: { enum: ["a", "b"] },
		tone: { props: { red: { min: -1, max: 1 }, blue: { min: -1, max: 1 } } },
	} as const;
	const defaults = { strength: 5, mode: "a", tone: { red: 0, blue: 0 } };
	type Props = {
		strength?: unknown;
		mode?: string;
		tone?: { red?: number; blue?: number };
		[key: string]: unknown;
	};
	const build = (config: Props) =>
		withDefaults<Props>("Test", defaults, config, meta);

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("fills defaults and lets supplied values win", () => {
		expect(build({ strength: 10 })).toEqual({
			strength: 10,
			mode: "a",
			tone: { red: 0, blue: 0 },
		});
	});

	it("an explicit undefined keeps the default", () => {
		expect(build({ strength: undefined }).strength).toBe(5);
	});

	it("merges object props one level deep", () => {
		expect(build({ tone: { red: 0.5 } }).tone).toEqual({ red: 0.5, blue: 0 });
	});

	it("clones object defaults per call", () => {
		const first = build({});
		(first.tone as { red: number }).red = 1;
		expect(build({}).tone).toEqual({ red: 0, blue: 0 });
		expect(defaults.tone.red).toBe(0);
	});

	it("passes signals through untouched and does not range-check them", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const strength = signal(500);
		expect(build({ strength }).strength).toBe(strength);
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns once about an unknown prop and still passes it through", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(build({ strenght: 3 }).strenght).toBe(3);
		build({ strenght: 3 });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain(
			'Test: unknown prop "strenght". Did you mean "strength"?',
		);
	});

	it("strict mode throws on unknown props, ranges and enum values", () => {
		vi.stubEnv("FRAMEFIELDS_STRICT_PROPS", "1");
		expect(() => build({ blurRadius: 3 })).toThrow(/unknown prop "blurRadius"/);
		expect(() => build({ strength: 500 })).toThrow(
			"Test.strength = 500 is outside 0 to 100",
		);
		expect(() => build({ mode: "c" })).toThrow(/is not one of "a", "b"/);
		expect(() => build({ tone: { red: 4 } })).toThrow(
			"Test.tone.red = 4 is outside -1 to 1",
		);
		expect(() => build({ strength: 100, mode: "b" })).not.toThrow();
	});

	it("checks are skipped in production unless strict", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("NODE_ENV", "production");
		build({ nope: 1, strength: 999 });
		expect(warn).not.toHaveBeenCalled();
		vi.stubEnv("FRAMEFIELDS_STRICT_PROPS", "1");
		expect(() => build({ nope: 1 })).toThrow();
	});
});

describe("generated classes: behavior", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("an explicit undefined prop keeps the class default", () => {
		expect(new effects.Vignette({ strength: undefined }).strength).toBe(50);
	});

	it("strict mode reports a misspelt prop with a suggestion", () => {
		vi.stubEnv("FRAMEFIELDS_STRICT_PROPS", "1");
		expect(
			() => new effects.Blur({ blurRadius: 12 } as effects.BlurProps),
		).toThrow('Blur: unknown prop "blurRadius". Did you mean "radius"?');
		expect(() => new effects.Vignette({ strength: 500 })).toThrow(
			"Vignette.strength = 500 is outside 0 to 100",
		);
	});

	it("Blur accepts `track` in strict mode (handled by the custom subclass)", () => {
		vi.stubEnv("FRAMEFIELDS_STRICT_PROPS", "1");
		const scaled = { multiply: (factor: number) => signal(0.2 * factor) };
		const track = {
			center: { x: signal(0.4), y: signal(0.6) },
			bounds: { width: scaled, height: scaled },
			active: { multiply: (factor: number) => signal(factor) },
		} as unknown as effects.BlurProps["track"];
		const blur = new effects.Blur({ track, shape: "rect" });
		expect(blur.partialBlur).toBe(true);
		expect(blur.centerX).toBeCloseTo(0.4);
		expect(blur.shape).toBe("rect");
		expect("track" in blur.config).toBe(false);
	});

	it("Effect.* helpers build the same classes", () => {
		expect(effects.effectFactories.blur({ strength: 9 })).toBeInstanceOf(
			effects.Blur,
		);
		expect(effects.effectFactories.vignette().op).toBe("Vignette");
		expect(effects.effectFactories.colorBalance().op).toBe("ColorBalance");
	});
});
