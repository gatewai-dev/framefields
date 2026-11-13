/**
 * Curved primitives (spheres, cylinders, capsules, tori) drawn with the
 * detail their size on screen needs, each frame: a sphere filling the frame
 * gets a smooth outline, a distant one stays light. Detail comes in powers
 * of two and the meshes are cached, so a moving camera only builds a new one
 * when an object crosses a step.
 */
import {
	Camera3D,
	type Camera3DPose,
	getPrimitiveGeometry,
	type Mat4,
	type Model3DData,
	type PrimitiveGeometryOptions,
	primitiveDetailForScreen,
} from "@framefields/webgpu-renderers";

/** Largest scale the matrix applies along any axis (its 3×3 columns' lengths). */
export function maxAxisScale(m: Mat4): number {
	return Math.max(
		Math.hypot(m[0], m[1], m[2]),
		Math.hypot(m[4], m[5], m[6]),
		Math.hypot(m[8], m[9], m[10]),
	);
}

/**
 * The model to draw for a primitive placed by `world`: `model` when its own
 * detail is enough on screen, else the same primitive built finer.
 */
export function screenDetailModel(
	model: Model3DData,
	spec: PrimitiveGeometryOptions,
	world: Mat4,
	camera: Camera3DPose,
	viewportHeight: number,
): Model3DData {
	// Primitives are built around their origin: the matrix's translation is the center.
	const center: [number, number, number] = [world[12], world[13], world[14]];
	const pixelsPerUnit =
		Camera3D.pixelsPerUnit(camera, center, viewportHeight) *
		maxAxisScale(world);
	const detailed = primitiveDetailForScreen(spec, pixelsPerUnit);
	return detailed === spec ? model : getPrimitiveGeometry(detailed);
}
