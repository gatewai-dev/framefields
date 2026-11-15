/**
 * Recreate a frame as a program: shown one frame of any env, answer the
 * scene as a framefields program document (the JSON `Composition.toProgram`
 * writes: `model3d` nodes with a `primitive3d` recipe, lights). The camera
 * is given and kept; the answer is checked and loaded as data (nothing in it
 * runs), rendered at that frame and compared with it: object-mask IoU (the
 * score), PSNR, SSIM and depth error. Lint findings come back too, so a
 * model learns why a scene renders badly (no light, physical materials
 * without an environment …).
 */
import {
	Composition,
	type FrameTruth,
	HeadlessMediaRenderer,
	type RenderDiagnostic,
} from "framefields";
import { type EnvView, maskAndDepth, psnr, ssim } from "framefields/datasets";

/** The node kinds an answer may hold (the camera is given). */
const ANSWER_KINDS = new Set(["model3d", "light"]);

export const RECREATE_PROGRAM_PROMPT = `Recreate the scene in the image as a framefields program layout (JSON).
Answer {"layout": [nodes]}. Each node has a unique "id" and a "kind":
- "model3d": a solid, {"kind": "model3d", "id", "is3D": true, "label": what it is,
  "primitive3d": {"type": "sphere" | "roundedBox" | "cylinder" | "capsule" | "torus",
    sizes in px: sphere "radius"; roundedBox "width", "height", "depth"; cylinder
    "radius", "height"; capsule "radius", "length"; torus "radius", "tube";
    "color": "#rrggbb"},
  "x", "y", "z" (its center, px; y down, the floor top is y = 400),
  "rotateX", "rotateY", "rotateZ" (degrees), optional "roughness" 0-1,
  "metallic" 0-1, "material": "lit" | "metallic" | "glass"}
- "light": {"kind": "light", "id", "lightType": "ambient" | "directional",
  "color", "intensity", and for directional "x", "y", "z", "targetX", "targetY", "targetZ"}
The camera is given; do not add one. Include the floor if one shows.`;

export interface RecreateProgramScore {
	/** IoU of the objects' masks (floor excluded), 0..1: the score. */
	iou: number;
	psnr: number;
	ssim: number;
	depthError: number;
	/** What the engine's lint says about the answered scene. */
	lint: RenderDiagnostic[];
}

/**
 * The answer as a full document around the target's camera: checked by the
 * engine's program validation, with answer-specific rules on top.
 */
export function recreateProgram(
	target: Composition,
	answer: unknown,
	durationFrames: number,
): Composition {
	const layout = (answer as { layout?: unknown } | null)?.layout;
	if (!Array.isArray(layout) || layout.length === 0 || layout.length > 64)
		throw new Error('answer: {"layout": [1 to 64 nodes]}');
	layout.forEach((node, i) => {
		const kind = (node as { kind?: unknown } | null)?.kind;
		if (typeof kind !== "string" || !ANSWER_KINDS.has(kind))
			throw new Error(
				`layout[${i}].kind: "model3d" or "light" (the camera is given), got ${JSON.stringify(kind)}`,
			);
		// Solids are recipes; built mesh data is the engine's, not an answer's.
		if (kind === "model3d" && "modelData" in (node as object))
			throw new Error(
				`layout[${i}]: describe a solid with "primitive3d", not "modelData"`,
			);
	});
	const spec = target.toSpec();
	const camera = spec.layout.find((n) => n.kind === "camera");
	if (!camera) throw new Error("the target scene has no camera");
	return Composition.fromProgram(
		{
			width: spec.width,
			height: spec.height,
			fps: spec.fps,
			backgroundColor: spec.backgroundColor,
			layout: [structuredClone(camera), ...layout],
		},
		{ durationFrames },
	);
}

/** Scores an answer for frame `frame` of a view. */
export async function scoreRecreateProgram(
	view: EnvView,
	answer: unknown,
	frame: number,
	renderer = new HeadlessMediaRenderer(),
): Promise<RecreateProgramScore> {
	const target = view.composition;
	const answered = recreateProgram(target, answer, frame + 1);
	const render = (c: Composition): Promise<FrameTruth> =>
		c.renderTruth({ frame, renderer });
	const a = await render(target);
	const b = await render(answered);
	const md = maskAndDepth(a.scenes[0], b.scenes[0]);
	return {
		...md,
		psnr: psnr(a.rgba, b.rgba),
		ssim: ssim(a.rgba, b.rgba, a.width, a.height),
		lint: answered.lint(),
	};
}
