/**
 * `Composition.exportModel`: a frame's 3D scene as glTF 2.0 binary (.glb),
 * the format Blender, Maya, Unreal, Unity, three.js and every glTF viewer
 * read. The frame is rendered once with a `Scene3DExporter` attached, so
 * the file holds exactly what that frame draws.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Scene3DExportOptions } from "@framefields/webgpu-renderers/gltf";

export interface ModelExportOptions extends Scene3DExportOptions {
	/** Frame to export. Default 0. */
	frame?: number;
	/** Time to export, ms (instead of `frame`). */
	atMs?: number;
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
	/** What the frame drew that the file does not carry, and why. */
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
