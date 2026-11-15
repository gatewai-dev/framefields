import { rapierBackend } from "./backend.js";
import {
	type MujocoWorld,
	type MujocoWorldOptions,
	mujocoWorld,
} from "./mujoco.js";
import { PoseTrack, type PoseTrackOptions } from "./poses.js";
import { SteelWorld, type SteelWorldOptions } from "./steel.js";
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
	/**
	 * A MuJoCo model (MJCF): robots and articulated mechanisms, simulated by
	 * MuJoCo's WebAssembly build. `layers()` draws its geoms; `control`
	 * drives its actuators; `state(frame)` branches a new run.
	 */
	async mujoco(options: MujocoWorldOptions): Promise<MujocoWorld> {
		return mujocoWorld(options);
	},
	/**
	 * Rigid bodies and articulated robots on Steel, a GPU solver (WebGPU, on
	 * the device the composition renders with). `build` adds the scene with
	 * Steel's `SceneBuilder` (or its MJCF / URDF / USDA loaders, `build`'s second argument); `control`
	 * drives joints before each frame; `await world.simulate()` (or
	 * `world.live(comp)`), then `world.layers()` draws it.
	 */
	async steel(options: SteelWorldOptions): Promise<SteelWorld> {
		return SteelWorld.create(options);
	},
	/**
	 * Body trajectories recorded by another simulator, replayed as pose
	 * signals: `track.follow(name, layer)` makes a layer follow one. For an
	 * MJCF model, `Physics.mujoco({ qpos })` replays joint positions instead.
	 */
	poses(options: PoseTrackOptions): PoseTrack {
		return new PoseTrack(options);
	},
};

export type {
	SceneBuilder as SteelSceneBuilder,
	SimOptions as SteelSolverOptions,
	SimState as SteelState,
} from "@skild-ai/steel-webgpu";
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
export {
	type MujocoCameraOptions,
	type MujocoContact,
	type MujocoFrameState,
	type MujocoJoint,
	type MujocoLayersOptions,
	type MujocoSensor,
	MujocoWorld,
	type MujocoWorldOptions,
} from "./mujoco.js";
export {
	type BodyTrack,
	type PoseAxes,
	PoseTrack,
	type PoseTrackOptions,
} from "./poses.js";
export {
	type SteelDrag,
	type SteelDragOptions,
	type SteelFrameState,
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
