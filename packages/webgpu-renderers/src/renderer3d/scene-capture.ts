/**
 * A frame's 3D passes as data, for whatever wants the scene rather than its
 * picture (`Scene3DExporter` writes it as glTF). The compositor hands every
 * 3D pass it draws to `NodeRenderProps.scene3d`: the same draws, matrices
 * and light the raster and path-traced passes use.
 */

import type { Mesh3DData } from "../loaders/types.js";
import type { Camera3DPose } from "../math3d/camera3d.js";
import type { Environment3DOptions } from "../math3d/environment3d.js";
import type { Light3DOptions } from "../math3d/light3d.js";
import type { Mat4 } from "../math3d/matrix4.js";
import type { DrawMesh3DOpts, DrawQuad3DOpts } from "./renderer3d.js";

/** One draw of a 3D pass, with its object-to-world matrix. */
export type Scene3DItem = (
	| {
			kind: "mesh";
			mesh: Mesh3DData;
			opts: DrawMesh3DOpts;
			texture?: GPUTexture;
	  }
	| {
			/** A layer picture on a plane: the unit quad (-0.5..0.5) to world. */
			kind: "quad";
			opts: DrawQuad3DOpts;
			texture: GPUTexture;
	  }
	| {
			/** Text drawn natively on a plane (its glyphs have no triangles). */
			kind: "text";
			opts: DrawQuad3DOpts;
	  }
) & {
	matrix: Mat4;
	/** Id of the layer that drew it. */
	owner?: string;
};

export interface Scene3DPass {
	items: Scene3DItem[];
	camera: Camera3DPose;
	lights: Light3DOptions[];
	environment?: Environment3DOptions | null;
	/** The pass's size in pixels. */
	width: number;
	height: number;
}

export interface Scene3DCapture {
	/**
	 * Called once per 3D pass, while the frame is being encoded: GPU data the
	 * capture wants (textures, instance buffers) must be copied with
	 * `encoder` now, since the frame may reuse or release it afterwards.
	 */
	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DPass,
	): void;
}
