/**
 * Recreate-as-program: the scene's own document scores perfect, a moved
 * object lower, and answers outside the format are refused with a reason.
 */
import { describe, expect, it } from "vitest";
import { scenario } from "./sampler.js";
import { scoreRecreateProgram } from "./tasks/recreate-program.js";

const env = scenario({
	name: "probe",
	description: "",
	clip: { frames: 4, width: 320, height: 240 },
	motion: "still",
	// Pattern textures are shader layers (code): leave them out.
	objects: { count: 4, textured: 0 },
	floor: { textured: 0 },
});

/** A still scene and its layout as program data, camera left out. */
async function stillView(seed: number) {
	const params = env.params(seed);
	const [view] = await env.build(params);
	const layout = view.composition
		.toProgram()
		.layout.filter((n) => n.kind !== "camera");
	return { view, layout };
}

describe("recreate as a program", () => {
	it("scores the scene's own document perfect and a moved object lower", async () => {
		const { view, layout } = await stillView(4);
		const exact = await scoreRecreateProgram(view, { layout }, 0);
		expect(exact.iou).toBe(1);
		expect(exact.psnr).toBe(99);
		expect(exact.ssim).toBe(1);

		const moved = structuredClone(layout);
		const obj = moved.find((n) => n.id === "obj0") as { x: number };
		obj.x += 80;
		const off = await scoreRecreateProgram(view, { layout: moved }, 0);
		expect(off.iou).toBeLessThan(1);
		expect(off.iou).toBeGreaterThan(0.3);
		expect(off.ssim).toBeLessThan(1);
	});

	it("reports lint findings for a scene without light", async () => {
		const { view, layout } = await stillView(4);
		const dark = layout.filter((n) => n.kind === "model3d");
		const score = await scoreRecreateProgram(view, { layout: dark }, 0);
		expect(score.lint.length).toBeGreaterThan(0);
	});

	it("refuses answers outside the format", async () => {
		const { view } = await stillView(4);
		await expect(
			scoreRecreateProgram(view, { layout: [{ id: "c", kind: "camera" }] }, 0),
		).rejects.toThrow("the camera is given");
		await expect(
			scoreRecreateProgram(view, { objects: [] }, 0),
		).rejects.toThrow("1 to 64 nodes");
		await expect(
			scoreRecreateProgram(
				view,
				{ layout: [{ id: "m", kind: "model3d", modelData: { meshes: [] } }] },
				0,
			),
		).rejects.toThrow('describe a solid with "primitive3d"');
		await expect(
			scoreRecreateProgram(
				view,
				{
					layout: [
						{ id: "a", kind: "model3d" },
						{ id: "a", kind: "light" },
					],
				},
				0,
			),
		).rejects.toThrow("E1202");
	});
});
