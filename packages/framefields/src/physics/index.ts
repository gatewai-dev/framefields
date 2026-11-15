import { PoseTrack, type PoseTrackOptions } from "./poses.js";
import { SteelWorld, type SteelWorldOptions } from "./steel.js";
import { steelBackend } from "./steel-backend.js";
import { PhysicsWorld2D, type World2DOptions } from "./world2d.js";
import { PhysicsWorld3D, type World3DOptions } from "./world3d.js";

/**
 * Rigid-body physics baked into signals. A world simulates once, while the
 * composition is built (Steel on the GPU the composition renders with), and
 * replays as per-frame signals: layers follow their bodies, and `impact`,
 * `speed`, … drive any other prop or effect.
 *
 * ```ts
 * const world = await Physics.world2d({ fps: 30, frames: 150 });
 * world.walls({ width: W, height: H });
 * const card = world.body(cardLayer, { restitution: 0.4 });
 * await world.simulate();
 * flash.animate(LayerAnimation.create().signal("opacity", card.impact));
 * ```
 */
export const Physics = {
	/** A 2D world in layer pixels (y down). Loads the physics engine on first use. */
	async world2d(options: World2DOptions): Promise<PhysicsWorld2D> {
		return new PhysicsWorld2D(await steelBackend(), options);
	},
	/** A 3D world for Layer3D primitives and models, in scene pixels (y down). */
	async world3d(options: World3DOptions): Promise<PhysicsWorld3D> {
		return new PhysicsWorld3D(await steelBackend(), options);
	},
	/**
	 * Rigid bodies and articulated robots on Steel, a GPU solver (WebGPU, on
	 * the device the composition renders with). `build` adds the scene with
	 * Steel's `SceneBuilder` (or its MJCF / URDF / USDA loaders, `build`'s
	 * second argument); `control` drives joints before each frame; `await world.simulate()` (or
	 * `world.live(comp)`), then `world.layers()` draws it.
	 */
	async steel(options: SteelWorldOptions): Promise<SteelWorld> {
		return SteelWorld.create(options);
	},
	/**
	 * Body trajectories recorded by another simulator, replayed as pose
	 * signals: `track.follow(name, layer)` makes a layer follow one.
	 */
	poses(options: PoseTrackOptions): PoseTrack {
		return new PoseTrack(options);
	},
};

export type {
	SceneBuilder as SteelSceneBuilder,
	SimOptions as SteelSolverOptions,
	SimState as SteelState,
} from "@framefields/steel";
export type {
	BodyCommonOptions,
	PhysicsBakeOptions,
	PhysicsCollision,
	PhysicsDriver,
	PhysicsIntervention,
	PhysicsInterventions,
	PhysicsState,
	PhysicsWorldOptions,
} from "./core.js";
export { Fracture3D, type Fracture3DOptions } from "./fracture3d.js";
export type { MjcfCamera } from "./mjcf.js";
export {
	type BodyTrack,
	type PoseAxes,
	PoseTrack,
	type PoseTrackOptions,
} from "./poses.js";
export {
	type SteelCamera,
	type SteelCameraOptions,
	type SteelDrag,
	type SteelDragOptions,
	type SteelFrameState,
	type SteelJoint,
	type SteelJointType,
	type SteelLayersOptions,
	type SteelLoaders,
	type SteelShape,
	type SteelShapeStyle,
	type SteelShapeType,
	SteelWorld,
	type SteelWorldOptions,
} from "./steel.js";
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
