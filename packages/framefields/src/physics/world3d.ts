import type {
	AnimatableProp,
	LayoutNode,
} from "@framefields/compositions/program";
import type { FrameSignal } from "@framefields/core";
import type {
	BodySpec3D,
	PhysicsBackend,
	Quat,
	Shape3D,
	SimBody3D,
	SimWorld3D,
	Vec3,
} from "./backend.js";
import {
	type BodyCommonOptions,
	type CoreBody,
	type PhysicsCollision,
	type PhysicsDriver,
	type PhysicsWorldOptions,
	type Recording,
	sampleDriver,
	unwrapDegrees,
	WorldCore,
} from "./core.js";

export interface World3DOptions extends PhysicsWorldOptions {
	/** px/s², y down. A number pulls straight down. Default 2400. */
	gravity?: number | [number, number, number];
}

/** A plain box for bodies with no layer (invisible obstacles). Centered on x/y/z like Layer3D. */
export interface PhysicsBox3D {
	x: number;
	y: number;
	z: number;
	width: number;
	height: number;
	depth: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
}

export interface Body3DOptions extends BodyCommonOptions {
	/**
	 * Collider: `"auto"` (default) reads the Layer3D primitive (box, sphere,
	 * cylinder) and falls back to the mesh's convex hull for models and
	 * tapered or uneven shapes. Force `"box"`, `"sphere"`, `"cylinder"` or `"hull"`.
	 */
	shape?: "auto" | "box" | "sphere" | "cylinder" | "hull";
	/** Collider size override `[width, height, depth]`, px (before the layer's scale). */
	size?: [number, number, number];
	/** px/s. */
	velocity?: [number, number, number];
	/** Degrees per second around x, y, z. */
	angularVelocity?: [number, number, number];
	/** Kinematic bodies: the layer's `x` / `y` / `z` and `rotateX/Y/Z` each frame. */
	follow?: {
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		z?: PhysicsDriver;
		rotateX?: PhysicsDriver;
		rotateY?: PhysicsDriver;
		rotateZ?: PhysicsDriver;
	};
}

type LayerLike = Record<string, unknown> & { kind?: string };

const DEG = Math.PI / 180;

/** Quaternion of the renderer's Euler order: R = Rz · Ry · Rx (degrees). */
export function quatFromEuler(rx: number, ry: number, rz: number): Quat {
	const half = (d: number) => (d * DEG) / 2;
	const qx: Quat = [Math.sin(half(rx)), 0, 0, Math.cos(half(rx))];
	const qy: Quat = [0, Math.sin(half(ry)), 0, Math.cos(half(ry))];
	const qz: Quat = [0, 0, Math.sin(half(rz)), Math.cos(half(rz))];
	return quatMul(quatMul(qz, qy), qx);
}

function quatMul(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/**
 * Euler angles (degrees, R = Rz · Ry · Rx) for a quaternion, choosing of the
 * two equivalent solutions the one closest to `previous` and unwrapping each
 * angle, so rotations stay continuous frame to frame.
 */
export function eulerFromQuat(q: Quat, previous?: Vec3): Vec3 {
	const [x, y, z, w] = q;
	const r00 = 1 - 2 * (y * y + z * z);
	const r10 = 2 * (x * y + w * z);
	const r20 = 2 * (x * z - w * y);
	const r21 = 2 * (y * z + w * x);
	const r22 = 1 - 2 * (x * x + y * y);
	const r01 = 2 * (x * y - w * z);
	const r11 = 1 - 2 * (x * x + z * z);
	const sy = Math.max(-1, Math.min(1, -r20));
	let a: Vec3;
	if (Math.abs(sy) > 0.999999) {
		// Gimbal lock: only x - z (or x + z) is defined; keep x where it was.
		const ay = Math.asin(sy);
		const keepX = previous ? previous[0] * DEG : 0;
		const az = Math.atan2(-r01, r11) + (sy > 0 ? keepX : -keepX);
		a = [keepX, ay, az];
	} else {
		a = [Math.atan2(r21, r22), Math.asin(sy), Math.atan2(r10, r00)];
	}
	const first: Vec3 = [a[0] / DEG, a[1] / DEG, a[2] / DEG];
	if (!previous) return first;
	const second: Vec3 = [first[0] + 180, 180 - first[1], first[2] + 180];
	const unwrap = (c: Vec3): Vec3 => [
		unwrapDegrees(previous[0], c[0]),
		unwrapDegrees(previous[1], c[1]),
		unwrapDegrees(previous[2], c[2]),
	];
	const p = unwrap(first);
	const s = unwrap(second);
	const dist = (c: Vec3) =>
		Math.abs(c[0] - previous[0]) +
		Math.abs(c[1] - previous[1]) +
		Math.abs(c[2] - previous[2]);
	return dist(p) <= dist(s) ? p : s;
}

/**
 * A simulated 3D body. Like {@link PhysicsBody2D}, its signals hold one
 * value per composition frame and reading one runs the simulation.
 */
export class PhysicsBody3D implements CoreBody<Vec3, Quat> {
	readonly collisions: PhysicsCollision<PhysicsBody3D>[] = [];
	/** @internal */ readonly recording: Recording;
	/** @internal */ readonly sim: SimBody3D;

	/** @internal */
	constructor(
		/** @internal */ readonly world: PhysicsWorld3D,
		sim: SimBody3D,
		readonly type: "dynamic" | "fixed" | "kinematic",
		readonly layer: LayerLike | undefined,
		private readonly start: { position: Vec3; rotation: Vec3 },
		private readonly options: Body3DOptions,
		recording: Recording,
	) {
		this.sim = sim;
		this.recording = recording;
	}

	get startFrame(): number {
		return Math.max(0, Math.round(this.options.startFrame ?? 0));
	}
	get gravityScale(): number {
		return this.options.gravityScale ?? 1;
	}
	get output(): Body3DOptions["output"] {
		return this.options.output;
	}

	/** Center, px (what Layer3D's `x` / `y` / `z` mean). */
	get x(): FrameSignal<number> {
		return this.recording.signal("x");
	}
	get y(): FrameSignal<number> {
		return this.recording.signal("y");
	}
	get z(): FrameSignal<number> {
		return this.recording.signal("z");
	}
	/** Degrees, continuous. */
	get rotateX(): FrameSignal<number> {
		return this.recording.signal("rotateX");
	}
	get rotateY(): FrameSignal<number> {
		return this.recording.signal("rotateY");
	}
	get rotateZ(): FrameSignal<number> {
		return this.recording.signal("rotateZ");
	}
	/** px/s. */
	get vx(): FrameSignal<number> {
		return this.recording.signal("vx");
	}
	get vy(): FrameSignal<number> {
		return this.recording.signal("vy");
	}
	get vz(): FrameSignal<number> {
		return this.recording.signal("vz");
	}
	get speed(): FrameSignal<number> {
		return this.recording.signal("speed");
	}
	/** Hit envelope, as on 2D bodies. */
	get impact(): FrameSignal<number> {
		return this.recording.signal("impact");
	}
	/** 1 while the body is at rest, else 0. */
	get sleeping(): FrameSignal<number> {
		return this.recording.signal("sleeping");
	}

	/** @internal */
	kinematicTarget(
		frame: number,
	): { position: Vec3; rotation: Quat } | undefined {
		const follow = this.options.follow;
		if (this.type !== "kinematic" || !follow) return undefined;
		const fps = this.world.fps;
		const read = (d: PhysicsDriver | undefined, fallback: number) =>
			d === undefined ? fallback : sampleDriver(d, frame, fps);
		const p = this.start.position;
		const r = this.start.rotation;
		const ppm = this.world.pixelsPerMeter;
		return {
			position: [
				read(follow.x, p[0]) / ppm,
				read(follow.y, p[1]) / ppm,
				read(follow.z, p[2]) / ppm,
			],
			rotation: quatFromEuler(
				read(follow.rotateX, r[0]),
				read(follow.rotateY, r[1]),
				read(follow.rotateZ, r[2]),
			),
		};
	}

	/** @internal */
	record(index: number, previous: number): void {
		const ppm = this.world.pixelsPerMeter;
		const rec = this.recording;
		const [x, y, z] = this.sim.position();
		rec.channel("x")[index] = x * ppm;
		rec.channel("y")[index] = y * ppm;
		rec.channel("z")[index] = z * ppm;
		const rx = rec.channel("rotateX");
		const ry = rec.channel("rotateY");
		const rz = rec.channel("rotateZ");
		const prev: Vec3 =
			previous < 0
				? this.start.rotation
				: [rx[previous], ry[previous], rz[previous]];
		const e = eulerFromQuat(this.sim.rotation(), prev);
		rx[index] = e[0];
		ry[index] = e[1];
		rz[index] = e[2];
		const [vx, vy, vz] = this.sim.velocity();
		rec.channel("vx")[index] = vx * ppm;
		rec.channel("vy")[index] = vy * ppm;
		rec.channel("vz")[index] = vz * ppm;
		rec.channel("speed")[index] = Math.hypot(vx, vy, vz) * ppm;
		rec.channel("sleeping")[index] = this.sim.sleeping() ? 1 : 0;
	}

	/** @internal */
	boundChannels(): Array<[AnimatableProp, string]> {
		const out: Array<[AnimatableProp, string]> = [
			["x", "x"],
			["y", "y"],
			["z", "z"],
		];
		if (!this.options.lockRotation) {
			out.push(
				["rotateX", "rotateX"],
				["rotateY", "rotateY"],
				["rotateZ", "rotateZ"],
			);
		}
		return out;
	}

	/** @internal World point (px) → local frame (meters) at the start pose. */
	localAnchor(point: Vec3 | undefined): Vec3 {
		if (!point) return [0, 0, 0];
		const ppm = this.world.pixelsPerMeter;
		const p = this.sim.position();
		const [qx, qy, qz, qw] = this.sim.rotation();
		const v: Vec3 = [
			point[0] / ppm - p[0],
			point[1] / ppm - p[1],
			point[2] / ppm - p[2],
		];
		return rotateByQuat(v, [-qx, -qy, -qz, qw]);
	}

	/** @internal Start-pose center, px. */
	center(): Vec3 {
		const ppm = this.world.pixelsPerMeter;
		const [x, y, z] = this.sim.position();
		return [x * ppm, y * ppm, z * ppm];
	}
}

function rotateByQuat(v: Vec3, q: Quat): Vec3 {
	const r = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), [
		-q[0],
		-q[1],
		-q[2],
		q[3],
	]);
	return [r[0], r[1], r[2]];
}

/** What a {@link PhysicsWorld3D.field} sees for one body. */
export interface FieldSample3D {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	frame: number;
	body: PhysicsBody3D;
}

export interface PhysicsSpring3DOptions {
	length?: number;
	frequency?: number;
	dampingRatio?: number;
	anchorA?: Vec3;
	anchorB?: Vec3;
}

export interface PhysicsRope3DOptions {
	length?: number;
	anchorA?: Vec3;
	anchorB?: Vec3;
}

/**
 * A deterministic 3D rigid-body world (Rapier) for Layer3D primitives and
 * models, in the 3D scene's pixels (y down). Same flow as 2D: add bodies,
 * `simulate()`, and each layer's `x/y/z` and `rotateX/Y/Z` follow the
 * simulation; bodies expose signals for everything else.
 */
export class PhysicsWorld3D extends WorldCore<Vec3, Quat, PhysicsBody3D> {
	/** @internal */
	constructor(backend: PhysicsBackend, options: World3DOptions) {
		const ppm = options.pixelsPerMeter ?? 100;
		const g = options.gravity ?? 2400;
		const gravity: Vec3 =
			typeof g === "number"
				? [0, g / ppm, 0]
				: [g[0] / ppm, g[1] / ppm, g[2] / ppm];
		super(backend.createWorld3D(gravity) as never, gravity, options);
	}

	/** Adds a body for a Layer3D primitive or model (centered on its `x/y/z`), or a plain box. */
	body(
		target: LayoutNode | PhysicsBox3D,
		options: Body3DOptions = {},
	): PhysicsBody3D {
		this.assertOpen();
		const isLayer = typeof (target as unknown as LayerLike).kind === "string";
		const layer = isLayer ? (target as unknown as LayerLike) : undefined;
		const t = target as unknown as LayerLike;
		const position: Vec3 = [num(t.x, 0), num(t.y, 0), num(t.z, 0)];
		const rotation: Vec3 = [
			num(t.rotateX, 0),
			num(t.rotateY, 0),
			num(t.rotateZ, 0),
		];
		const ppm = this.pixelsPerMeter;
		const type = options.type ?? "dynamic";
		const v = options.velocity ?? [0, 0, 0];
		const w = options.angularVelocity ?? [0, 0, 0];
		const spec: BodySpec3D = {
			type,
			position: [position[0] / ppm, position[1] / ppm, position[2] / ppm],
			rotation: quatFromEuler(rotation[0], rotation[1], rotation[2]),
			velocity: [v[0] / ppm, v[1] / ppm, v[2] / ppm],
			angularVelocity: [w[0] * DEG, w[1] * DEG, w[2] * DEG],
			linearDamping: options.linearDamping ?? 0,
			angularDamping: options.angularDamping ?? 0,
			gravityScale: options.gravityScale ?? 1,
			lockRotation: options.lockRotation ?? false,
			ccd: options.ccd ?? false,
			enabled: true,
			sensor: options.sensor ?? false,
			density: options.density ?? 1,
			friction: options.friction ?? 0.6,
			restitution: options.restitution ?? 0.3,
			shape: scaleShape(colliderShape3D(t, options), 1 / ppm),
		};
		const simBody = (this.sim as unknown as SimWorld3D).addBody(spec);
		const body = new PhysicsBody3D(
			this,
			simBody,
			type,
			layer,
			{ position, rotation },
			options,
			this.newRecording(),
		);
		return this.addBody(body);
	}

	/** A fixed, very large floor whose top face sits at `y`. */
	ground(options: {
		y: number;
		friction?: number;
		restitution?: number;
	}): PhysicsBody3D {
		const t = 2000;
		return this.body(
			{ x: 0, y: options.y + t / 2, z: 0, width: 1e6, height: t, depth: 1e6 },
			{
				type: "fixed",
				friction: options.friction,
				restitution: options.restitution ?? 0.2,
			},
		);
	}

	/** Fixed floor and four walls around a box centered on `x`/`z`, floor at `y + height/2`. */
	walls(options: {
		x?: number;
		y?: number;
		z?: number;
		width: number;
		height: number;
		depth: number;
		thickness?: number;
		friction?: number;
		restitution?: number;
	}): PhysicsBody3D[] {
		const { width: W, height: H, depth: D } = options;
		const [x, y, z] = [options.x ?? 0, options.y ?? 0, options.z ?? 0];
		const t = options.thickness ?? 400;
		const mat = {
			type: "fixed" as const,
			friction: options.friction,
			restitution: options.restitution ?? 0.2,
		};
		const tall = H * 4;
		const wy = y + H / 2 - tall / 2;
		return [
			this.body(
				{
					x,
					y: y + H / 2 + t / 2,
					z,
					width: W + 2 * t,
					height: t,
					depth: D + 2 * t,
				},
				mat,
			),
			this.body(
				{
					x: x - W / 2 - t / 2,
					y: wy,
					z,
					width: t,
					height: tall,
					depth: D + 2 * t,
				},
				mat,
			),
			this.body(
				{
					x: x + W / 2 + t / 2,
					y: wy,
					z,
					width: t,
					height: tall,
					depth: D + 2 * t,
				},
				mat,
			),
			this.body(
				{ x, y: wy, z: z - D / 2 - t / 2, width: W, height: tall, depth: t },
				mat,
			),
			this.body(
				{ x, y: wy, z: z + D / 2 + t / 2, width: W, height: tall, depth: t },
				mat,
			),
		];
	}

	/** Pins a body to the world at a point (default its center); it can still turn around it. */
	pin(body: PhysicsBody3D, at?: Vec3): this {
		const point = at ?? body.center();
		const anchor = this.anchorBody(point);
		this.joint(body, anchor, {
			type: "spherical",
			anchorA: body.localAnchor(point),
			anchorB: [0, 0, 0],
		});
		return this;
	}

	/** Joins two bodies at a world point, turning only around `axis` (default z, facing the camera). */
	hinge(
		a: PhysicsBody3D,
		b: PhysicsBody3D,
		at: Vec3,
		axis: Vec3 = [0, 0, 1],
	): this {
		this.joint(a, b, {
			type: "revolute",
			anchorA: a.localAnchor(at),
			anchorB: b.localAnchor(at),
			axis,
		});
		return this;
	}

	/** Glues two bodies together rigidly. */
	weld(a: PhysicsBody3D, b: PhysicsBody3D): this {
		this.joint(a, b, {
			type: "fixed",
			anchorA: [0, 0, 0],
			anchorB: b.localAnchor(a.center()),
		});
		return this;
	}

	spring(
		a: PhysicsBody3D,
		b: PhysicsBody3D | Vec3,
		options: PhysicsSpring3DOptions = {},
	): this {
		const { other, pa, pb } = this.endpoints(
			a,
			b,
			options.anchorA,
			options.anchorB,
		);
		const ppm = this.pixelsPerMeter;
		const length = (options.length ?? dist(pa, pb)) / ppm;
		const ma = a.type === "dynamic" ? a.sim.mass() : 0;
		const mb = other.type === "dynamic" ? other.sim.mass() : 0;
		const mass =
			ma > 0 && mb > 0 ? (ma * mb) / (ma + mb) : Math.max(ma, mb, 1e-3);
		const w = 2 * Math.PI * (options.frequency ?? 2);
		this.joint(a, other, {
			type: "spring",
			anchorA: a.localAnchor(pa),
			anchorB: other.localAnchor(pb),
			restLength: length,
			stiffness: mass * w * w,
			damping: 2 * (options.dampingRatio ?? 0.2) * mass * w,
		});
		return this;
	}

	rope(
		a: PhysicsBody3D,
		b: PhysicsBody3D | Vec3,
		options: PhysicsRope3DOptions = {},
	): this {
		const { other, pa, pb } = this.endpoints(
			a,
			b,
			options.anchorA,
			options.anchorB,
		);
		this.joint(a, other, {
			type: "rope",
			anchorA: a.localAnchor(pa),
			anchorB: other.localAnchor(pb),
			length: (options.length ?? dist(pa, pb)) / this.pixelsPerMeter,
		});
		return this;
	}

	/** A steady push, px/s² (mass-independent). Drivers are read every frame. */
	force(
		body: PhysicsBody3D,
		accel: { x?: PhysicsDriver; y?: PhysicsDriver; z?: PhysicsDriver },
	): this {
		const ppm = this.pixelsPerMeter;
		const read = (d: PhysicsDriver | undefined, frame: number) =>
			d === undefined ? 0 : sampleDriver(d, frame, this.fps) / ppm;
		this.addForce(body, (frame) => [
			read(accel.x, frame),
			read(accel.y, frame),
			read(accel.z, frame),
		]);
		return this;
	}

	/** A force field, as in 2D: returns `[ax, ay, az]` px/s² for a body at `x/y/z` px. */
	field(
		accel: (sample: FieldSample3D) => Vec3 | null | undefined,
		options: { bodies?: readonly PhysicsBody3D[] } = {},
	): this {
		const ppm = this.pixelsPerMeter;
		this.addField((body, frame) => {
			const [x, y, z] = body.sim.position();
			const [vx, vy, vz] = body.sim.velocity();
			const a = accel({
				x: x * ppm,
				y: y * ppm,
				z: z * ppm,
				vx: vx * ppm,
				vy: vy * ppm,
				vz: vz * ppm,
				frame,
				body,
			});
			return a ? [a[0] / ppm, a[1] / ppm, a[2] / ppm] : null;
		}, options.bodies);
		return this;
	}

	/** An instant kick at a simulation frame: adds `[vx, vy, vz]` px/s. */
	impulse(body: PhysicsBody3D, frame: number, velocity: Vec3): this {
		const ppm = this.pixelsPerMeter;
		this.addImpulse(body, frame, [
			velocity[0] / ppm,
			velocity[1] / ppm,
			velocity[2] / ppm,
		]);
		return this;
	}

	protected lerpRotation(a: Quat, b: Quat, t: number): Quat {
		// Normalized lerp along the short arc; fine for per-substep steps.
		const sign =
			a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
		const q = a.map((v, i) => v + (b[i] * sign - v) * t) as Quat;
		const len = Math.hypot(...q) || 1;
		return q.map((v) => v / len) as Quat;
	}

	private joint(
		a: PhysicsBody3D,
		b: PhysicsBody3D,
		spec: Parameters<SimWorld3D["addJoint"]>[2],
	): void {
		this.assertOpen();
		(this.sim as unknown as SimWorld3D).addJoint(a.sim, b.sim, spec);
	}

	private anchorBody(point: Vec3): PhysicsBody3D {
		return this.body(
			{ x: point[0], y: point[1], z: point[2], width: 1, height: 1, depth: 1 },
			{ type: "fixed", output: "none", sensor: true },
		);
	}

	private endpoints(
		a: PhysicsBody3D,
		b: PhysicsBody3D | Vec3,
		anchorA?: Vec3,
		anchorB?: Vec3,
	): { other: PhysicsBody3D; pa: Vec3; pb: Vec3 } {
		const pa = anchorA ?? a.center();
		if (Array.isArray(b)) {
			const pb = anchorB ?? b;
			return { other: this.anchorBody(pb), pa, pb };
		}
		return { other: b, pa, pb: anchorB ?? b.center() };
	}
}

function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface PrimitiveSpec {
	type?: string;
	width?: number;
	height?: number;
	depth?: number;
	radius?: number;
	radiusTop?: number;
	radiusBottom?: number;
	taper?: number;
}

/** Collider in px around the layer's center, with the layer's scale applied. */
function colliderShape3D(t: LayerLike, options: Body3DOptions): Shape3D {
	const id = typeof t.id === "string" ? ` "${t.id}"` : "";
	const s = num(t.scale, 1);
	const scale: Vec3 = [
		s * num(t.scaleX, 1),
		s * num(t.scaleY, 1),
		s * num(t.scaleZ, 1),
	];
	const uniform = scale[0] === scale[1] && scale[1] === scale[2];
	const prim = (t.primitive3d ?? {}) as PrimitiveSpec;
	const mode = options.shape ?? "auto";
	const hull = (): Shape3D | undefined => {
		const pts = meshPoints(t.modelData);
		if (!pts) return undefined;
		return { kind: "hull", points: pts.map((v, i) => v * scale[i % 3]) };
	};

	if (options.size || mode === "box") {
		const [w, h, d] = options.size ?? boxSize(t, prim) ?? [0, 0, 0];
		if (w > 0 && h > 0 && d > 0) {
			return {
				kind: "box",
				hx: (w * scale[0]) / 2,
				hy: (h * scale[1]) / 2,
				hz: (d * scale[2]) / 2,
				radius:
					prim.type === "roundedBox"
						? num(prim.radius, 0) * Math.min(...scale)
						: 0,
			};
		}
	}
	if (mode === "hull") {
		const h = hull();
		if (h) return h;
	}
	const sphere =
		mode === "sphere" || (mode === "auto" && prim.type === "sphere");
	if (sphere && (uniform || mode === "sphere")) {
		const r = num(prim.radius, 0) || Math.max(...(boxSize(t, prim) ?? [0])) / 2;
		if (r > 0) return { kind: "ball", radius: r * Math.max(...scale) };
	}
	const rTop = num(prim.radiusTop, num(prim.radius, 0));
	const rBottom = num(prim.radiusBottom, num(prim.radius, 0));
	const cylinder =
		mode === "cylinder" || (mode === "auto" && prim.type === "cylinder");
	if (cylinder && rTop === rBottom && rTop > 0 && scale[0] === scale[2]) {
		return {
			kind: "cylinder",
			halfHeight: (num(prim.height, 0) * scale[1]) / 2,
			radius: rTop * scale[0],
		};
	}
	if (
		mode === "auto" &&
		prim.type === "roundedBox" &&
		(prim.taper ?? 1) === 1
	) {
		const [w, h, d] = [
			num(prim.width, 0),
			num(prim.height, 0),
			num(prim.depth, 0),
		];
		return {
			kind: "box",
			hx: (w * scale[0]) / 2,
			hy: (h * scale[1]) / 2,
			hz: (d * scale[2]) / 2,
			radius: num(prim.radius, 0) * Math.min(...scale),
		};
	}
	const h = hull();
	if (h) return h;
	const size = boxSize(t, prim);
	if (size) {
		return {
			kind: "box",
			hx: (size[0] * scale[0]) / 2,
			hy: (size[1] * scale[1]) / 2,
			hz: (size[2] * scale[2]) / 2,
		};
	}
	throw new Error(
		`Physics: layer${id} has no mesh or size to build a 3D collider from; pass \`size: [w, h, d]\`.`,
	);
}

function boxSize(t: LayerLike, prim: PrimitiveSpec): Vec3 | undefined {
	if (prim.type === "roundedBox")
		return [num(prim.width, 0), num(prim.height, 0), num(prim.depth, 0)];
	if (prim.type === "sphere") {
		const d = num(prim.radius, 0) * 2;
		return [d, d, d];
	}
	if (prim.type === "cylinder") {
		const d =
			Math.max(
				num(prim.radiusTop, num(prim.radius, 0)),
				num(prim.radiusBottom, num(prim.radius, 0)),
			) * 2;
		return [d, num(prim.height, 0), d];
	}
	if (
		typeof t.width === "number" &&
		typeof t.height === "number" &&
		typeof t.depth === "number"
	) {
		return [t.width, t.height, t.depth];
	}
	return undefined;
}

/** Every vertex of a model, flat xyz, at most ~4k points (the hull needs no more). */
function meshPoints(modelData: unknown): number[] | undefined {
	const meshes = (
		modelData as
			| { meshes?: Array<{ positions?: ArrayLike<number> }> }
			| undefined
	)?.meshes;
	if (!meshes?.length) return undefined;
	let total = 0;
	for (const m of meshes) total += (m.positions?.length ?? 0) / 3;
	if (total < 4) return undefined;
	const stride = Math.max(1, Math.floor(total / 4096));
	const out: number[] = [];
	let i = 0;
	for (const m of meshes) {
		const p = m.positions;
		if (!p) continue;
		for (let v = 0; v < p.length; v += 3, i++) {
			if (i % stride === 0) out.push(p[v], p[v + 1], p[v + 2]);
		}
	}
	return out;
}

function scaleShape(shape: Shape3D, s: number): Shape3D {
	switch (shape.kind) {
		case "ball":
			return { kind: "ball", radius: shape.radius * s };
		case "box":
			return {
				kind: "box",
				hx: shape.hx * s,
				hy: shape.hy * s,
				hz: shape.hz * s,
				radius: (shape.radius ?? 0) * s,
			};
		case "cylinder":
			return {
				kind: "cylinder",
				halfHeight: shape.halfHeight * s,
				radius: shape.radius * s,
			};
		case "hull":
			return { kind: "hull", points: shape.points.map((v) => v * s) };
	}
}
