/**
 * `Composition.exportModel`: the 3D scene as glTF 2.0 binary (.glb), the
 * format Blender, Maya, Unreal, Unity, three.js and every glTF viewer read.
 * Each exported frame is rendered with a `Scene3DExporter` attached, so the
 * file holds exactly what the frames draw: one frame as a still scene, a
 * range of them as an animation sampled at every frame.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Scene3DExportOptions } from "@framefields/webgpu-renderers/gltf";

/** The frames an animated export samples: half-open, like a layer's window. */
export interface ModelAnimationRange {
	/** First frame. Default 0. */
	startFrame?: number;
	/** Frames from `startFrame`. Default: to the composition's end. */
	durationFrames?: number;
}

export interface ModelExportOptions extends Scene3DExportOptions {
	/** Frame to export. Default 0. */
	frame?: number;
	/** Time to export, ms (instead of `frame`). */
	atMs?: number;
	/**
	 * Export an animation instead of one frame: `true` for the whole
	 * composition, or a range. Every frame is sampled; its time in the clip
	 * counts from `startFrame`.
	 */
	animation?: boolean | ModelAnimationRange;
	/** Where to write the `.glb`; it is also returned. */
	outputPath?: string;
}

export interface ModelExport {
	/** The GLB file. */
	glb: Uint8Array;
	/** Where it was written, when `outputPath` was given. */
	filePath?: string;
	/** Mesh nodes written (each instance counts). */
	meshes: number;
	/** Triangles in the file, counting each shared mesh once. */
	triangles: number;
	/** Frames sampled (1 for a still). */
	frames: number;
	/** Animation channels written (0 for a still). */
	channels: number;
	/** What the frames drew that the file does not carry, and why. */
	skipped: string[];
}

export async function writeModel(
	result: Omit<ModelExport, "filePath">,
	outputPath: string | undefined,
): Promise<ModelExport> {
	if (!outputPath) return result;
	const filePath = path.resolve(outputPath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, result.glb);
	return { ...result, filePath };
}

/** The frames an export samples, checked against the composition's length. */
export function modelFrames(
	options: Pick<ModelExportOptions, "animation">,
	still: number,
	totalFrames: number,
): { first: number; count: number } {
	const range = options.animation;
	if (!range) return { first: still, count: 1 };
	const first = (range === true ? undefined : range.startFrame) ?? 0;
	const count =
		(range === true ? undefined : range.durationFrames) ?? totalFrames - first;
	if (!Number.isInteger(first) || first < 0 || first >= totalFrames)
		throw new Error(
			`exportModel: animation.startFrame ${first} is outside the composition's ${totalFrames} frames.`,
		);
	if (!Number.isInteger(count) || count < 1 || first + count > totalFrames)
		throw new Error(
			`exportModel: animation.durationFrames ${count} runs past the composition's ${totalFrames} frames.`,
		);
	return { first, count };
}
