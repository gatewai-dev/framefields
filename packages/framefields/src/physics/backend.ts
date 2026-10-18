/**
 * The simulation backend the physics worlds drive. Worlds talk to this
 * engine-neutral surface only, so another solver can be dropped in later;
 * Rapier (deterministic builds, identical results on every platform) is the
 * one shipped. Units here are SI: meters, radians, seconds, y down.
 */
import type RAPIER2D from "@dimforge/rapier2d-deterministic-compat";
import type RAPIER3D from "@dimforge/rapier3d-deterministic-compat";

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
	| { kind: "hull"; points: number[] };

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
	setKinematicTarget(position: V, rotation: R): void;
}

export type SimBody2D = SimBody<Vec2, number>;
export type SimBody3D = SimBody<Vec3, Quat>;

export interface SimWorld<V, B, S> {
	addBody(spec: S): B;
	addJoint(a: B, b: B, spec: JointSpec<V>): void;
	step(dt: number): void;
	/** Pairs that started touching during the last step. */
	drainCollisionStarts(): Array<[B, B]>;
	free(): void;
}

export type SimWorld2D = SimWorld<Vec2, SimBody2D, BodySpec2D>;
export type SimWorld3D = SimWorld<Vec3, SimBody3D, BodySpec3D>;

export interface PhysicsBackend {
	createWorld2D(gravity: Vec2): SimWorld2D;
	createWorld3D(gravity: Vec3): SimWorld3D;
}

// ---------------------------------------------------------------------------
// Rapier
// ---------------------------------------------------------------------------

type Rapier2D = typeof RAPIER2D;
type Rapier3D = typeof RAPIER3D;

// Literal specifiers: the preview's browser bundle splits each engine into a
// chunk loaded on first use; Node keeps them as external optional packages.
const RAPIER_2D = "@dimforge/rapier2d-deterministic-compat";
const RAPIER_3D = "@dimforge/rapier3d-deterministic-compat";

async function loadRapier<T>(
	specifier: string,
	load: () => Promise<unknown>,
): Promise<T> {
	let mod: { default?: T } & T;
	try {
		mod = (await load()) as { default?: T } & T;
	} catch (error) {
		throw new Error(
			`Physics needs the optional dependency "${specifier}". Install it with \`npm i ${specifier}\`.`,
			{ cause: error },
		);
	}
	const rapier = (mod.default ?? mod) as T & { init(): Promise<void> };
	await rapier.init();
	return rapier;
}

let rapier2d: Promise<Rapier2D> | undefined;
let rapier3d: Promise<Rapier3D> | undefined;

/** Loads and initializes Rapier once per process; 2D and 3D are separate modules. */
export async function rapierBackend(dims: 2 | 3): Promise<PhysicsBackend> {
	if (dims === 2) {
		rapier2d ??= loadRapier<Rapier2D>(
			RAPIER_2D,
			() => import("@dimforge/rapier2d-deterministic-compat"),
		);
		const R = await rapier2d;
		return {
			createWorld2D: (gravity) => new RapierWorld2D(R, gravity),
			createWorld3D: () => {
				throw new Error("This backend was loaded for 2D.");
			},
		};
	}
	rapier3d ??= loadRapier<Rapier3D>(
		RAPIER_3D,
		() => import("@dimforge/rapier3d-deterministic-compat"),
	);
	const R = await rapier3d;
	return {
		createWorld2D: () => {
			throw new Error("This backend was loaded for 3D.");
		},
		createWorld3D: (gravity) => new RapierWorld3D(R, gravity),
	};
}

class RapierWorld2D implements SimWorld2D {
	private readonly world: RAPIER2D.World;
	private readonly events: RAPIER2D.EventQueue;
	private readonly byCollider = new Map<number, SimBody2D>();
	private readonly started: Array<[SimBody2D, SimBody2D]> = [];

	constructor(
		private readonly R: Rapier2D,
		gravity: Vec2,
	) {
		this.world = new R.World({ x: gravity[0], y: gravity[1] });
		this.events = new R.EventQueue(true);
	}

	addBody(spec: BodySpec2D): SimBody2D {
		const R = this.R;
		const desc = bodyDesc(R, spec.type)
			.setTranslation(spec.position[0], spec.position[1])
			.setRotation(spec.angle)
			.setLinvel(spec.velocity[0], spec.velocity[1])
			.setAngvel(spec.angularVelocity)
			.setLinearDamping(spec.linearDamping)
			.setAngularDamping(spec.angularDamping)
			.setGravityScale(spec.gravityScale)
			.setCcdEnabled(spec.ccd)
			.setEnabled(spec.enabled);
		if (spec.lockRotation) desc.lockRotations();
		const body = this.world.createRigidBody(desc);
		const collider = this.world.createCollider(
			shapeDesc2D(R, spec.shape)
				.setDensity(spec.density)
				.setFriction(spec.friction)
				.setRestitution(spec.restitution)
				.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
				.setSensor(spec.sensor ?? false),
			body,
		);
		const sim: SimBody2D & { raw: RAPIER2D.RigidBody } = {
			raw: body,
			position: () => {
				const t = body.translation();
				return [t.x, t.y];
			},
			rotation: () => body.rotation(),
			velocity: () => {
				const v = body.linvel();
				return [v.x, v.y];
			},
			angularVelocity: () => body.angvel(),
			sleeping: () => body.isSleeping(),
			mass: () => body.mass(),
			setEnabled: (on) => body.setEnabled(on),
			applyImpulse: ([x, y]) => body.applyImpulse({ x, y }, true),
			setKinematicTarget: ([x, y], angle) => {
				body.setNextKinematicTranslation({ x, y });
				body.setNextKinematicRotation(angle);
			},
		};
		this.byCollider.set(collider.handle, sim);
		return sim;
	}

	addJoint(a: SimBody2D, b: SimBody2D, spec: JointSpec<Vec2>): void {
		const R = this.R;
		const a1 = { x: spec.anchorA[0], y: spec.anchorA[1] };
		const a2 = { x: spec.anchorB[0], y: spec.anchorB[1] };
		let data: RAPIER2D.JointData;
		switch (spec.type) {
			case "revolute":
			case "spherical":
				data = R.JointData.revolute(a1, a2);
				break;
			case "fixed":
				data = R.JointData.fixed(a1, 0, a2, 0);
				break;
			case "rope":
				data = R.JointData.rope(spec.length, a1, a2);
				break;
			case "spring":
				data = R.JointData.spring(
					spec.restLength,
					spec.stiffness,
					spec.damping,
					a1,
					a2,
				);
				break;
		}
		// Jointed bodies pass through each other where they meet.
		this.world
			.createImpulseJoint(data, rawBody(a), rawBody(b), true)
			.setContactsEnabled(false);
	}

	step(dt: number): void {
		this.world.timestep = dt;
		this.world.step(this.events);
		this.events.drainCollisionEvents((h1, h2, started) => {
			if (!started) return;
			const a = this.byCollider.get(h1);
			const b = this.byCollider.get(h2);
			if (a && b) this.started.push([a, b]);
		});
	}

	drainCollisionStarts(): Array<[SimBody2D, SimBody2D]> {
		return this.started.splice(0);
	}

	free(): void {
		this.events.free();
		this.world.free();
	}
}

class RapierWorld3D implements SimWorld3D {
	private readonly world: RAPIER3D.World;
	private readonly events: RAPIER3D.EventQueue;
	private readonly byCollider = new Map<number, SimBody3D>();
	private readonly started: Array<[SimBody3D, SimBody3D]> = [];

	constructor(
		private readonly R: Rapier3D,
		gravity: Vec3,
	) {
		this.world = new R.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
		this.events = new R.EventQueue(true);
	}

	addBody(spec: BodySpec3D): SimBody3D {
		const R = this.R;
		const [qx, qy, qz, qw] = spec.rotation;
		const desc = bodyDesc(R, spec.type)
			.setTranslation(spec.position[0], spec.position[1], spec.position[2])
			.setRotation({ x: qx, y: qy, z: qz, w: qw })
			.setLinvel(spec.velocity[0], spec.velocity[1], spec.velocity[2])
			// Locked axes start still too (Rapier keeps an initial spin otherwise).
			.setAngvel(
				vec3(
					spec.lockRotation
						? [0, 0, 0]
						: (spec.angularVelocity.map((w, i) =>
								spec.enabledRotations && !spec.enabledRotations[i] ? 0 : w,
							) as Vec3),
				),
			)
			.setLinearDamping(spec.linearDamping)
			.setAngularDamping(spec.angularDamping)
			.setGravityScale(spec.gravityScale)
			.setCcdEnabled(spec.ccd)
			.setEnabled(spec.enabled);
		if (spec.lockRotation) desc.lockRotations();
		else if (spec.enabledRotations)
			desc.enabledRotations(...spec.enabledRotations);
		const body = this.world.createRigidBody(desc);
		const shape = shapeDesc3D(R, spec.shape);
		const collider = this.world.createCollider(
			shape
				.setDensity(spec.density)
				.setFriction(spec.friction)
				.setRestitution(spec.restitution)
				.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
				.setSensor(spec.sensor ?? false),
			body,
		);
		const sim: SimBody3D & { raw: RAPIER3D.RigidBody } = {
			raw: body,
			position: () => {
				const t = body.translation();
				return [t.x, t.y, t.z];
			},
			rotation: () => {
				const q = body.rotation();
				return [q.x, q.y, q.z, q.w];
			},
			velocity: () => {
				const v = body.linvel();
				return [v.x, v.y, v.z];
			},
			angularVelocity: () => {
				const w = body.angvel();
				return [w.x, w.y, w.z];
			},
			sleeping: () => body.isSleeping(),
			mass: () => body.mass(),
			setEnabled: (on) => body.setEnabled(on),
			applyImpulse: (v) => body.applyImpulse(vec3(v), true),
			setKinematicTarget: (p, [x, y, z, w]) => {
				body.setNextKinematicTranslation(vec3(p));
				body.setNextKinematicRotation({ x, y, z, w });
			},
		};
		this.byCollider.set(collider.handle, sim);
		return sim;
	}

	addJoint(a: SimBody3D, b: SimBody3D, spec: JointSpec<Vec3>): void {
		const R = this.R;
		const a1 = vec3(spec.anchorA);
		const a2 = vec3(spec.anchorB);
		let data: RAPIER3D.JointData;
		switch (spec.type) {
			case "revolute":
				data = R.JointData.revolute(a1, a2, vec3(spec.axis ?? [0, 0, 1]));
				break;
			case "spherical":
				data = R.JointData.spherical(a1, a2);
				break;
			case "fixed": {
				const identity = { x: 0, y: 0, z: 0, w: 1 };
				data = R.JointData.fixed(a1, identity, a2, identity);
				break;
			}
			case "rope":
				data = R.JointData.rope(spec.length, a1, a2);
				break;
			case "spring":
				data = R.JointData.spring(
					spec.restLength,
					spec.stiffness,
					spec.damping,
					a1,
					a2,
				);
				break;
		}
		// Jointed bodies pass through each other where they meet.
		this.world
			.createImpulseJoint(data, rawBody(a), rawBody(b), true)
			.setContactsEnabled(false);
	}

	step(dt: number): void {
		this.world.timestep = dt;
		this.world.step(this.events);
		this.events.drainCollisionEvents((h1, h2, started) => {
			if (!started) return;
			const a = this.byCollider.get(h1);
			const b = this.byCollider.get(h2);
			if (a && b) this.started.push([a, b]);
		});
	}

	drainCollisionStarts(): Array<[SimBody3D, SimBody3D]> {
		return this.started.splice(0);
	}

	free(): void {
		this.events.free();
		this.world.free();
	}
}

function vec3([x, y, z]: Vec3): { x: number; y: number; z: number } {
	return { x, y, z };
}

function rawBody<T>(body: unknown): T {
	return (body as { raw: T }).raw;
}

function bodyDesc<R extends Rapier2D | Rapier3D>(
	R: R,
	type: BodyType,
): ReturnType<R["RigidBodyDesc"]["dynamic"]> {
	const D = R.RigidBodyDesc;
	const desc =
		type === "fixed"
			? D.fixed()
			: type === "kinematic"
				? D.kinematicPositionBased()
				: D.dynamic();
	return desc as ReturnType<R["RigidBodyDesc"]["dynamic"]>;
}

function shapeDesc2D(R: Rapier2D, shape: Shape2D): RAPIER2D.ColliderDesc {
	switch (shape.kind) {
		case "ball":
			return R.ColliderDesc.ball(shape.radius);
		case "box": {
			// The rounded border wraps a core box; keep the core solid (a flat core has no mass).
			const r = Math.min(shape.radius ?? 0, shape.hx / 2, shape.hy / 2);
			return r > 0
				? R.ColliderDesc.roundCuboid(shape.hx - r, shape.hy - r, r)
				: R.ColliderDesc.cuboid(shape.hx, shape.hy);
		}
		case "hull": {
			const desc = R.ColliderDesc.convexHull(new Float32Array(shape.points));
			if (!desc)
				throw new Error(
					"Physics: could not build a convex hull for this shape.",
				);
			return desc;
		}
	}
}

function shapeDesc3D(R: Rapier3D, shape: Shape3D): RAPIER3D.ColliderDesc {
	switch (shape.kind) {
		case "ball":
			return R.ColliderDesc.ball(shape.radius);
		case "box": {
			// The rounded border wraps a core box; keep the core solid (a flat core has no mass).
			const r = Math.min(
				shape.radius ?? 0,
				shape.hx / 2,
				shape.hy / 2,
				shape.hz / 2,
			);
			return r > 0
				? R.ColliderDesc.roundCuboid(
						shape.hx - r,
						shape.hy - r,
						shape.hz - r,
						r,
					)
				: R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
		}
		case "cylinder":
			return R.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
		case "hull": {
			const desc = R.ColliderDesc.convexHull(new Float32Array(shape.points));
			if (!desc)
				throw new Error(
					"Physics: could not build a convex hull for this shape.",
				);
			return desc;
		}
	}
}
