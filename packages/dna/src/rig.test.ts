/**
 * The rig evaluator matches Epic's RigLogic (scalar, full precision) on the
 * oracle character: for 48 seeded random control sets, alternating GUI and
 * raw controls and cycling the LODs, every raw control, PSD, joint
 * attribute, blend shape weight and animated map equals RigLogic's
 * (`fixtures/oracle-eval.json`). Evaluation is stateless: any order of
 * frames gives the same outputs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RigEvaluator, readDna } from "./index.js";

const dna = readDna(
	new Uint8Array(
		readFileSync(new URL("../fixtures/oracle.dna", import.meta.url)),
	),
);
const cases: {
	lod: number;
	gui?: number[];
	raw?: number[];
	/** The arm's and forearm's rotations (raw controls 3 … 10), set after any GUI mapping. */
	quats: number[];
	rawControls: number[];
	rbfControls: number[];
	psdControls: number[];
	joints: number[];
	blendShapes: number[];
	animatedMaps: number[];
}[] = JSON.parse(
	readFileSync(
		new URL("../fixtures/oracle-eval.json", import.meta.url),
		"utf8",
	),
);

/**
 * Equal up to float32 rounding: RigLogic works in float32, we in float64.
 * Face controls, PSDs, blend shapes and maps agree to 1e-6; RBF weights and
 * twist/swing angles pass through acos and atan, which amplify float32
 * rounding (worst case 1.4e-5). The fixture's arm solver has two poses
 * close together, so its interpolation matrix is ill-conditioned and
 * RigLogic's float32 inversion lands up to 1.2e-4 from the float64 one: RBF
 * controls and the joints they move get 2e-4. Every behavior change tried
 * against this test (normalization, interpolation clamp, automatic radius,
 * swing split, kernel, slerp direction, twist inversion) misses by far more.
 */
const close = (
	actual: ArrayLike<number>,
	expected: number[],
	tolerance = 1e-6,
) => {
	expect(actual.length).toBe(expected.length);
	for (let i = 0; i < expected.length; i++)
		expect(
			Math.abs((actual[i] as number) - (expected[i] as number)),
		).toBeLessThanOrEqual(
			tolerance * Math.max(1, Math.abs(expected[i] as number)),
		);
};

function run(rig: RigEvaluator, c: (typeof cases)[number]) {
	rig.lod = c.lod;
	if (c.gui) {
		rig.guiControls.set(c.gui);
		rig.mapGuiToRaw();
	} else rig.inputs.set(c.raw ?? [], 0);
	rig.inputs.set(c.quats, 3);
	rig.calculate();
}

describe("RigEvaluator against RigLogic", () => {
	it("matches every output for random GUI and raw controls at every LOD", () => {
		const rig = new RigEvaluator(dna);
		expect(cases.length).toBe(48);
		for (const c of cases) {
			run(rig, c);
			const raw = rig.inputs.subarray(0, rig.rawControlNames.length);
			close(raw, c.rawControls);
			close(
				rig.inputs.subarray(raw.length, raw.length + c.psdControls.length),
				c.psdControls,
			);
			close(
				rig.inputs.subarray(rig.inputs.length - rig.rbfControlNames.length),
				c.rbfControls,
				2e-4,
			);
			close(rig.jointOutputs, c.joints, 2e-4);
			close(rig.blendShapeOutputs, c.blendShapes);
			close(rig.animatedMapOutputs, c.animatedMaps);
		}
		// Something moved: the fixture exercises joints, PSDs and maps.
		expect(cases.some((c) => c.joints.some((v) => v !== 0))).toBe(true);
		expect(cases.some((c) => c.psdControls.some((v) => v > 0))).toBe(true);
		expect(cases.some((c) => c.rbfControls.some((v) => v > 0.1))).toBe(true);
	});

	it("gives the same outputs in any order (seeking equals playing)", () => {
		const forward = new RigEvaluator(dna);
		const outputs = cases.map((c) => {
			run(forward, c);
			return [
				...forward.jointOutputs,
				...forward.blendShapeOutputs,
				...forward.animatedMapOutputs,
			];
		});
		const backward = new RigEvaluator(dna);
		for (let i = cases.length - 1; i >= 0; i--) {
			run(backward, cases[i]!);
			expect([
				...backward.jointOutputs,
				...backward.blendShapeOutputs,
				...backward.animatedMapOutputs,
			]).toEqual(outputs[i]);
		}
	});

	it("sets controls by name and refuses unknown ones and LODs", () => {
		const rig = new RigEvaluator(dna);
		rig.setGuiControls({ CTRL_jaw: 0.5 });
		rig.mapGuiToRaw();
		rig.calculate();
		expect(rig.inputs[0]).toBeCloseTo(0.5, 6);
		expect(rig.blendShapeOutputs[0]).toBeCloseTo(0.5, 6);
		expect(() => rig.setRawControls({ nope: 1 })).toThrow(
			/no raw control "nope"/,
		);
		expect(() => {
			rig.lod = 2;
		}).toThrow(/LOD 2 is not in the rig/);
	});
});
