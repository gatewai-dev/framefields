import { ensureDevice } from "@framefields/webgpu-renderers";
import { SceneBuilder, Sim } from "../src/index.js";

export const device = (): Promise<GPUDevice> => ensureDevice();

/** A box of half size `h` (m) at height `z`, over a ground plane. */
export function boxOnPlane(
	z: number,
	h = 0.1,
	fps = 60,
): { builder: SceneBuilder; box: number; ground: number } {
	const builder = new SceneBuilder({ fps });
	const ground = builder.addGroundPlane();
	const box = builder.addBody({ xform: [0, 0, z, 0, 0, 0, 1], label: "box" });
	builder.addJointFree(box);
	builder.addShapeBox(box, { hx: h, hy: h, hz: h, gap: 0.01 });
	return { builder, box, ground };
}

/** A built scene on the test device, ready to step. */
export async function simOf(
	builder: SceneBuilder,
	opts: ConstructorParameters<typeof Sim>[2] = {},
): Promise<Sim> {
	return Sim.create(await device(), builder.finalize(), opts);
}

/** The z of body `b`'s origin in a state. */
export const zOf = (bodyQ: Float32Array, b: number): number => bodyQ[b * 7 + 2];
