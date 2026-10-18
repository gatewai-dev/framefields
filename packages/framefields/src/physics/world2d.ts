import type {
	AnimatableProp,
	LayoutNode,
} from "@framefields/compositions/program";
import type { FrameSignal } from "@framefields/core";
import {
	buildShapeSvgPath,
	parseSvgPathToSegments,
	type ShapeGeometryConfig,
} from "@framefields/webgpu-renderers";
import { FontManager } from "../fonts/manager.js";
import type {
	BodySpec2D,
	PhysicsBackend,
	Shape2D,
	SimBody2D,
	SimWorld2D,
	Vec2,
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

export interface World2DOptions extends PhysicsWorldOptions {
	/** px/s², y down. A number pulls straight down. Default 2400. */
	gravity?: number | [number, number];
}

/** A plain rectangle for bodies with no layer (invisible obstacles, funnels). */
export interface PhysicsRect {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
	borderRadius?: number;
}

export interface Body2DOptions extends BodyCommonOptions {
	/**
	 * Collider: `"auto"` (default) reads the layer — circles stay circles,
	 * rounded boxes keep their radius, polygons/stars/paths use their convex
	 * hull. Force `"box"`, `"circle"` or `"hull"` (the shape's outline).
	 */
	shape?: "auto" | "box" | "circle" | "hull";
	/** Collider size override `[width, height]`, px. Text layers are measured when they have no size. */
	size?: [number, number];
	/** px/s. */
	velocity?: [number, number];
	/** Degrees per second, clockwise. */
	angularVelocity?: number;
	/**
	 * Kinematic bodies: where the layer is each frame, as its own `x` / `y`
	 * (top-left) and `rotation` (degrees). Missing ones keep the start pose.
	 */
	follow?: { x?: PhysicsDriver; y?: PhysicsDriver; rotation?: PhysicsDriver };
}

type LayerLike = Record<string, unknown> & {
	kind?: string;
	animate?: (...a: unknown[]) => unknown;
};

/**
 * A simulated body. Its signals hold one value per composition frame; bind
 * them to any prop or effect uniform (`.signal("opacity", body.impact)`).
 * Reading a signal runs the simulation if it has not run yet.
 */
export class PhysicsBody2D implements CoreBody<Vec2, number> {
	readonly collisions: PhysicsCollision<PhysicsBody2D>[] = [];
	/** @internal */ readonly recording: Recording;
	/** @internal */ readonly sim: SimBody2D;

	/** @internal */
	constructor(
		/** @internal */ readonly world: PhysicsWorld2D,
		sim: SimBody2D,
		readonly type: "dynamic" | "fixed" | "kinematic",
		readonly layer: LayerLike | undefined,
		/** Layer box size (unscaled), scale and pivot, to turn the center back into x/y. */
		private readonly frame: {
			width: number;
			height: number;
			scale: number;
			anchorX: number;
			anchorY: number;
			rotation: number;
		},
		private readonly options: Body2DOptions,
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
	get output(): Body2DOptions["output"] {
		return this.options.output;
	}

	/** The layer's `x` (top-left) every frame. */
	get x(): FrameSignal<number> {
		return this.recording.signal("x");
	}
	/** The layer's `y` (top-left) every frame. */
	get y(): FrameSignal<number> {
		return this.recording.signal("y");
	}
	/** Degrees, clockwise, continuous (no jump at 360). */
	get rotation(): FrameSignal<number> {
		return this.recording.signal("rotation");
	}
	/** Body center, px. */
	get centerX(): FrameSignal<number> {
		return this.recording.signal("centerX");
	}
	get centerY(): FrameSignal<number> {
		return this.recording.signal("centerY");
	}
	/** px/s. */
	get vx(): FrameSignal<number> {
		return this.recording.signal("vx");
	}
	get vy(): FrameSignal<number> {
		return this.recording.signal("vy");
	}
	/** px/s. */
	get speed(): FrameSignal<number> {
		return this.recording.signal("speed");
	}
	/** Degrees per second. */
	get angularVelocity(): FrameSignal<number> {
		return this.recording.signal("angularVelocity");
	}
	/**
	 * Hit envelope: jumps on each new contact (1 ≈ a 1500 px/s velocity
	 * change, see `impactReference`) and decays over `impactDecay` frames.
	 */
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
	): { position: Vec2; rotation: number } | undefined {
		const follow = this.options.follow;
		if (this.type !== "kinematic" || !follow) return undefined;
		const f = this.frame;
		const fps = this.world.fps;
		const x =
			follow.x === undefined ? undefined : sampleDriver(follow.x, frame, fps);
		const y =
			follow.y === undefined ? undefined : sampleDriver(follow.y, frame, fps);
		const rotation =
			follow.rotation === undefined
				? f.rotation
				: sampleDriver(follow.rotation, frame, fps);
		const start = this.initialLayerXY();
		const center = layerToCenter(x ?? start[0], y ?? start[1], rotation, f);
		const ppm = this.world.pixelsPerMeter;
		return {
			position: [center[0] / ppm, center[1] / ppm],
			rotation: (rotation * Math.PI) / 180,
		};
	}

	private initialLayerXY(): Vec2 {
		const l = this.layer;
		return [Number(l?.x ?? 0), Number(l?.y ?? 0)];
	}

	/** @internal */
	record(index: number, previous: number): void {
		const ppm = this.world.pixelsPerMeter;
		const [mx, my] = this.sim.position();
		const cx = mx * ppm;
		const cy = my * ppm;
		const rec = this.recording;
		const rotation = rec.channel("rotation");
		const deg = (this.sim.rotation() * 180) / Math.PI;
		rotation[index] =
			previous < 0
				? unwrapDegrees(this.frame.rotation, deg)
				: unwrapDegrees(rotation[previous], deg);
		const [x, y] = centerToLayer(cx, cy, rotation[index], this.frame);
		rec.channel("x")[index] = x;
		rec.channel("y")[index] = y;
		rec.channel("centerX")[index] = cx;
		rec.channel("centerY")[index] = cy;
		const [vx, vy] = this.sim.velocity();
		rec.channel("vx")[index] = vx * ppm;
		rec.channel("vy")[index] = vy * ppm;
		rec.channel("speed")[index] = Math.hypot(vx, vy) * ppm;
		rec.channel("angularVelocity")[index] =
			(this.sim.angularVelocity() * 180) / Math.PI;
		rec.channel("sleeping")[index] = this.sim.sleeping() ? 1 : 0;
	}

	/** @internal */
	boundChannels(): Array<[AnimatableProp, string]> {
		const out: Array<[AnimatableProp, string]> = [
			["x", "x"],
			["y", "y"],
		];
		if (!this.options.lockRotation) out.push(["rotation", "rotation"]);
		return out;
	}

	/** @internal World-space point (px) → this body's local frame (meters), at the start pose. */
	localAnchor(point: Vec2 | undefined): Vec2 {
		if (!point) return [0, 0];
		const ppm = this.world.pixelsPerMeter;
		const [px, py] = this.sim.position();
		const a = -this.sim.rotation();
		const dx = point[0] / ppm - px;
		const dy = point[1] / ppm - py;
		return [
			dx * Math.cos(a) - dy * Math.sin(a),
			dx * Math.sin(a) + dy * Math.cos(a),
		];
	}

	/** @internal Start-pose center in px. */
	center(): Vec2 {
		const ppm = this.world.pixelsPerMeter;
		const [x, y] = this.sim.position();
		return [x * ppm, y * ppm];
	}
}

/** What a {@link PhysicsWorld2D.field} sees for one body. */
export interface FieldSample2D {
	/** Body center, px. */
	x: number;
	y: number;
	/** px/s. */
	vx: number;
	vy: number;
	/** Composition frame. */
	frame: number;
	body: PhysicsBody2D;
}

export interface PhysicsSpringOptions {
	/** Rest length, px (default: the distance at the start). */
	length?: number;
	/** Oscillations per second (default 2). Higher is stiffer. */
	frequency?: number;
	/** 0 bounces forever, 1 settles without overshoot (default 0.2). */
	dampingRatio?: number;
	/** Attachment point on body A, world px at the start (default its center). */
	anchorA?: [number, number];
	/** Attachment point on body B (or the world point), world px. */
	anchorB?: [number, number];
}

export interface PhysicsRopeOptions {
	/** Maximum length, px (default: the distance at the start). */
	length?: number;
	anchorA?: [number, number];
	anchorB?: [number, number];
}

export interface PhysicsGroundOptions {
	/** Top edge of the ground, px. */
	y: number;
	friction?: number;
	restitution?: number;
}

export interface PhysicsWallsOptions {
	x?: number;
	y?: number;
	width: number;
	height: number;
	/** Close the top too (default false: things can fall in). */
	ceiling?: boolean;
	/** Wall thickness outside the box, px (default 400). */
	thickness?: number;
	friction?: number;
	restitution?: number;
}

/**
 * A deterministic 2D rigid-body world (Rapier) in layer pixels. Build it,
 * add bodies from layers, then `simulate()`: each body's layer is bound to
 * its simulated `x` / `y` / `rotation`, and every body exposes signals
 * (`impact`, `speed`, …) for driving anything else. The simulation runs
 * once while the composition is built, so frames render in any order and
 * identically on every machine.
 */
export class PhysicsWorld2D extends WorldCore<Vec2, number, PhysicsBody2D> {
	/** @internal */
	constructor(backend: PhysicsBackend, options: World2DOptions) {
		const ppm = options.pixelsPerMeter ?? 100;
		const g = options.gravity ?? 2400;
		const gravity: Vec2 =
			typeof g === "number" ? [0, g / ppm] : [g[0] / ppm, g[1] / ppm];
		const sim = backend.createWorld2D(gravity);
		super(sim as never, gravity, options);
	}

	/**
	 * Adds a body for a layer (absolutely positioned: `x`, `y`, and a size)
	 * or for a plain rectangle. The layer's current pose is the start pose.
	 */
	body(
		target: LayoutNode | PhysicsRect,
		options: Body2DOptions = {},
	): PhysicsBody2D {
		this.assertOpen();
		const isLayer = typeof (target as unknown as LayerLike).kind === "string";
		const layer = isLayer ? (target as unknown as LayerLike) : undefined;
		const geom = layerGeometry(target as unknown as LayerLike, options);
		const ppm = this.pixelsPerMeter;
		const type = options.type ?? "dynamic";
		const [cx, cy] = layerToCenter(geom.x, geom.y, geom.rotation, geom);
		const v = options.velocity ?? [0, 0];
		const spec: BodySpec2D = {
			type,
			position: [cx / ppm, cy / ppm],
			angle: (geom.rotation * Math.PI) / 180,
			velocity: [v[0] / ppm, v[1] / ppm],
			angularVelocity: ((options.angularVelocity ?? 0) * Math.PI) / 180,
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
			shape: scaleShape(geom.shape, 1 / ppm),
		};
		const simBody = (this.sim as unknown as SimWorld2D).addBody(spec);
		const body = new PhysicsBody2D(
			this,
			simBody,
			type,
			layer,
			geom,
			options,
			this.newRecording(),
		);
		return this.addBody(body);
	}

	/** A fixed, very wide floor whose top edge sits at `y`. */
	ground(options: PhysicsGroundOptions): PhysicsBody2D {
		const t = 2000;
		const w = 1e6;
		return this.body(
			{ x: -w / 2, y: options.y, width: w, height: t },
			{
				type: "fixed",
				friction: options.friction,
				restitution: options.restitution ?? 0.2,
			},
		);
	}

	/** Fixed floor, left and right walls (and optionally a ceiling) around a box, e.g. the canvas. */
	walls(options: PhysicsWallsOptions): {
		floor: PhysicsBody2D;
		left: PhysicsBody2D;
		right: PhysicsBody2D;
		ceiling?: PhysicsBody2D;
	} {
		const { width: W, height: H } = options;
		const x = options.x ?? 0;
		const y = options.y ?? 0;
		const t = options.thickness ?? 400;
		const mat = {
			type: "fixed" as const,
			friction: options.friction,
			restitution: options.restitution ?? 0.2,
		};
		const tall = H * 4 + t;
		const result = {
			floor: this.body(
				{ x: x - t, y: y + H, width: W + 2 * t, height: t },
				mat,
			),
			left: this.body(
				{ x: x - t, y: y + H - tall, width: t, height: tall },
				mat,
			),
			right: this.body(
				{ x: x + W, y: y + H - tall, width: t, height: tall },
				mat,
			),
			ceiling: undefined as PhysicsBody2D | undefined,
		};
		if (options.ceiling) {
			result.ceiling = this.body(
				{ x: x - t, y: y - t, width: W + 2 * t, height: t },
				mat,
			);
		}
		return result;
	}

	/** Pins a body to the world at a point (default its center); it can still swing around it. */
	pin(body: PhysicsBody2D, at?: [number, number]): this {
		const point = at ?? body.center();
		const anchor = this.anchorBody(point);
		this.joint(body, anchor, {
			type: "revolute",
			anchorA: body.localAnchor(point),
			anchorB: [0, 0],
		});
		return this;
	}

	/** Joins two bodies at a world point so they swing around it (a hinge). */
	hinge(a: PhysicsBody2D, b: PhysicsBody2D, at: [number, number]): this {
		this.joint(a, b, {
			type: "revolute",
			anchorA: a.localAnchor(at),
			anchorB: b.localAnchor(at),
		});
		return this;
	}

	/** Glues two bodies together rigidly. */
	weld(a: PhysicsBody2D, b: PhysicsBody2D): this {
		const at = a.center();
		this.joint(a, b, {
			type: "fixed",
			anchorA: [0, 0],
			anchorB: b.localAnchor(at),
		});
		return this;
	}

	/** A damped spring between two bodies, or from a body to a world point. */
	spring(
		a: PhysicsBody2D,
		b: PhysicsBody2D | [number, number],
		options: PhysicsSpringOptions = {},
	): this {
		const { other, pa, pb } = this.endpoints(
			a,
			b,
			options.anchorA,
			options.anchorB,
		);
		const ppm = this.pixelsPerMeter;
		const length =
			(options.length ?? Math.hypot(pb[0] - pa[0], pb[1] - pa[1])) / ppm;
		const mass = effectiveMass(a, other);
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

	/** A rope: never longer than `length`, slack when closer. */
	rope(
		a: PhysicsBody2D,
		b: PhysicsBody2D | [number, number],
		options: PhysicsRopeOptions = {},
	): this {
		const { other, pa, pb } = this.endpoints(
			a,
			b,
			options.anchorA,
			options.anchorB,
		);
		const length = options.length ?? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
		this.joint(a, other, {
			type: "rope",
			anchorA: a.localAnchor(pa),
			anchorB: other.localAnchor(pb),
			length: length / this.pixelsPerMeter,
		});
		return this;
	}

	/** A steady push, px/s² (mass-independent): wind, magnets, audio. Drivers are read every frame. */
	force(
		body: PhysicsBody2D,
		accel: { x?: PhysicsDriver; y?: PhysicsDriver },
	): this {
		const ppm = this.pixelsPerMeter;
		this.addForce(body, (frame) => [
			accel.x === undefined ? 0 : sampleDriver(accel.x, frame, this.fps) / ppm,
			accel.y === undefined ? 0 : sampleDriver(accel.y, frame, this.fps) / ppm,
		]);
		return this;
	}

	/**
	 * A force field: called for every awake dynamic body (or just `bodies`)
	 * each solver step with its center and velocity in px, px/s; returns an
	 * acceleration `[ax, ay]` px/s² (or nothing). Wind, vortices, magnets,
	 * flow fields, a dancer's silhouette pushing particles.
	 */
	field(
		accel: (sample: FieldSample2D) => [number, number] | null | undefined,
		options: { bodies?: readonly PhysicsBody2D[] } = {},
	): this {
		const ppm = this.pixelsPerMeter;
		this.addField((body, frame) => {
			const [x, y] = body.sim.position();
			const [vx, vy] = body.sim.velocity();
			const a = accel({
				x: x * ppm,
				y: y * ppm,
				vx: vx * ppm,
				vy: vy * ppm,
				frame,
				body,
			});
			return a ? [a[0] / ppm, a[1] / ppm] : null;
		}, options.bodies);
		return this;
	}

	/** An instant kick at a simulation frame: adds `[vx, vy]` px/s to the body's velocity. */
	impulse(
		body: PhysicsBody2D,
		frame: number,
		velocity: [number, number],
	): this {
		const ppm = this.pixelsPerMeter;
		this.addImpulse(body, frame, [velocity[0] / ppm, velocity[1] / ppm]);
		return this;
	}

	protected lerpRotation(a: number, b: number, t: number): number {
		return a + (b - a) * t;
	}

	private joint(
		a: PhysicsBody2D,
		b: PhysicsBody2D,
		spec: Parameters<SimWorld2D["addJoint"]>[2],
	): void {
		this.assertOpen();
		(this.sim as unknown as SimWorld2D).addJoint(a.sim, b.sim, spec);
	}

	private anchorBody(point: [number, number]): PhysicsBody2D {
		return this.body(
			{ x: point[0] - 0.5, y: point[1] - 0.5, width: 1, height: 1 },
			{ type: "fixed", output: "none", sensor: true },
		);
	}

	private endpoints(
		a: PhysicsBody2D,
		b: PhysicsBody2D | [number, number],
		anchorA?: [number, number],
		anchorB?: [number, number],
	): { other: PhysicsBody2D; pa: Vec2; pb: Vec2 } {
		const pa = anchorA ?? a.center();
		if (Array.isArray(b)) {
			const pb = anchorB ?? b;
			return { other: this.anchorBody(pb), pa, pb };
		}
		return { other: b, pa, pb: anchorB ?? b.center() };
	}
}

function effectiveMass(a: PhysicsBody2D, b: PhysicsBody2D): number {
	const ma = a.type === "dynamic" ? a.sim.mass() : 0;
	const mb = b.type === "dynamic" ? b.sim.mass() : 0;
	if (ma > 0 && mb > 0) return (ma * mb) / (ma + mb);
	return Math.max(ma, mb, 1e-3);
}

interface LayerGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	scale: number;
	anchorX: number;
	anchorY: number;
	rotation: number;
	/** Collider in px, around the box center, already scaled. */
	shape: Shape2D;
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function layerGeometry(
	layer: LayerLike,
	options: Body2DOptions,
): LayerGeometry {
	const id = typeof layer.id === "string" ? ` "${layer.id}"` : "";
	if (typeof layer.x !== "number" || typeof layer.y !== "number") {
		throw new Error(
			`Physics: layer${id} needs numeric \`x\` and \`y\` (absolute position) to become a body.`,
		);
	}
	let width =
		options.size?.[0] ??
		(typeof layer.width === "number" ? layer.width : undefined);
	let height =
		options.size?.[1] ??
		(typeof layer.height === "number" ? layer.height : undefined);
	if ((width === undefined || height === undefined) && layer.kind === "text") {
		const m = FontManager.measure(String(layer.text ?? ""), {
			fontFamily: String(layer.fontFamily ?? "Inter"),
			fontSize: num(layer.fontSize, 48),
			fontWeight: layer.fontWeight as never,
			letterSpacing: num(layer.letterSpacing, 0),
			lineHeight:
				typeof layer.lineHeight === "number" ? layer.lineHeight : undefined,
		});
		width ??= m.width;
		height ??= m.height;
	}
	if (
		width === undefined ||
		height === undefined ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(
			`Physics: layer${id} needs a numeric \`width\` and \`height\` (or the \`size\` option) to become a body.`,
		);
	}
	const scale = num(layer.scale, 1);
	const geom = {
		x: layer.x,
		y: layer.y,
		width,
		height,
		scale,
		anchorX: num(layer.anchorX, 0.5),
		anchorY: num(layer.anchorY, 0.5),
		rotation: num(layer.rotation, 0),
	};
	return {
		...geom,
		shape: scaleShape(
			colliderShape(layer, width, height, options.shape ?? "auto"),
			scale,
		),
	};
}

function colliderShape(
	layer: LayerLike,
	w: number,
	h: number,
	mode: NonNullable<Body2DOptions["shape"]>,
): Shape2D {
	const isShape = layer.kind === "shape";
	const shapeType = isShape ? String(layer.shapeType ?? "rect") : "rect";
	const radius = num(layer.borderRadius, num(layer.cornerRadius, 0));
	const box: Shape2D = { kind: "box", hx: w / 2, hy: h / 2, radius };
	if (mode === "box") return box;
	if (mode === "circle" || (mode === "auto" && shapeType === "circle")) {
		return { kind: "ball", radius: Math.min(w, h) / 2 };
	}
	if (mode === "auto" && shapeType === "rect") return box;
	if (mode === "hull" || mode === "auto") {
		const points = outlinePoints(layer, shapeType, w, h);
		return points.length >= 6 ? { kind: "hull", points } : box;
	}
	return box;
}

/** The shape's outline as flat points around the box center, px. */
function outlinePoints(
	layer: LayerLike,
	shapeType: string,
	w: number,
	h: number,
): number[] {
	const d =
		shapeType === "path"
			? String(layer.d ?? "")
			: buildShapeSvgPath({
					shapeType: shapeType as ShapeGeometryConfig["shapeType"],
					width: w,
					height: h,
					cornerRadius: num(layer.cornerRadius, num(layer.borderRadius, 0)),
					polygonSides: layer.polygonSides as number | undefined,
					starPoints: layer.starPoints as number | undefined,
					starInnerRadiusRatio: layer.starInnerRadiusRatio as
						| number
						| undefined,
					arrowHeadWidth: layer.arrowHeadWidth as number | undefined,
					arrowHeadLength: layer.arrowHeadLength as number | undefined,
					arrowShaftWidth: layer.arrowShaftWidth as number | undefined,
				});
	const out: number[] = [];
	for (const seg of parseSvgPathToSegments(d)) {
		out.push(
			seg.p0.x - w / 2,
			seg.p0.y - h / 2,
			seg.p1.x - w / 2,
			seg.p1.y - h / 2,
		);
	}
	return out;
}

function scaleShape(shape: Shape2D, s: number): Shape2D {
	switch (shape.kind) {
		case "ball":
			return { kind: "ball", radius: shape.radius * s };
		case "box":
			return {
				kind: "box",
				hx: shape.hx * s,
				hy: shape.hy * s,
				radius: (shape.radius ?? 0) * s,
			};
		case "hull":
			return { kind: "hull", points: shape.points.map((v) => v * s) };
	}
}

interface PivotFrame {
	width: number;
	height: number;
	scale: number;
	anchorX: number;
	anchorY: number;
}

/**
 * Layers rotate and scale around their pivot (`anchorX/Y` of the unscaled
 * box); bodies rotate around their center. These convert between the two.
 */
function pivotOffset(rotationDeg: number, f: PivotFrame): Vec2 {
	const a = (rotationDeg * Math.PI) / 180;
	const dx = (0.5 - f.anchorX) * f.width * f.scale;
	const dy = (0.5 - f.anchorY) * f.height * f.scale;
	return [
		dx * Math.cos(a) - dy * Math.sin(a),
		dx * Math.sin(a) + dy * Math.cos(a),
	];
}

function layerToCenter(
	x: number,
	y: number,
	rotationDeg: number,
	f: PivotFrame,
): Vec2 {
	const [ox, oy] = pivotOffset(rotationDeg, f);
	return [x + f.anchorX * f.width + ox, y + f.anchorY * f.height + oy];
}

function centerToLayer(
	cx: number,
	cy: number,
	rotationDeg: number,
	f: PivotFrame,
): Vec2 {
	const [ox, oy] = pivotOffset(rotationDeg, f);
	return [cx - ox - f.anchorX * f.width, cy - oy - f.anchorY * f.height];
}
