/**
 * Vertex-animation crowds: each clip a model can play, sampled at a fixed
 * rate into a palette of model-space joint matrices per mesh, so instances
 * can skin themselves on the GPU at their own clip, phase and speed.
 */
import { Matrix4Math } from "../math3d/index.js";
import { jointMatrices, poseNodes } from "./pose.js";
import type { AnimationClip3D, Mesh3DData, Model3DData } from "./types.js";

export interface CrowdClipRange {
	name: string;
	/** First baked frame of the clip in every palette. */
	base: number;
	/** Frames in one loop of the clip; `count + 1` are baked (the last at its end), so playback interpolates up to the loop point and wraps cleanly. */
	count: number;
	duration: number;
}

export interface CrowdMeshPalette {
	/** `frames × jointCount` column-major 4×4s. */
	palette: Float32Array;
	jointCount: number;
}

export interface CrowdBake {
	/** Target samples per second; each clip bakes round(duration · fps) per loop. */
	fps: number;
	clips: CrowdClipRange[];
	meshes: Map<Mesh3DData, CrowdMeshPalette>;
}

/** The model's clips by name or index; unknown ones are skipped. */
export function resolveClips(
	model: Model3DData,
	clips: Array<string | number>,
): AnimationClip3D[] {
	const out: AnimationClip3D[] = [];
	for (const c of clips) {
		const clip =
			typeof c === "number"
				? model.animations[c]
				: model.animations.find((a) => a.name === c);
		if (clip) out.push(clip);
	}
	return out;
}

/** A mesh's matrices at one posed frame: its skin's joints, or its node as joint 0. */
function meshFrame(
	model: Model3DData,
	mesh: Mesh3DData,
	world: ReturnType<typeof poseNodes>,
): Float32Array {
	if (mesh.skin !== undefined) return jointMatrices(model, mesh.skin, world);
	const m =
		mesh.node !== undefined && world[mesh.node]
			? world[mesh.node]!
			: Matrix4Math.identity();
	return new Float32Array(m);
}

/** Bakes every clip at `fps` for every mesh of the model. */
export function bakeCrowdPalette(
	model: Model3DData,
	clips: AnimationClip3D[],
	fps = 30,
): CrowdBake {
	const ranges: CrowdClipRange[] = [];
	const times: number[] = [];
	const clipOf: AnimationClip3D[] = [];
	for (const clip of clips) {
		const count = Math.max(1, Math.round(clip.duration * fps));
		ranges.push({
			name: clip.name,
			base: times.length,
			count,
			duration: clip.duration,
		});
		for (let f = 0; f <= count; f++) {
			times.push((f / count) * clip.duration);
			clipOf.push(clip);
		}
	}
	const meshes = new Map<Mesh3DData, CrowdMeshPalette>();
	const frames = times.map((t, i) => poseNodes(model, clipOf[i], t));
	for (const mesh of model.meshes) {
		const first = meshFrame(
			model,
			mesh,
			frames[0] ?? poseNodes(model, undefined, 0),
		);
		const jointCount = first.length / 16;
		const palette = new Float32Array(Math.max(1, frames.length) * first.length);
		frames.forEach((world, f) => {
			palette.set(meshFrame(model, mesh, world), f * first.length);
		});
		meshes.set(mesh, { palette, jointCount });
	}
	return { fps, clips: ranges, meshes };
}
