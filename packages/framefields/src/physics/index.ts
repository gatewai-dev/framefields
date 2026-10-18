import { rapierBackend } from "./backend.js";
import { PhysicsWorld2D, type World2DOptions } from "./world2d.js";
import { PhysicsWorld3D, type World3DOptions } from "./world3d.js";

/**
 * Rigid-body physics baked into signals. A world simulates once, while the
 * composition is built (Rapier's deterministic build, so every machine gets
 * the same motion), and replays as per-frame signals: layers follow their
 * bodies, and `impact`, `speed`, … drive any other prop or effect.
 *
 * ```ts
 * const world = await Physics.world2d({ fps: 30, frames: 150 });
 * world.walls({ width: W, height: H });
 * const card = world.body(cardLayer, { restitution: 0.4 });
 * world.simulate();
 * flash.animate(LayerAnimation.create().signal("opacity", card.impact));
 * ```
 */
export const Physics = {
	/** A 2D world in layer pixels (y down). Loads the physics engine on first use. */
	async world2d(options: World2DOptions): Promise<PhysicsWorld2D> {
		return new PhysicsWorld2D(await rapierBackend(2), options);
	},
	/** A 3D world for Layer3D primitives and models, in scene pixels (y down). */
	async world3d(options: World3DOptions): Promise<PhysicsWorld3D> {
		return new PhysicsWorld3D(await rapierBackend(3), options);
	},
};

export type {
	BodyCommonOptions,
	PhysicsBakeOptions,
	PhysicsCollision,
	PhysicsDriver,
	PhysicsWorldOptions,
} from "./core.js";
export {
	type Body2DOptions,
	type FieldSample2D,
	PhysicsBody2D,
	type PhysicsGroundOptions,
	type PhysicsRect,
	type PhysicsRopeOptions,
	type PhysicsSpringOptions,
	type PhysicsWallsOptions,
	PhysicsWorld2D,
	type World2DOptions,
} from "./world2d.js";
export {
	type Body3DOptions,
	type FieldSample3D,
	PhysicsBody3D,
	type PhysicsBox3D,
	type PhysicsRope3DOptions,
	type PhysicsSpring3DOptions,
	PhysicsWorld3D,
	type World3DOptions,
} from "./world3d.js";
