/**
 * The simulation backend the physics worlds drive. Worlds talk to this
 * engine-neutral surface only; Steel (`steel-backend.ts`) implements it.
 * Units here are SI: meters, radians, seconds, y down.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export type BodyType = "dynamic" | "fixed" | "kinematic";

interface MaterialSpec {
	density: number;
	friction: number;
	restitution: number;
}

export type Shape2D =
	| { kind: "box"; hx: number; hy: number; radius?: number }
	| { kind: "ball"; radius: number }
	/** Flat [x0, y0, x1, y1, …] around the body origin. */
	| { kind: "hull"; points: number[] };

export type Shape3D =
	| { kind: "box"; hx: number; hy: number; hz: number; radius?: number }
	| { kind: "ball"; radius: number }
	/** Axis along y. */
	| { kind: "cylinder"; halfHeight: number; radius: number }
	/** Flat [x0, y0, z0, …] around the body origin. */
	| { kind: "hull"; points: number[] }
	/** Exact triangle mesh (static / kinematic bodies: terrain, sculptures). */
	| { kind: "trimesh"; vertices: number[]; indices: number[] };

interface BodySpecBase extends MaterialSpec {
	type: BodyType;
	linearDamping: number;
	angularDamping: number;
	gravityScale: number;
	lockRotation: boolean;
	ccd: boolean;
	enabled: boolean;
	/** Touches nothing (joint anchors). */
	sensor?: boolean;
}

export interface BodySpec2D extends BodySpecBase {
	position: Vec2;
	angle: number;
	velocity: Vec2;
	angularVelocity: number;
	shape: Shape2D;
}

export interface BodySpec3D extends BodySpecBase {
	/** Per-axis rotation, when only some axes are locked: [x, y, z] allowed. */
	enabledRotations?: [boolean, boolean, boolean];
	position: Vec3;
	rotation: Quat;
	velocity: Vec3;
	angularVelocity: Vec3;
	shape: Shape3D;
}

export type JointSpec<V> =
	| { type: "revolute"; anchorA: V; anchorB: V; axis?: Vec3 }
	| { type: "spherical"; anchorA: V; anchorB: V }
	| { type: "fixed"; anchorA: V; anchorB: V }
	| { type: "rope"; anchorA: V; anchorB: V; length: number }
	| {
			type: "spring";
			anchorA: V;
			anchorB: V;
			restLength: number;
			stiffness: number;
			damping: number;
	  };

export interface SimBody<V, R> {
	position(): V;
	rotation(): R;
	velocity(): V;
	/** 2D: rad/s; 3D: rad/s per axis. */
	angularVelocity(): R extends number ? number : Vec3;
	sleeping(): boolean;
	mass(): number;
	setEnabled(enabled: boolean): void;
	applyImpulse(impulse: V): void;
	/** Teleports the body (wakes it): position, and rotation. */
	setPose(position: V, rotation: R): void;
	/** Sets linear and angular velocity (wakes the body). */
	setVelocity(linear: V, angular: R extends number ? number : Vec3): void;
	setKinematicTarget(position: V, rotation: R): void;
	/** Off: it touches nothing (passes through everything); on again: it collides. */
	setCollisions(enabled: boolean): void;
	/** Sets its mass, kg (its shape's density scaled to match). */
	setMass(kg: number): void;
}

export type SimBody2D = SimBody<Vec2, number>;
export type SimBody3D = SimBody<Vec3, Quat>;

export interface SimWorld<V, B, S> {
	addBody(spec: S): B;
	addJoint(a: B, b: B, spec: JointSpec<V>): void;
	/**
	 * Every body and joint is in: builds the world for steps of `dt` seconds.
	 * Bodies are read and changed (poses, velocities, impulses, …) only after.
	 */
	start(dt: number): Promise<void>;
	/** One step of the `dt` given to `start`; bodies read the state it ends on. */
	step(dt: number): Promise<void>;
	/** Pairs that started touching during the last step. */
	drainCollisionStarts(): Array<[B, B]>;
	setGravity(gravity: V): void;
	/** The whole simulation state, bytes. */
	snapshot(): Promise<Uint8Array>;
	/**
	 * Replaces the state with a snapshot of a world built the same way (the
	 * same bodies and joints added in the same order): bodies keep their
	 * `SimBody` objects.
	 */
	restore(snapshot: Uint8Array): Promise<void>;
	free(): void;
}

export type SimWorld2D = SimWorld<Vec2, SimBody2D, BodySpec2D>;
export type SimWorld3D = SimWorld<Vec3, SimBody3D, BodySpec3D>;

export interface PhysicsBackend {
	createWorld2D(gravity: Vec2): SimWorld2D;
	createWorld3D(gravity: Vec3): SimWorld3D;
}
