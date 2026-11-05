/**
 * Evaluates a DNA character's rig: controls in, deformation out.
 *
 * - GUI controls map to raw controls through a conditional table.
 * - Pose-space controls (PSDs) are products of raw controls, for
 *   expressions that only look right in combination.
 * - Joint groups are sparse matrices from controls to joint attribute
 *   deltas: per joint, translation, Euler rotation (the file's units and
 *   order) and scale, added to the neutral pose.
 * - Blend shape channel weights copy controls.
 * - Animated maps (wrinkle masks) come from a second conditional table.
 * - Body correctives: RBF solvers turn joint rotations (quaternions the
 *   host puts in raw controls) into pose weights that drive controls, and
 *   twist/swing spreads a joint's rotation over helper joints
 *   (`rig-body.ts`).
 *
 * Each LOD uses the first rows of every table, so lower LODs do less work.
 * Evaluation keeps no state between calls: the outputs depend only on the
 * controls and the LOD, so rendering frame 200 directly equals rendering
 * frames 0 to 200.
 *
 * Based on OpenRigLogic's RigLogic (MIT, Epic Games). Its scalar,
 * full-precision path is the reference; `fixtures/oracle-eval.json` holds its
 * outputs.
 */
import type { ConditionalTable, DnaFile } from "./read.js";
import {
	applyTwistSwing,
	RbfSolverRuntime,
	type TwistSwingRuntime,
	twistSwingSetups,
} from "./rig-body.js";

/** Attributes per joint in `jointOutputs`: tx, ty, tz, rx, ry, rz, sx, sy, sz. */
export const JOINT_ATTRIBUTES = 9;

interface Psd {
	/** Control index this PSD writes. */
	output: number;
	weight: number;
	inputs: number[];
}

/** A conditional table with, per row, how many rows of its (input, output) run follow it. */
interface Conditionals {
	table: ConditionalTable;
	skip: Uint16Array;
}

function conditionals(table: ConditionalTable): Conditionals {
	const n = table.inputIndices.length;
	const skip = new Uint16Array(n);
	// Rows of one input feeding one output form a run of intervals: once one
	// matches, the rest of the run is skipped.
	for (let i = 0; i < n; ) {
		let end = i + 1;
		while (
			end < n &&
			table.inputIndices[end] === table.inputIndices[i] &&
			table.outputIndices[end] === table.outputIndices[i]
		)
			end++;
		for (let k = i; k < end; k++) skip[k] = end - 1 - k;
		i = end;
	}
	return { table, skip };
}

/** Rows `0 … rows - 1` of a conditional table: each output sums its matching rows, clamped to 0 … 1. */
function forward(
	c: Conditionals,
	inputs: Float32Array,
	outputs: Float32Array,
	rows: number,
): void {
	outputs.fill(0);
	const t = c.table;
	for (let row = 0; row < rows; row++) {
		const value = inputs[t.inputIndices[row] as number] as number;
		if (
			(t.fromValues[row] as number) <= value &&
			value <= (t.toValues[row] as number)
		) {
			const out = t.outputIndices[row] as number;
			outputs[out] =
				(outputs[out] as number) +
				(t.slopeValues[row] as number) * value +
				(t.cutValues[row] as number);
			row += c.skip[row] as number;
		}
	}
	for (let i = 0; i < outputs.length; i++)
		outputs[i] = Math.min(1, Math.max(0, outputs[i] as number));
}

export interface RigEvaluatorOptions {
	/** Level of detail. Default 0. */
	lod?: number;
}

export class RigEvaluator {
	readonly guiControlNames: readonly string[];
	readonly rawControlNames: readonly string[];
	/** GUI control values; `mapGuiToRaw()` turns them into raw controls. */
	readonly guiControls: Float32Array;
	/** Raw controls, then PSD, machine-learned (not evaluated yet, 0) and RBF pose controls. */
	readonly inputs: Float32Array;
	/** Names of the RBF pose controls (the end of `inputs`). */
	readonly rbfControlNames: readonly string[];
	/** Per joint: translation, rotation, scale deltas from the neutral pose (`JOINT_ATTRIBUTES` each). */
	readonly jointOutputs: Float32Array;
	/** Per blend shape channel: its weight. */
	readonly blendShapeOutputs: Float32Array;
	/** Per animated map (wrinkle mask): its weight, 0 … 1. */
	readonly animatedMapOutputs: Float32Array;

	private readonly rawCount: number;
	private readonly guiToRaw: Conditionals;
	private readonly animatedMaps: Conditionals;
	private readonly psds: Psd[];
	/** Per LOD, the PSDs (by position in `psds`) some output at that LOD uses. */
	private readonly psdsForLod: number[][];
	private readonly dna: DnaFile;
	private readonly solvers: RbfSolverRuntime[];
	/** Per pose: the controls that gate it and the controls it writes. */
	private readonly poseControls: NonNullable<DnaFile["rbf"]>["poseControls"];
	private readonly twistSwing: TwistSwingRuntime[];
	private lodIndex = 0;

	constructor(dna: DnaFile, options: RigEvaluatorOptions = {}) {
		const behavior = dna.behavior;
		if (!behavior)
			throw new Error("dna: the file was read without its rig behavior");
		const def = dna.definition;
		this.dna = dna;
		this.guiControlNames = def.guiControlNames;
		this.rawControlNames = def.rawControlNames;
		this.rawCount = def.rawControlNames.length;
		const psdCount = behavior.controls.psdCount;
		const rbf = dna.rbf;
		this.rbfControlNames = rbf?.poseControlNames ?? [];
		this.guiControls = new Float32Array(def.guiControlNames.length);
		this.inputs = new Float32Array(
			this.rawCount +
				psdCount +
				(dna.mlControlNames?.length ?? 0) +
				this.rbfControlNames.length,
		);
		const toRadians =
			dna.descriptor.rotationUnit === "degrees" ? Math.PI / 180 : 1;
		this.poseControls = rbf?.poseControls ?? [];
		this.solvers = (rbf?.solvers ?? []).map(
			(solver) =>
				new RbfSolverRuntime(
					solver,
					Array.from(solver.poseIndices, (p) => rbf?.poses[p]?.scale ?? 1),
					toRadians,
					Array.from(solver.poseIndices).flatMap((p) =>
						Array.from(this.poseControls[p]?.outputControlIndices ?? []),
					),
				),
		);
		this.twistSwing = twistSwingSetups(dna);
		const quaternionJoints = new Set(
			(dna.jointRepresentations ?? []).flatMap((r, j) =>
				r.rotation === "quaternion" ? [j] : [],
			),
		);
		const blocked = behavior.joints.jointGroups.flatMap((g) =>
			Array.from(g.jointIndices).filter((j) => quaternionJoints.has(j)),
		);
		if (blocked.length)
			throw new Error(
				`dna: joints ${blocked.map((j) => def.jointNames[j]).join(", ")} use quaternion joint groups, which are not evaluated yet`,
			);
		this.jointOutputs = new Float32Array(
			def.jointNames.length * JOINT_ATTRIBUTES,
		);
		this.blendShapeOutputs = new Float32Array(
			def.blendShapeChannelNames.length,
		);
		this.animatedMapOutputs = new Float32Array(def.animatedMapNames.length);
		this.guiToRaw = conditionals(behavior.controls.conditionals);
		this.animatedMaps = conditionals(behavior.animatedMaps.conditionals);

		// PSDs: every (row, column, value) of the PSD matrix with one row is one PSD.
		const { rows, columns, values } = behavior.controls.psds;
		const byOutput = new Map<number, Psd>();
		for (let i = 0; i < rows.length; i++) {
			const output = rows[i] as number;
			let psd = byOutput.get(output);
			if (!psd) {
				psd = { output, weight: 1, inputs: [] };
				byOutput.set(output, psd);
			}
			psd.inputs.push(columns[i] as number);
			psd.weight *= values[i] as number;
		}
		this.psds = [...byOutput.values()].sort((a, b) => a.output - b.output);
		this.psdsForLod = Array.from(
			{ length: dna.descriptor.lodCount },
			(_, lod) => {
				const used = this.controlsUsed(lod);
				return this.psds.flatMap((p, i) => (used.has(p.output) ? [i] : []));
			},
		);
		this.lod = options.lod ?? 0;
	}

	get lod(): number {
		return this.lodIndex;
	}

	set lod(value: number) {
		if (
			!Number.isInteger(value) ||
			value < 0 ||
			value >= this.dna.descriptor.lodCount
		)
			throw new Error(
				`dna: LOD ${value} is not in the rig (it has ${this.dna.descriptor.lodCount})`,
			);
		this.lodIndex = value;
	}

	/** The controls any output reads at a LOD. */
	private controlsUsed(lod: number): Set<number> {
		const b = this.dna.behavior;
		const used = new Set<number>();
		if (!b) return used;
		for (const g of b.joints.jointGroups) {
			const rows = g.lods[lod] ?? 0;
			const cols = g.inputIndices.length;
			for (let c = 0; c < cols; c++)
				for (let r = 0; r < rows; r++)
					if ((g.values[r * cols + c] as number) !== 0) {
						used.add(g.inputIndices[c] as number);
						break;
					}
		}
		const bs = b.blendShapeChannels;
		for (let i = 0; i < (bs.lods[lod] ?? 0); i++)
			used.add(bs.inputIndices[i] as number);
		const am = b.animatedMaps;
		for (let i = 0; i < (am.lods[lod] ?? 0); i++)
			used.add(am.conditionals.inputIndices[i] as number);
		return used;
	}

	/** The LOD's RBF solvers: each clears its outputs, weighs its poses, and adds them up. */
	private calculateRbf(lod: number): void {
		const map = this.dna.rbf?.lodSolverMapping;
		if (!map) return;
		const inputs = this.inputs;
		for (const index of map.indices[map.lods[lod] as number] ?? []) {
			const solver = this.solvers[index] as RbfSolverRuntime;
			for (const o of solver.outputs) inputs[o] = 0;
			solver.solve(inputs);
			solver.solver.poseIndices.forEach((pose, i) => {
				const pc = this.poseControls[pose];
				if (!pc) return;
				let gate = 1;
				for (const c of pc.inputControlIndices) gate *= inputs[c] as number;
				const weight = solver.weights[i] as number;
				pc.outputControlIndices.forEach((o, k) => {
					inputs[o] =
						(inputs[o] as number) +
						(pc.outputControlWeights[k] as number) * weight * gate;
				});
			});
		}
	}

	/** Sets GUI controls by name (unnamed ones keep their values). */
	setGuiControls(values: Record<string, number>): void {
		this.setByName(this.guiControlNames, this.guiControls, values, "GUI");
	}

	/** Sets raw controls by name (unnamed ones keep their values). */
	setRawControls(values: Record<string, number>): void {
		this.setByName(this.rawControlNames, this.inputs, values, "raw");
	}

	private setByName(
		names: readonly string[],
		into: Float32Array,
		values: Record<string, number>,
		kind: string,
	) {
		for (const [name, value] of Object.entries(values)) {
			const i = names.indexOf(name);
			if (i < 0) throw new Error(`dna: no ${kind} control "${name}"`);
			into[i] = value;
		}
	}

	/** Raw controls from the GUI controls (the rest of the raw controls become 0). */
	mapGuiToRaw(): void {
		forward(
			this.guiToRaw,
			this.guiControls,
			this.inputs.subarray(0, this.rawCount),
			this.guiToRaw.table.inputIndices.length,
		);
	}

	/** Every output from the current raw controls, at the current LOD. */
	calculate(): void {
		const lod = this.lodIndex;
		const b = this.dna.behavior as NonNullable<DnaFile["behavior"]>;
		const inputs = this.inputs;

		// Everything after the raw controls is computed from them, frame by frame.
		inputs.fill(0, this.rawCount);
		this.calculateRbf(lod);

		// PSDs read their inputs clamped to 0 … 1, as they were before this pass.
		const clamped = Float32Array.from(inputs, (v) =>
			Math.min(1, Math.max(0, v)),
		);
		for (const i of this.psdsForLod[lod] ?? []) {
			const psd = this.psds[i] as Psd;
			let value = psd.weight;
			for (const input of psd.inputs) value *= clamped[input] as number;
			inputs[psd.output] = Math.min(1, value);
		}

		const out = this.jointOutputs;
		out.fill(0);
		for (const g of b.joints.jointGroups) {
			const rows = g.lods[lod] ?? 0;
			const cols = g.inputIndices.length;
			for (let r = 0; r < rows; r++) {
				let sum = 0;
				for (let c = 0; c < cols; c++)
					sum +=
						(g.values[r * cols + c] as number) *
						(inputs[g.inputIndices[c] as number] as number);
				const o = g.outputIndices[r] as number;
				out[o] = (out[o] as number) + sum;
			}
		}

		const d = this.dna.descriptor;
		applyTwistSwing(
			this.twistSwing,
			inputs,
			out,
			JOINT_ATTRIBUTES,
			d.rotationSequence,
			d.rotationSign,
			d.rotationUnit === "degrees" ? 180 / Math.PI : 1,
		);

		const bs = b.blendShapeChannels;
		this.blendShapeOutputs.fill(0);
		for (let i = 0; i < (bs.lods[lod] ?? 0); i++)
			this.blendShapeOutputs[bs.outputIndices[i] as number] = inputs[
				bs.inputIndices[i] as number
			] as number;

		forward(
			this.animatedMaps,
			inputs,
			this.animatedMapOutputs,
			b.animatedMaps.lods[lod] ?? 0,
		);
	}
}
