import type {
	DrawMesh3DOpts,
	DrawQuad3DOpts,
	Environment3DOptions,
	Mesh3DData,
	PathTraceItem,
	PathTraceOptions,
	Renderer3D,
	Scene3DItem,
} from "@framefields/webgpu-renderers";

/** What else the scene's 3D pass asks for that a traced frame does not draw. */
interface PassFeatures {
	cubeCamera: boolean;
	outlines: boolean;
	volumetricFog: boolean;
	screenIndirect: boolean;
}

/**
 * The environment's path tracing setting, or false. A traced frame computes
 * reflections and bounce light itself and has no depth buffer for the
 * screen-space passes, so a scene asking for both is an authoring error.
 */
export function pathTraceCheck(
	environment: Environment3DOptions | null | undefined,
	features: PassFeatures,
): false | true | PathTraceOptions {
	const setting = environment?.pathTrace;
	if (!setting) return false;
	const conflicts = [
		features.screenIndirect &&
			"ssr / gi (the tracer reflects and bounces light itself: drop them)",
		features.outlines && "outlines",
		features.volumetricFog && "volumetricFog",
		features.cubeCamera && "a cube camera",
	].filter(Boolean);
	if (conflicts.length) {
		throw new Error(
			`environment.pathTrace cannot be combined with ${conflicts.join(", ")}.`,
		);
	}
	return setting;
}

type QueuedItem = (
	| { kind: "quad"; texture: GPUTexture; opts: DrawQuad3DOpts }
	| { kind: "slug"; opts: DrawQuad3DOpts }
	| {
			kind: "mesh";
			mesh: Mesh3DData;
			texture?: GPUTexture;
			opts: DrawMesh3DOpts;
	  }
) & { owner?: string };

/** The queued 3D draws as scene data (`NodeRenderProps.scene3d`), each with its object-to-world matrix. */
export function scene3dItems(
	r3d: Renderer3D,
	queued: QueuedItem[],
): Scene3DItem[] {
	return queued.map((item): Scene3DItem => {
		const owner = item.owner;
		if (item.kind === "slug")
			return {
				kind: "text",
				opts: item.opts,
				matrix: r3d.quadModelMatrix(item.opts),
				owner,
			};
		if (item.kind === "quad")
			return {
				kind: "quad",
				texture: item.texture,
				opts: item.opts,
				matrix: r3d.quadModelMatrix(item.opts),
				owner,
			};
		return {
			kind: "mesh",
			mesh: item.mesh,
			texture: item.texture,
			opts: item.opts,
			matrix: r3d.meshModelMatrix(item.opts),
			owner,
		};
	});
}

/** The queued 3D draws as the path tracer takes them, each with its object-to-world matrix. */
export function pathTraceItems(
	r3d: Renderer3D,
	queued: QueuedItem[],
): PathTraceItem[] {
	return queued.map((item): PathTraceItem => {
		if (item.kind === "slug") {
			throw new Error(
				"environment.pathTrace does not trace text drawn on a 3D plane yet: use Layer3D.extrudedText in a traced scene.",
			);
		}
		if (item.kind === "quad") {
			return {
				kind: "quad",
				texture: item.texture,
				opts: item.opts,
				matrix: r3d.quadModelMatrix(item.opts),
			};
		}
		return {
			kind: "mesh",
			mesh: item.mesh,
			texture: item.texture,
			opts: item.opts,
			matrix: r3d.meshModelMatrix(item.opts),
		};
	});
}
