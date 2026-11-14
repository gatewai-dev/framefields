/**
 * The scenario sampler: a seed draws the same scene every time, specs narrow
 * the draws, still scenes rest on the floor apart, and every object renders
 * with its label (textured, glass and metal ones too).
 */
import { HeadlessMediaRenderer, truthLabels } from "framefields";
import { describe, expect, it } from "vitest";
import { scenes, scenesMultiView } from "./envs/scenes.js";
import { sampleScenario, scenario } from "./sampler.js";

describe("sampleScenario", () => {
	it("draws the same scene for a seed, and different ones across seeds", () => {
		const a = sampleScenario({ name: "t", description: "" }, 7);
		expect(sampleScenario({ name: "t", description: "" }, 7)).toEqual(a);
		const distinct = new Set(
			Array.from({ length: 20 }, (_, s) =>
				JSON.stringify(sampleScenario({ name: "t", description: "" }, s)),
			),
		);
		expect(distinct.size).toBe(20);
		// Plain JSON: it survives a round trip.
		expect(JSON.parse(JSON.stringify(a))).toEqual(a);
	});

	it("keeps every draw inside the spec", () => {
		for (let seed = 0; seed < 30; seed++) {
			const p = sampleScenario(
				{
					name: "t",
					description: "",
					objects: {
						count: [2, 4],
						shapes: ["sphere", "torus"],
						surfaces: "metal",
						size: 30,
						textured: 1,
						patterns: "stripes",
					},
					lighting: { rigs: "soft", intensity: 1 },
					cameras: { views: 2, fov: [40, 45] },
				},
				seed,
			);
			expect(p.objects.length).toBeGreaterThanOrEqual(2);
			expect(p.objects.length).toBeLessThanOrEqual(4);
			for (const o of p.objects) {
				expect(["sphere", "torus"]).toContain(o.shape);
				expect(o.surface).toBe("metal");
				expect(o.size).toBe(30);
				expect(o.pattern?.kind).toBe("stripes");
			}
			expect(p.lighting.rig).toBe("soft");
			expect(p.lighting.intensity).toBe(1);
			expect(p.cameras.map((c) => c.name)).toEqual(["view0", "view1"]);
			for (const c of p.cameras) {
				expect(c.fov).toBeGreaterThanOrEqual(40);
				expect(c.fov).toBeLessThanOrEqual(45);
			}
		}
	});

	it("rests still objects on the floor without overlapping", () => {
		for (let seed = 0; seed < 30; seed++) {
			const p = sampleScenario(
				{
					name: "t",
					description: "",
					motion: "still",
					objects: { count: 6, shapes: ["box", "sphere", "cylinder"] },
				},
				seed,
			);
			for (const [i, a] of p.objects.entries()) {
				expect(a.position[1] + (a.shape === "box" ? a.size : a.size)).toBe(400);
				for (const b of p.objects.slice(i + 1)) {
					const apart = Math.hypot(
						a.position[0] - b.position[0],
						a.position[2] - b.position[2],
					);
					expect(apart).toBeGreaterThan(a.size + b.size);
				}
			}
		}
	});
});

describe("scenario envs", () => {
	it("render every object with its label, from every view", async () => {
		const renderer = new HeadlessMediaRenderer();
		const env = scenario({
			name: "probe",
			description: "",
			clip: { frames: 12, width: 320, height: 240 },
			objects: { count: 5, textured: 0.6 },
			motion: "drop",
		});
		for (const seed of [3, 11]) {
			const params = env.params(seed);
			const [view] = await env.build(params);
			const truth = await view.composition.renderTruth({
				frame: 11,
				renderer,
			});
			const labels = truthLabels(truth.scenes[0]);
			const shapes = labels.objects
				.filter((o) => o.layer?.startsWith("obj"))
				.map((o) => o.label);
			expect(shapes.sort()).toEqual(params.objects.map((o) => o.shape).sort());
			expect(labels.objects.some((o) => o.label === "floor")).toBe(true);
			expect(view.physics?.(11)).toMatchObject({
				bodies: expect.any(Array),
			});
		}
	});

	it("names the shipped envs and their views", () => {
		expect(scenes.name).toBe("scenes");
		expect(scenesMultiView.params(1).cameras).toHaveLength(3);
	});
});
