/**
 * Steel as the engine of `Physics.world2d` / `world3d`: the backend
 * interface (`backend.ts`) on the GPU solver, on the device compositions
 * render with.
 *
 * Bodies and joints go into Steel's `SceneBuilder`; `start` builds the
 * scene for steps of the world's `dt` (one Steel frame per step). After each
 * step the bodies' state and the contacts are read back into a mirror, so
 * reads between steps (`position()`, `velocity()`, …) are plain lookups, and
 * changes go to the solver as they are made. An impulse is a wrench over the
 * next step (the same velocity change); a kinematic target is the twist that
 * reaches it in one step. Ropes and springs are solver rows (a spring's
 * stiffness and damping solved implicitly, so stiff ones stay stable).
 *
 * 2D worlds are 3D worlds of planar bodies: shapes extruded 1 m along z (so
 * masses and inertias are the 2D ones per unit depth), moving in the xy
 * plane and turning about z.
 *
 * Units are the backend's: meters, seconds, radians, y down.
 */
import type {
	BodyOptions,
	SceneBuilder,
	ShapeOptions,
	Sim,
	SimState,
} from "@framefields/steel";
import { ensureDevice } from "@framefields/webgpu-renderers";
import type {
	BodySpec2D,
	BodySpec3D,
	JointSpec,
	PhysicsBackend,
	Quat,
	Shape2D,
	Shape3D,
	SimBody2D,
	SimBody3D,
	SimWorld2D,
	SimWorld3D,
	Vec2,
	Vec3,
} from "./backend.js";

type Steel = typeof import("@framefields/steel");

/** Contacts closer than this (m) count as touching (Steel also keeps contacts up to a shape's gap apart). */
const TOUCH = 1e-3;
/** Steel's sleep thresholds: a body this slow (m/s, rad/s) for this long (s) reads as sleeping. */
const SLEEP_LINEAR = 0.05;
const SLEEP_ANGULAR = 0.15;
const SLEEP_TIME = 0.5;
/** How deep a 2D body is extruded, m. */
const DEPTH = 1;
/** A 2D world's quaternion for turning about z. */
const aboutZ = (angle: number): Quat => [
	0,
	0,
	Math.sin(angle / 2),
	Math.cos(angle / 2),
];

const IDENTITY: Quat = [0, 0, 0, 1];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a: Quat, b: Quat): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rotate(q: Quat, v: Vec3): Vec3 {
	const u: Vec3 = [q[0], q[1], q[2]];
	const t = scale(cross(u, v), 2);
	return add(add(v, scale(t, q[3])), cross(u, t));
}
/** The angular velocity that turns `from` into `to` over `dt` (shortest way). */
function angularVelocity(from: Quat, to: Quat, dt: number): Vec3 {
	let d = qmul(to, conj(from));
	if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
	const s = Math.hypot(d[0], d[1], d[2]);
	if (s < 1e-12) return [0, 0, 0];
	const angle = 2 * Math.atan2(s, d[3]);
	return scale([d[0], d[1], d[2]], angle / s / dt);
}

let steelModule: Promise<Steel> | undefined;

/** Steel and the render device, once per process. */
export async function steelBackend(): Promise<PhysicsBackend> {
	steelModule ??= import("@framefields/steel");
	const [steel, device] = await Promise.all([steelModule, ensureDevice()]);
	return {
		createWorld2D: (gravity) => new SteelWorld2D(steel, device, gravity),
		createWorld3D: (gravity) => new SteelWorld3D(steel, device, gravity),
	};
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

/** What a body was made with, and what it needs between steps. */
class SteelBody3D implements SimBody3D {
	/** The state the last step ended on (origin position, quaternion, COM velocity, angular velocity). */
	p: Vec3;
	q: Quat;
	v: Vec3;
	w: Vec3;
	/** Impulse (N·s) and angular impulse (N·m·s) to deliver over the next step. */
	impulse: Vec3 = [0, 0, 0];
	angularImpulse: Vec3 = [0, 0, 0];
	target?: { position: Vec3; rotation: Quat };
	quiet = 0;
	/** Its center of mass in its own frame (known once the scene is built). */
	com: Vec3 = [0, 0, 0];
	/** In the world (a disabled body neither moves nor touches anything). */
	enabled = true;
	/** Has a joint parent: moved by its joints, not set directly. */
	linked = false;
	/** Part of an articulation (a joint's parent or child), as Steel builds it. */
	articulated = false;

	constructor(
		private readonly world: SteelWorld3D,
		readonly index: number,
		readonly shape: number,
		readonly spec: BodySpec3D,
	) {
		this.p = [...spec.position];
		this.q = [...spec.rotation];
		this.v = [...spec.velocity];
		this.w = [...spec.angularVelocity];
	}

	position(): Vec3 {
		return [...this.p];
	}
	rotation(): Quat {
		return [...this.q];
	}
	velocity(): Vec3 {
		return [...this.v];
	}
	angularVelocity(): Vec3 {
		return [...this.w];
	}
	sleeping(): boolean {
		return this.quiet >= SLEEP_TIME;
	}
	mass(): number {
		return this.world.massOf(this);
	}
	setEnabled(on: boolean): void {
		this.world.change((sim) => sim.setBodyEnabled(this.free("setEnabled"), on));
		// A disabled body keeps reading as it was when it left the world.
		this.enabled = on;
	}
	applyImpulse(impulse: Vec3): void {
		this.impulse = add(this.impulse, impulse);
	}
	setPose(position: Vec3, rotation: Quat): void {
		this.p = [...position];
		this.q = [...rotation];
		const p: Vec3 = [...position];
		const q: Quat = [...rotation];
		this.world.change((sim) =>
			sim.setBodyPose(this.free("setPose"), add(p, rotate(q, this.com)), q),
		);
	}
	setVelocity(linear: Vec3, angular: Vec3): void {
		this.v = [...linear];
		this.w = [...angular];
		const twist = [...linear, ...angular];
		this.world.change((sim) =>
			sim.setBodyTwist(this.free("setVelocity"), twist),
		);
	}
	setKinematicTarget(position: Vec3, rotation: Quat): void {
		this.target = { position: [...position], rotation: [...rotation] };
	}
	setCollisions(on: boolean): void {
		this.world.change((sim) => sim.setBodyCollisions(this.index, on));
	}
	setMass(kg: number): void {
		this.world.change((sim) => sim.setBodyMass(this.free("setMass"), kg));
	}

	/** This body's index, if Steel moves it freely (not as a link of an articulation). */
	private free(what: string): number {
		if (this.articulated)
			throw new Error(
				`Physics: ${what} on a jointed body is not supported on Steel yet.`,
			);
		return this.index;
	}
}

/** Shape options shared by every body's one shape. */
function material(spec: BodySpec3D, gap: number): ShapeOptions {
	return {
		density: spec.density,
		mu: spec.friction,
		restitution: spec.restitution,
		gap,
	};
}

/**
 * The contact gap of a `ccd` body, m. Steel's contacts are speculative: a
 * pair within its gap never closes more than the gap in a step, so a body
 * covering less than this per step cannot pass through anything.
 */
const CCD_GAP = 1;

/** A contact gap that suits the shape: a quarter of its smallest half size, 5 mm to 5 cm. */
function gapFor(shape: Shape3D): number {
	const size = (() => {
		switch (shape.kind) {
			case "ball":
				return shape.radius;
			case "box":
				return Math.min(shape.hx, shape.hy, shape.hz);
			case "cylinder":
				return Math.min(shape.radius, shape.halfHeight);
			default:
				return 0.2;
		}
	})();
	return Math.min(0.05, Math.max(0.005, size / 4));
}

/** A rounded box's border radius: at most half of each half size, so the core keeps a solid box. */
function borderOf(shape: {
	hx: number;
	hy: number;
	hz?: number;
	radius?: number;
}): number {
	return Math.min(
		shape.radius ?? 0,
		shape.hx / 2,
		shape.hy / 2,
		(shape.hz ?? Number.POSITIVE_INFINITY) / 2,
	);
}

/** A body's mass (kg) and inertia about its origin (3x3 row-major). */
interface MassProperties {
	mass: number;
	inertia: number[];
}

/** Cylinders run along y in the backend, along z in Steel: a quarter turn about x. */
const Z_TO_Y: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export class SteelWorld3D implements SimWorld3D {
	private builder: SceneBuilder;
	private sim?: Sim;
	private dt = 0;
	private readonly bodies: SteelBody3D[] = [];
	/** Bodies that got a wrench for the last step, to clear after it. */
	private wrenched = new Set<SteelBody3D>();
	private touching = new Set<string>();
	private readonly started: Array<[SimBody3D, SimBody3D]> = [];
	private gravity: Vec3;

	constructor(
		private readonly steel: Steel,
		private readonly device: GPUDevice,
		gravity: Vec3,
		/** Every body moves in the xy plane only (a 2D world). */
		private readonly planar = false,
	) {
		this.gravity = [...gravity];
		this.builder = new steel.SceneBuilder({ gravity: this.gravity });
	}

	/** Changes made before the world starts wait for the solver. */
	private pending: Array<(sim: Sim) => void> = [];

	/** The solver, for changes between steps. */
	solver(what: string): Sim {
		if (!this.sim)
			throw new Error(
				`Physics: ${what} needs the world started (Steel builds it once every body is in).`,
			);
		return this.sim;
	}

	/** Applies a change now, or as the world starts. */
	change(apply: (sim: Sim) => void): void {
		if (this.sim) apply(this.sim);
		else this.pending.push(apply);
	}

	massOf(body: SteelBody3D): number {
		return this.sim
			? this.sim.bodyMass(body.index)
			: this.builder.massOf(body.index);
	}

	/** `inertia` overrides the mass properties the shape and density give (2D bodies). */
	addBody(spec: BodySpec3D, inertia?: MassProperties): SimBody3D {
		if (this.sim)
			throw new Error("Physics: the world has started; add bodies before.");
		const locked = spec.lockRotation
			? [true, true, true]
			: spec.enabledRotations?.map((on) => !on);
		const w = spec.angularVelocity.map((v, i) => (locked?.[i] ? 0 : v));
		const options: BodyOptions = {
			xform: [...spec.position, ...spec.rotation],
			twist: [...spec.velocity, w[0], w[1], w[2]],
			kinematic: spec.type !== "dynamic",
			gravityScale: spec.gravityScale,
			linearDamping: spec.linearDamping,
			angularDamping: spec.angularDamping,
			planar: this.planar,
			...(inertia && { ...inertia, com: [0, 0, 0] }),
		};
		if (spec.shape.kind === "trimesh" && spec.type === "dynamic")
			throw new Error(
				'Physics: a triangle-mesh collider needs a fixed or kinematic body (use shape "hull" for a moving one).',
			);
		const index = this.builder.addBody(options);
		const shape = this.addShape(
			index,
			spec.shape,
			material(spec, spec.ccd ? CCD_GAP : gapFor(spec.shape)),
		);
		const body = new SteelBody3D(this, index, shape, {
			...spec,
			angularVelocity: [w[0], w[1], w[2]],
		});
		this.bodies.push(body);
		return body;
	}

	private addShape(body: number, shape: Shape3D, o: ShapeOptions): number {
		const b = this.builder;
		switch (shape.kind) {
			case "ball":
				return b.addShapeSphere(body, { radius: shape.radius, ...o });
			case "box":
				return b.addShapeBox(body, {
					hx: shape.hx,
					hy: shape.hy,
					hz: shape.hz,
					radius: borderOf(shape),
					...o,
				});
			case "cylinder":
				return b.addShapeCylinder(body, {
					radius: shape.radius,
					halfHeight: shape.halfHeight,
					xform: [0, 0, 0, ...Z_TO_Y],
					...o,
				});
			case "hull": {
				const vertices: number[][] = [];
				for (let i = 0; i + 2 < shape.points.length; i += 3)
					vertices.push(shape.points.slice(i, i + 3));
				return b.addShapeConvexHull(body, { vertices, ...o });
			}
			case "trimesh":
				return b.addShapeMesh(body, {
					vertices: shape.vertices,
					indices: shape.indices,
					...o,
				});
		}
	}

	addJoint(a: SimBody3D, b: SimBody3D, spec: JointSpec<Vec3>): void {
		if (this.sim)
			throw new Error("Physics: the world has started; add joints before.");
		const ba = a as SteelBody3D;
		const bb = b as SteelBody3D;
		if (spec.type === "spring") {
			this.builder.addSpring(ba.index, bb.index, {
				anchorA: spec.anchorA,
				anchorB: spec.anchorB,
				restLength: spec.restLength,
				stiffness: spec.stiffness,
				damping: spec.damping,
			});
			return;
		}
		if (spec.type === "rope") {
			this.builder.addRope(ba.index, bb.index, {
				anchorA: spec.anchorA,
				anchorB: spec.anchorB,
				length: spec.length,
			});
			return;
		}
		this.rigidJoint(ba, bb, spec);
		// Jointed bodies pass through each other where they meet.
		this.builder.addCollisionFilter(ba.shape, bb.shape);
	}

	/** A revolute, spherical or fixed joint: a fixed body joins as the world. */
	private rigidJoint(
		a: SteelBody3D,
		b: SteelBody3D,
		spec: Extract<
			JointSpec<Vec3>,
			{ type: "revolute" | "spherical" | "fixed" }
		>,
	): void {
		const fixedA = a.spec.type !== "dynamic";
		const fixedB = b.spec.type !== "dynamic";
		if (fixedA && fixedB) return;
		// The child: a dynamic body without a joint parent yet (else Steel closes a loop).
		const swap = fixedB || (!fixedA && b.linked && !a.linked);
		const [parent, child] = swap ? [b, a] : [a, b];
		const [anchorP, anchorC] = swap
			? [spec.anchorB, spec.anchorA]
			: [spec.anchorA, spec.anchorB];
		const world = parent.spec.type !== "dynamic";
		const qp = parent.spec.rotation;
		// The joint frame keeps the bodies' starting turn: child = parent · (conj(qc) · qp)⁻¹.
		const childRot = qmul(conj(child.spec.rotation), qp);
		const parentXform: [...Vec3, ...Quat] = world
			? [...add(parent.spec.position, rotate(qp, anchorP)), ...qp]
			: [...anchorP, ...IDENTITY];
		const options = {
			parentXform,
			childXform: [...anchorC, ...childRot] as [...Vec3, ...Quat],
			collisionFilterParent: true,
		};
		const p = world ? -1 : parent.index;
		if (spec.type === "revolute")
			this.builder.addJointRevolute(p, child.index, {
				axis: spec.axis ?? [0, 0, 1],
				...options,
			});
		else if (spec.type === "spherical")
			this.builder.addJointBall(p, child.index, options);
		else this.builder.addJointFixed(p, child.index, options);
		child.linked = true;
	}

	async start(dt: number): Promise<void> {
		if (this.sim) return;
		this.dt = dt;
		// One Steel frame per step, one substep each: the world's own substeps set the rate.
		const scene = this.builder.finalize({ solver: { substeps: 1 } });
		(scene.json as { fps: number }).fps = 1 / dt;
		this.sim = await this.steel.Sim.create(this.device, scene);
		const com = (scene.json as unknown as { bodies: { com: Vec3[] } }).bodies
			.com;
		for (const body of this.bodies) {
			body.com = [...com[body.index]];
			body.articulated = this.sim.bodyKind[body.index] !== 1;
		}
		for (const body of this.bodies) {
			const s = body.spec;
			if (body.articulated) continue;
			if (s.lockRotation || (this.planar && s.type === "dynamic"))
				this.sim.lockBodyRotation(body.index, [
					true,
					true,
					Boolean(s.lockRotation),
				]);
			else if (s.enabledRotations)
				this.sim.lockBodyRotation(body.index, [
					!s.enabledRotations[0],
					!s.enabledRotations[1],
					!s.enabledRotations[2],
				]);
		}
		for (const body of this.bodies) {
			if (body.spec.sensor) this.sim.setBodyCollisions(body.index, false);
			if (!body.spec.enabled) body.setEnabled(false);
		}
		for (const apply of this.pending.splice(0)) apply(this.sim);
		// Start from the solver's own state (float32, jointed bodies where their joints put them).
		this.mirror(await this.sim.state());
	}

	async step(dt: number): Promise<void> {
		const sim = this.solver("step");
		if (Math.abs(dt - this.dt) > 1e-12)
			throw new Error("Physics: Steel steps the dt it started with.");
		const wrenched = new Set<SteelBody3D>();
		for (const body of this.bodies) {
			if (body.target) {
				const t = body.target;
				const v = scale(sub(t.position, body.p), 1 / dt);
				sim.setBodyTwist(body.index, [
					...v,
					...angularVelocity(body.q, t.rotation, dt),
				]);
				body.target = undefined;
			}
			if (
				dot(body.impulse, body.impulse) +
					dot(body.angularImpulse, body.angularImpulse) >
				0
			) {
				sim.setBodyWrench(
					body.index,
					scale(body.impulse, 1 / dt),
					scale(body.angularImpulse, 1 / dt),
				);
				body.impulse = [0, 0, 0];
				body.angularImpulse = [0, 0, 0];
				wrenched.add(body);
			}
		}
		for (const body of this.wrenched)
			if (!wrenched.has(body))
				sim.setBodyWrench(body.index, [0, 0, 0], [0, 0, 0]);
		this.wrenched = wrenched;
		// Each body's velocity going into the step, to tell which contacts act in it.
		const before = this.bodies.map((b) => b.v);
		sim.step(1);
		const { contacts, ...state } = await sim.state({ contacts: true });
		this.mirror(state);
		const touching = new Set<string>();
		for (const c of contacts) {
			if (c.a < 0) continue;
			// A contact acts once the gap is no more than this step's approach
			// closes (Steel's speculative contacts stop bodies before they meet).
			const approach = dot(sub(before[c.a], before[c.b]), c.normal);
			if (c.phi > TOUCH + Math.max(0, approach) * dt) continue;
			const key = `${c.a}:${c.b}`;
			if (touching.has(key)) continue;
			touching.add(key);
			if (!this.touching.has(key))
				this.started.push([this.bodies[c.a], this.bodies[c.b]]);
		}
		this.touching = touching;
	}

	private mirror(state: SimState): void {
		const { bodyQ, bodyQd } = state;
		for (const body of this.bodies) {
			if (!body.enabled) continue;
			const b = body.index;
			body.p = [bodyQ[b * 7], bodyQ[b * 7 + 1], bodyQ[b * 7 + 2]];
			body.q = [
				bodyQ[b * 7 + 3],
				bodyQ[b * 7 + 4],
				bodyQ[b * 7 + 5],
				bodyQ[b * 7 + 6],
			];
			body.v = [bodyQd[b * 6], bodyQd[b * 6 + 1], bodyQd[b * 6 + 2]];
			body.w = [bodyQd[b * 6 + 3], bodyQd[b * 6 + 4], bodyQd[b * 6 + 5]];
			const slow =
				Math.hypot(...body.v) < SLEEP_LINEAR &&
				Math.hypot(...body.w) < SLEEP_ANGULAR;
			body.quiet = slow ? body.quiet + this.dt : 0;
		}
	}

	drainCollisionStarts(): Array<[SimBody3D, SimBody3D]> {
		return this.started.splice(0);
	}

	setGravity(gravity: Vec3): void {
		this.gravity = [...gravity];
		this.solver("setGravity").setGravity(gravity);
	}

	async snapshot(): Promise<Uint8Array> {
		const solver = await this.solver("snapshot").snapshot();
		const mine = new TextEncoder().encode(
			JSON.stringify({
				bodies: this.bodies.map((b) => [
					b.p,
					b.q,
					b.v,
					b.w,
					b.quiet,
					b.enabled,
				]),
				touching: [...this.touching],
				wrenched: [...this.wrenched].map((b) => b.index),
			}),
		);
		const out = new Uint8Array(4 + solver.byteLength + mine.byteLength);
		new DataView(out.buffer).setUint32(0, solver.byteLength, true);
		out.set(solver, 4);
		out.set(mine, 4 + solver.byteLength);
		return out;
	}

	async restore(snapshot: Uint8Array): Promise<void> {
		const sim = this.solver("restore");
		const n = new DataView(
			snapshot.buffer,
			snapshot.byteOffset,
			snapshot.byteLength,
		).getUint32(0, true);
		sim.restore(snapshot.subarray(4, 4 + n));
		const mine = JSON.parse(
			new TextDecoder().decode(snapshot.subarray(4 + n)),
		) as {
			bodies: Array<[Vec3, Quat, Vec3, Vec3, number, boolean]>;
			touching: string[];
			wrenched: number[];
		};
		for (const [i, [p, q, v, w, quiet, enabled]] of mine.bodies.entries())
			Object.assign(this.bodies[i], {
				p,
				q,
				v,
				w,
				quiet,
				enabled,
				target: undefined,
			});
		this.touching = new Set(mine.touching);
		this.wrenched = new Set(mine.wrenched.map((i) => this.bodies[i]));
		this.started.length = 0;
	}

	free(): void {
		this.sim?.destroy();
		this.sim = undefined;
	}
}

// ---------------------------------------------------------------------------
// 2D: planar 3D bodies
// ---------------------------------------------------------------------------

const to3 = (v: Vec2): Vec3 => [v[0], v[1], 0];
const angleOf = (q: Quat) => 2 * Math.atan2(q[2], q[3]);

/** A 2D shape extruded `DEPTH` along z. */
function extrude(shape: Shape2D): Shape3D {
	const hz = DEPTH / 2;
	switch (shape.kind) {
		case "box": {
			// Rounded in xy only as far as contacts go: the sphere-swept core keeps
			// its full depth and more (no planar contact meets a z face).
			const radius = borderOf(shape);
			return {
				kind: "box",
				hx: shape.hx,
				hy: shape.hy,
				hz: hz + 2 * radius,
				radius,
			};
		}
		case "ball":
			// A disc: a cylinder along z (the backend's cylinders run along y, turned below).
			return { kind: "hull", points: discPoints(shape.radius, hz) };
		case "hull": {
			const points: number[] = [];
			for (let i = 0; i + 1 < shape.points.length; i += 2)
				points.push(
					shape.points[i],
					shape.points[i + 1],
					-hz,
					shape.points[i],
					shape.points[i + 1],
					hz,
				);
			return { kind: "hull", points };
		}
	}
}

/**
 * A 2D shape's own mass properties, extruded `DEPTH`: the rounded rectangle
 * and the circle exactly (their 3D stand-ins are rounded in z, or a 48-gon).
 * Hull prisms are exact as built.
 */
function planarMass(
	shape: Shape2D,
	density: number,
): MassProperties | undefined {
	let area: number;
	let sx: number;
	let sy: number;
	if (shape.kind === "ball") {
		const r = shape.radius;
		area = Math.PI * r * r;
		sx = sy = (Math.PI * r ** 4) / 4;
	} else if (shape.kind === "box") {
		const r = borderOf(shape);
		const [a, b] = [shape.hx - r, shape.hy - r];
		// Two slabs over the core (counted once) and four quarter discs.
		const rect = (x: number, y: number) => {
			const A = 4 * x * y;
			return [A, (A * x * x) / 3, (A * y * y) / 3];
		};
		const parts = [rect(a + r, b), rect(a, b + r), rect(a, b).map((v) => -v)];
		const q = (Math.PI * r * r) / 4;
		const corner = (c: number) =>
			4 * (c * c * q + (2 * c * r ** 3) / 3 + (Math.PI * r ** 4) / 16);
		parts.push([4 * q, corner(a), corner(b)]);
		[area, sx, sy] = parts.reduce(
			(t, p) => t.map((v, i) => v + p[i]),
			[0, 0, 0],
		);
	} else return undefined;
	const m = density * area * DEPTH;
	const sz = (area * DEPTH ** 3) / 12;
	const k = density * DEPTH;
	return {
		mass: m,
		inertia: [
			k * sy + density * sz,
			0,
			0,
			0,
			k * sx + density * sz,
			0,
			0,
			0,
			k * (sx + sy),
		],
	};
}

/** A disc's prism: 48 sides, close enough that rolling reads as a circle. */
function discPoints(r: number, hz: number): number[] {
	const points: number[] = [];
	for (let k = 0; k < 48; k++) {
		const a = (k / 48) * 2 * Math.PI;
		points.push(
			r * Math.cos(a),
			r * Math.sin(a),
			-hz,
			r * Math.cos(a),
			r * Math.sin(a),
			hz,
		);
	}
	return points;
}

class SteelBody2D implements SimBody2D {
	constructor(readonly body: SimBody3D) {}
	position(): Vec2 {
		const p = this.body.position();
		return [p[0], p[1]];
	}
	rotation(): number {
		return angleOf(this.body.rotation());
	}
	velocity(): Vec2 {
		const v = this.body.velocity();
		return [v[0], v[1]];
	}
	angularVelocity(): number {
		return this.body.angularVelocity()[2];
	}
	sleeping(): boolean {
		return this.body.sleeping();
	}
	mass(): number {
		return this.body.mass();
	}
	setEnabled(on: boolean): void {
		this.body.setEnabled(on);
	}
	applyImpulse(impulse: Vec2): void {
		this.body.applyImpulse(to3(impulse));
	}
	setPose(position: Vec2, angle: number): void {
		this.body.setPose(to3(position), aboutZ(angle));
	}
	setVelocity(linear: Vec2, angular: number): void {
		this.body.setVelocity(to3(linear), [0, 0, angular]);
	}
	setKinematicTarget(position: Vec2, angle: number): void {
		this.body.setKinematicTarget(to3(position), aboutZ(angle));
	}
	setCollisions(on: boolean): void {
		this.body.setCollisions(on);
	}
	setMass(kg: number): void {
		this.body.setMass(kg);
	}
}

export class SteelWorld2D implements SimWorld2D {
	private readonly world: SteelWorld3D;
	private readonly of = new Map<SimBody3D, SteelBody2D>();

	constructor(steel: Steel, device: GPUDevice, gravity: Vec2) {
		this.world = new SteelWorld3D(steel, device, to3(gravity), true);
	}

	addBody(spec: BodySpec2D): SimBody2D {
		const body = this.world.addBody(
			{
				...spec,
				position: to3(spec.position),
				rotation: aboutZ(spec.angle),
				velocity: to3(spec.velocity),
				angularVelocity: [0, 0, spec.lockRotation ? 0 : spec.angularVelocity],
				shape: extrude(spec.shape),
			},
			planarMass(spec.shape, spec.density),
		);
		const b = new SteelBody2D(body);
		this.of.set(body, b);
		return b;
	}

	addJoint(a: SimBody2D, b: SimBody2D, spec: JointSpec<Vec2>): void {
		const anchors = { anchorA: to3(spec.anchorA), anchorB: to3(spec.anchorB) };
		const ba = (a as SteelBody2D).body;
		const bb = (b as SteelBody2D).body;
		this.world.addJoint(
			ba,
			bb,
			spec.type === "revolute"
				? { ...spec, ...anchors, axis: [0, 0, 1] }
				: ({ ...spec, ...anchors } as JointSpec<Vec3>),
		);
	}

	start(dt: number): Promise<void> {
		return this.world.start(dt);
	}

	step(dt: number): Promise<void> {
		return this.world.step(dt);
	}

	drainCollisionStarts(): Array<[SimBody2D, SimBody2D]> {
		return this.world
			.drainCollisionStarts()
			.map(([a, b]) => [
				this.of.get(a) as SteelBody2D,
				this.of.get(b) as SteelBody2D,
			]);
	}

	setGravity(gravity: Vec2): void {
		this.world.setGravity(to3(gravity));
	}

	snapshot(): Promise<Uint8Array> {
		return this.world.snapshot();
	}

	restore(snapshot: Uint8Array): Promise<void> {
		return this.world.restore(snapshot);
	}

	free(): void {
		this.world.free();
	}
}
