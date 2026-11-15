/**
 * Steel (skild-ai's rigid-body and articulation solver, Newton's SolverSteel
 * on WebGPU) as a framefields world. The scene is built with its
 * `SceneBuilder` (in code, or from MJCF / URDF / USDA with its loaders), the
 * solver steps on the device the composition renders with, and each body's
 * pose comes back every frame. `layers()` draws the collision shapes and
 * visual meshes, following those poses; `control` drives joints and bodies
 * before each frame; `live(comp)` steps as frames render.
 *
 * Steel's frame is MuJoCo's and Newton's: meters, z up. A point (x, y, z)
 * lands at `origin + pixelsPerMeter * (x, -z, y)` in the scene.
 */
import { readFile } from "node:fs/promises";
import {
	type AnimatableProp,
	LayerAnimation,
} from "@framefields/compositions/program";
import type {
	LoadedScene,
	MeshData,
	SceneBuilder,
	Sim,
	SimOptions,
	SimState,
} from "@framefields/steel";
import {
	ensureDevice,
	finalizeModel3DData,
	type Material3D,
	type Mesh3DData,
} from "@framefields/webgpu-renderers";
import { Layer, type LayoutNode } from "../index.js";
import { type CompositionInput, type InputPick, rayPlane } from "../input.js";
import { Layer3D, type Primitive3DNodeOptions } from "../shapes3d.js";
import type { Quat, Vec3 } from "./backend.js";
import { type LiveHost, Recording } from "./core.js";
import { type MjcfCamera, mjcfCameras } from "./mjcf.js";
import { eulerFromQuat } from "./world3d.js";
import { ensureXmlParser } from "./xml.js";

/** What `control` sees, and may change, before a frame is stepped. */
export interface SteelFrameState {
	/** The frame stepped from (relative to the world's start). */
	readonly frame: number;
	/** Simulated seconds at `frame`. */
	readonly time: number;
	/** The state at `frame`: body poses and twists, joint coordinates. */
	readonly state: SimState;
	/** Drives a joint's (first) axis toward `position` (and `velocity`). */
	setJointTarget(joint: string, position: number, velocity?: number): void;
	/** Places a body: its center of mass at `position` (m), turned by `quaternion` (x, y, z, w). */
	setBodyPose(body: string, position: Vec3, quaternion: Quat): void;
	/** Sets a body's twist: linear (m/s) then angular (rad/s) velocity. */
	setBodyTwist(body: string, twist: ArrayLike<number>): void;
	/** Pushes a body for this frame: a force (N) and a torque (N·m). */
	setBodyWrench(body: string, force: Vec3, torque: Vec3): void;
}

export interface SteelWorldOptions {
	/** Frames per second; one frame is one `Sim.step`. */
	fps: number;
	/** How many frames to simulate. */
	frames: number;
	/** Composition frame the run starts at. Default 0. */
	startFrame?: number;
	/** Scene px per meter. Default 100. */
	pixelsPerMeter?: number;
	/** Scene position of Steel's origin. Default [0, 0, 0]. */
	origin?: Vec3;
	/** Gravity in m/s², z up. Default [0, 0, -9.81]. */
	gravity?: Vec3;
	/**
	 * Adds the bodies, shapes and joints: `scene.addBody`, `addShapeBox`,
	 * `addJointRevolute`, … or a robot file with `load.mjcf(scene, text)`,
	 * `load.urdf` or `load.usda`.
	 */
	build(scene: SceneBuilder, load: SteelLoaders): void | Promise<void>;
	/** Solver settings: substeps, iterations, regularization, … */
	solver?: SimOptions;
	/** Called before each frame is stepped: set joint targets, push bodies. */
	control?(frame: number, state: SteelFrameState): void;
	/** The GPU device to solve on. Default the one the composition renders with. */
	device?: GPUDevice;
}

/** Steel's robot loaders, as `build` gets them. */
export interface SteelLoaders {
	/**
	 * An MJCF model (bodies, joints, geoms, position actuators); its fixed
	 * `<camera>`s become the world's `cameraNames`. Meshes resolve against
	 * `baseUrl`, which may be a `file:` folder.
	 */
	mjcf: typeof import("@framefields/steel").loadMJCF;
	/** A URDF robot (meshes as for `mjcf`). */
	urdf: typeof import("@framefields/steel").loadURDF;
	/** A USDA stage. */
	usda: typeof import("@framefields/steel").loadUSDA;
}

/** A joint of the scene, as Newton types it. */
export interface SteelJoint {
	name: string;
	type: SteelJointType;
	/** Where its coordinates start in `SimState.jointQ`. */
	q: number;
	/** Where its velocities (and dofs) start in `SimState.jointQd` and `target`. */
	qd: number;
	/** Its degrees of freedom. */
	dofs: number;
	/** A one-dof joint whose drive has a position gain (an actuated joint). */
	driven: boolean;
}

export type SteelJointType =
	| "prismatic"
	| "revolute"
	| "ball"
	| "fixed"
	| "free"
	| "distance"
	| "d6";

/** A camera fixed to a body (or the world), as an MJCF `<camera>` places one. */
export interface SteelCamera {
	/** The body it rides; `null` (or absent) for the world. */
	body?: string | null;
	/** In the body's frame, m. Default [0, 0, 0]. */
	position?: Vec3;
	/** In the body's frame, x, y, z, w: the camera looks along its -z, +y up. Default none. */
	quaternion?: Quat;
	/** Vertical field of view, degrees. Default 45. */
	fovy?: number;
}

/** What `camera()` takes. */
export interface SteelCameraOptions {
	/** Layer id. Default `steel-camera:<name>`. */
	id?: string;
}

/** A shape as `layers()` describes it to `style`. */
export interface SteelShape {
	/** Its index in the scene's shapes. */
	index: number;
	/** The body it is on; `null` for the world (ground planes, static shapes). */
	body: string | null;
	type: SteelShapeType;
	/** Its color in the scene, `#rrggbb`. */
	color: string;
	/** A visual mesh (drawn only) rather than a collision shape. */
	visual: boolean;
}

export type SteelShapeType =
	| "plane"
	| "sphere"
	| "capsule"
	| "cylinder"
	| "box"
	| "hull"
	| "mesh";

/** What `style` may set on a shape's layer. */
export type SteelShapeStyle = Omit<
	Primitive3DNodeOptions,
	"id" | "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ"
>;

/** How `draggable` grabs. */
export interface SteelDragOptions {
	/** The pointer button that grabs. Default 0 (primary). */
	button?: number;
	/** Which bodies may be grabbed (default: every body Steel lets the spring pull: free bodies and links of undriven articulations). */
	bodies?(name: string): boolean;
	/**
	 * The plane the grab point moves in: `camera` (facing the camera, through
	 * the grab point) or `horizontal` (level, at its height). Default `camera`.
	 */
	plane?: "camera" | "horizontal";
	/** Called when a body is grabbed and when it is let go (`null`). */
	onGrab?(body: string | null): void;
}

/** A pointer-drag binding, from `draggable`. */
export interface SteelDrag {
	/** The body held now, if any. */
	readonly grabbed: string | null;
	/** Stops listening (and lets go). */
	dispose(): void;
}

export interface SteelLayersOptions {
	/** Layer ids are `<idPrefix>shape:<index>` / `<idPrefix>visual:<index>`. Default `steel:`. */
	idPrefix?: string;
	/** A plane's drawn width, m (Steel's planes are infinite). Default 10. */
	planeSize?: number;
	/** Material and more per shape, or `false` to leave it out. */
	style?(shape: SteelShape): SteelShapeStyle | false | undefined;
}

// ---------------------------------------------------------------------------
// The slice of the finalized scene this module reads.
// ---------------------------------------------------------------------------

interface Range {
	off: number;
	n: number;
}

interface BuiltShape {
	body: number;
	xf: number[];
	type: number;
	color: number[];
	plane?: boolean;
	prim?: { kind: number; r: number; h: number };
	hull?: { verts: Range; face_start: Range; face_verts: Range };
}

interface BuiltVisual {
	body: number;
	xf: number[];
	color: number[];
	mesh: { v: Range; i: Range };
}

interface BuiltScene {
	bodies: { count: number; label: string[]; com: number[][] };
	joints: {
		count: number;
		label: string[];
		type: number[];
		q_start: number[];
		qd_start: number[];
		/** Per dof: the drive's position gain, and its target at the start. */
		ke: number[];
		target_q: number[];
	};
	shapes: BuiltShape[];
	visuals: BuiltVisual[];
	/** Newton's `JointType` names by value. */
	joint_type_names: Record<string, number>;
}

/** Steel's geometry types (Newton's `GeoType`). */
const GEO: Record<number, SteelShapeType> = {
	1: "plane",
	3: "sphere",
	4: "capsule",
	6: "cylinder",
	7: "box",
};

const POSE_CHANNELS = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"] as const;
/** Animated props of a camera on a body. */
const CAMERA_CHANNELS = [
	"cameraX",
	"cameraY",
	"cameraZ",
	"targetX",
	"targetY",
	"targetZ",
	"cameraRoll",
] as const;
/** How far ahead of a camera its look-at target sits, px. */
const CAMERA_REACH = 1000;
/** Frames between checks that the solver's buffers held. */
const CHECK_EVERY = 30;
/** Thickness of a drawn plane, px. */
const PLANE_SLAB = 2;

const hex = (c: ArrayLike<number>) =>
	`#${[0, 1, 2]
		.map((k) =>
			Math.round(Math.max(0, Math.min(1, c[k])) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

const qmul = (a: ArrayLike<number>, b: ArrayLike<number>): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** `v` turned by unit quaternion `q`. */
function rotate(q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
	const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
	const t = [
		2 * (y * v[2] - z * v[1]),
		2 * (z * v[0] - x * v[2]),
		2 * (x * v[1] - y * v[0]),
	];
	return [
		v[0] + w * t[0] + (y * t[2] - z * t[1]),
		v[1] + w * t[1] + (z * t[0] - x * t[2]),
		v[2] + w * t[2] + (x * t[1] - y * t[0]),
	];
}

/** A quaternion in the scene's axes: the turn (x, y, z) → (x, -z, y) applied to its axis. */
const toSceneQuat = (q: ArrayLike<number>): Quat => [q[0], -q[2], q[1], q[3]];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
	const l = Math.hypot(...v) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};
/** A Steel direction (z up) in scene axes (y down), unit length. */
const sceneDirection = (v: Vec3): Vec3 => normalize([v[0], -v[2], v[1]]);
/** `next` in degrees, moved by whole turns to sit nearest `previous`. */
const unwrap = (previous: number, next: number) =>
	next + 360 * Math.round((previous - next) / 360);

let steelModule: Promise<typeof import("@framefields/steel")> | undefined;

/** Loads Steel (bundled, in its own chunk) once, on first use. */
function loadSteel(): Promise<typeof import("@framefields/steel")> {
	steelModule ??= import("@framefields/steel");
	return steelModule;
}

/**
 * Steel's mesh loader, reading `file:` URLs too (Node's `fetch` cannot), so
 * a robot's `baseUrl` may be a folder on disk: STL, or OBJ by extension.
 */
function meshLoader(
	steel: typeof import("@framefields/steel"),
): (url: string) => Promise<MeshData> {
	return async (url) => {
		if (!url.startsWith("file:")) return steel.fetchMesh(url);
		const bytes = await readFile(new URL(url));
		return new URL(url).pathname.toLowerCase().endsWith(".obj")
			? steel.parseOBJ(new TextDecoder().decode(bytes))
			: steel.parseSTL(bytes);
	};
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

/** One drawable thing on a body: a shape or a visual mesh. */
interface Part {
	body: number;
	xf: number[];
	/** How far its layer sits below its frame along local z, m (a plane's slab). */
	sink: number;
	rec: Recording;
}

/** A camera on a body (-1: the world), its pose recorded per frame. */
interface CameraPart {
	name: string;
	body: number;
	position: Vec3;
	quaternion: Quat;
	fovy: number;
	rec: Recording;
}

/** Newton's joint type value → its name here. */
function jointTypes(
	names: Record<string, number>,
): Map<number, SteelJointType> {
	const known = new Set<string>([
		"prismatic",
		"revolute",
		"ball",
		"fixed",
		"free",
		"distance",
		"d6",
	]);
	const types = new Map<number, SteelJointType>();
	for (const [name, value] of Object.entries(names)) {
		const lower = name.toLowerCase();
		if (known.has(lower)) types.set(value, lower as SteelJointType);
	}
	return types;
}

export class SteelWorld {
	readonly fps: number;
	readonly frames: number;
	readonly startFrame: number;
	readonly pixelsPerMeter: number;
	/** Body labels, in Steel's body order. */
	readonly bodyNames: string[];
	/** Joint labels, in Steel's joint order. */
	readonly jointNames: string[];
	/** Every joint: its type, where its coordinates sit, whether a drive moves it. */
	readonly joints: SteelJoint[];
	/** The fixed `<camera>`s of the MJCF files `build` loaded. */
	readonly cameraNames: string[];
	private readonly origin: Vec3;
	private readonly cameras: CameraPart[] = [];
	/** Each dof's drive target now (what `setJointTarget` last set). */
	private readonly target: Float32Array;
	/** The targets that stepped each frame to the next. */
	private readonly targets: Float32Array[] = [];
	private readonly built: BuiltScene;
	private readonly bodyIndex: Map<string, number>;
	private readonly jointIndex: Map<string, number>;
	private readonly shapeParts: Part[];
	private readonly visualParts: Part[];
	private readonly states: SimState[] = [];
	private sim: Sim | null;
	private liveMode = false;
	/** Commands for the solver, run before the next step. */
	private commands: Array<(sim: Sim) => void> = [];
	/** Each drawn layer's body (-1: the world). */
	private readonly layerBodies = new Map<string, number>();
	private held: string | null = null;
	/** The step running now, so live frames step one after another. */
	private stepping: Promise<void> = Promise.resolve();

	private constructor(
		private readonly options: SteelWorldOptions,
		private readonly scene: LoadedScene,
		sim: Sim,
		start: SimState,
		cameras: MjcfCamera[],
	) {
		this.fps = options.fps;
		this.frames = Math.max(1, Math.round(options.frames));
		this.startFrame = options.startFrame ?? 0;
		this.pixelsPerMeter = options.pixelsPerMeter ?? 100;
		this.origin = options.origin ?? [0, 0, 0];
		this.sim = sim;
		this.built = scene.json as unknown as BuiltScene;
		this.bodyNames = [...this.built.bodies.label];
		this.jointNames = [...this.built.joints.label];
		this.bodyIndex = new Map(this.bodyNames.map((n, i) => [n, i]));
		this.jointIndex = new Map(this.jointNames.map((n, i) => [n, i]));
		const { type, q_start, qd_start, ke, target_q } = this.built.joints;
		const types = jointTypes(this.built.joint_type_names);
		this.joints = this.jointNames.map((name, j) => {
			const dofs = qd_start[j + 1] - qd_start[j];
			return {
				name,
				type: types.get(type[j]) ?? "d6",
				q: q_start[j],
				qd: qd_start[j],
				dofs,
				driven: dofs === 1 && (ke[qd_start[j]] ?? 0) > 0,
			};
		});
		this.target = new Float32Array(qd_start[this.jointNames.length] ?? 0);
		this.target.set(target_q.slice(0, this.target.length));
		const length = this.startFrame + this.frames;
		this.cameraNames = cameras.map((c) => c.name);
		for (const c of cameras) this.addCamera(c.name, c, length);
		const part = (p: {
			body: number;
			xf: number[];
			plane?: boolean;
		}): Part => ({
			body: p.body,
			xf: p.xf,
			sink: p.plane ? PLANE_SLAB / 2 / this.pixelsPerMeter : 0,
			rec: new Recording(length, this.fps, () => this.ensure()),
		});
		this.shapeParts = this.built.shapes.map(part);
		this.visualParts = this.built.visuals.map(part);
		this.record(start, 0);
	}

	/** Builds the scene and readies the solver on the GPU; frame 0 is the start state. */
	static async create(options: SteelWorldOptions): Promise<SteelWorld> {
		const steel = await loadSteel();
		ensureXmlParser();
		const builder = new steel.SceneBuilder({
			gravity: options.gravity ?? [0, 0, -9.81],
			fps: options.fps,
		});
		const cameras: MjcfCamera[] = [];
		const loadMesh = meshLoader(steel);
		await options.build(builder, {
			mjcf: (b, text, robot) => {
				cameras.push(...mjcfCameras(text));
				return steel.loadMJCF(b, text, { loadMesh, ...robot });
			},
			urdf: (b, text, robot) => steel.loadURDF(b, text, { loadMesh, ...robot }),
			usda: steel.loadUSDA,
		});
		const scene = builder.finalize();
		const device = options.device ?? (await ensureDevice());
		const sim = await steel.Sim.create(device, scene, options.solver);
		try {
			return new SteelWorld(options, scene, sim, await sim.state(), cameras);
		} catch (error) {
			sim.destroy();
			throw error;
		}
	}

	/** Runs the whole simulation (once), then frees the solver. */
	async simulate(): Promise<this> {
		if (this.liveMode)
			throw new Error(
				"Physics.steel: this world is live; it steps as frames render.",
			);
		await this.stepTo(this.frames - 1);
		return this;
	}

	/**
	 * Steps the world as the composition renders instead of all at once:
	 * before each frame draws, the world advances to it, calling `control`
	 * for every frame it steps. Frames already stepped are kept.
	 */
	live(comp: LiveHost): this {
		if (this.states.length > 1)
			throw new Error("Physics.steel: live() must come before simulate().");
		this.liveMode = true;
		comp.onPrepareFrame((ctx) => this.stepTo(ctx.frame - this.startFrame));
		return this;
	}

	/** The last frame stepped (relative to the start). */
	get steppedFrame(): number {
		return this.states.length - 1;
	}

	// -------------------------------------------------------------------------
	// Commands at any time (games, event handlers): applied before the next step.
	// -------------------------------------------------------------------------

	/** Drives a joint's (first) axis toward `position` from the next step on. */
	setJointTarget(joint: string, position: number, velocity?: number): void {
		const j = this.jointOf(joint);
		this.command((sim) => this.drive(sim, j, position, velocity));
	}

	private drive(
		sim: Sim,
		joint: number,
		position: number,
		velocity?: number,
	): void {
		const dof = this.built.joints.qd_start[joint];
		sim.setJointTarget(dof, position, velocity);
		this.target[dof] = position;
	}

	/** Places a body at the next step: its center of mass at `position` (m), turned by `quaternion`. */
	setBodyPose(body: string, position: Vec3, quaternion: Quat): void {
		const b = this.bodyOf(body);
		this.command((sim) => sim.setBodyPose(b, position, quaternion));
	}

	/** Sets a body's twist at the next step: linear (m/s) then angular (rad/s). */
	setBodyTwist(body: string, twist: ArrayLike<number>): void {
		const b = this.bodyOf(body);
		const t = Array.from(twist);
		this.command((sim) => sim.setBodyTwist(b, t));
	}

	/** Pushes a body during the next step: a force (N) and a torque (N·m). */
	setBodyWrench(body: string, force: Vec3, torque: Vec3 = [0, 0, 0]): void {
		const b = this.bodyOf(body);
		this.command((sim) => sim.setBodyWrench(b, force, torque));
	}

	private command(fn: (sim: Sim) => void): void {
		if (!this.sim)
			throw new Error(
				"Physics.steel: the run is over (or the world was disposed).",
			);
		this.commands.push(fn);
	}

	// -------------------------------------------------------------------------
	// Grabbing: Steel's mouse spring pulls a point of a body toward a target.
	// -------------------------------------------------------------------------

	/** Whether Steel lets the spring pull `body` (free bodies, links of undriven articulations). */
	canGrab(body: string): boolean {
		return this.sim?.draggable[this.bodyOf(body)] ?? false;
	}

	/** Takes hold of `body` at `point` (m, on or in it, as of the last frame stepped). */
	grab(body: string, point: Vec3): void {
		const sim = this.sim;
		if (!sim) throw new Error("Physics.steel: the run is over.");
		const b = this.bodyOf(body);
		const q = this.state(this.steppedFrame).bodyQ.subarray(b * 7, b * 7 + 7);
		const com = this.built.bodies.com[b] ?? [0, 0, 0];
		// The point in the body's frame, from its center of mass.
		const inverse: Quat = [-q[3], -q[4], -q[5], q[6]];
		const r = rotate(inverse, [
			point[0] - q[0],
			point[1] - q[1],
			point[2] - q[2],
		]);
		sim.pick = {
			body: b,
			local: [r[0] - com[0], r[1] - com[1], r[2] - com[2]],
			target: [...point],
		};
		this.held = body;
	}

	/** Moves the held point's target (m). */
	moveGrab(target: Vec3): void {
		if (this.sim?.pick) this.sim.pick.target = [...target];
	}

	/** Lets go. */
	release(): void {
		if (this.sim) this.sim.pick = null;
		this.held = null;
	}

	/** The body held now, if any. */
	get grabbed(): string | null {
		return this.held;
	}

	/** The body a layer from `layers()` draws (`null` for the world's shapes or another layer). */
	bodyOfLayer(layer: string | undefined): string | null {
		const b = layer === undefined ? undefined : this.layerBodies.get(layer);
		return b === undefined || b < 0 ? null : this.bodyNames[b];
	}

	/** A scene point (px, y down) in Steel's frame (m, z up). */
	toSteel(point: Vec3): Vec3 {
		const ppm = this.pixelsPerMeter;
		const [ox, oy, oz] = this.origin;
		return [
			(point[0] - ox) / ppm,
			(point[2] - oz) / ppm,
			-(point[1] - oy) / ppm,
		];
	}

	/** A Steel point (m, z up) in the scene (px, y down). */
	toScene(point: Vec3): Vec3 {
		const ppm = this.pixelsPerMeter;
		const [ox, oy, oz] = this.origin;
		return [ox + point[0] * ppm, oy - point[2] * ppm, oz + point[1] * ppm];
	}

	/**
	 * Lets the pointer pick bodies up: press on one (the layer under the
	 * pointer, from `input.pick`) and it hangs from the pointer on Steel's
	 * spring, moving in a plane through the grab point, until release. Needs
	 * a live world and the layers from `layers()`.
	 */
	draggable(
		input: CompositionInput,
		options: SteelDragOptions = {},
	): SteelDrag {
		const button = options.button ?? 0;
		let pressing = false;
		let drag: { pick: InputPick; point: Vec3; normal: Vec3 } | undefined;
		const letGo = () => {
			if (!drag && !this.held) return;
			drag = undefined;
			this.release();
			options.onGrab?.(null);
		};
		const stops = [
			input.on("pointerdown", async (e) => {
				if (e.button !== button || !this.sim) return;
				pressing = true;
				const pick = await e.pick();
				const body = this.bodyOfLayer(pick.hit?.layer);
				// Released while the pick was measured, or nothing to hold there.
				if (!pressing || !pick.hit || !body || !this.sim) return;
				if (!(options.bodies?.(body) ?? this.canGrab(body))) return;
				const ray = pick.ray(e.x, e.y);
				const normal: Vec3 =
					options.plane === "horizontal" || !ray
						? [0, 1, 0]
						: [-ray.direction[0], -ray.direction[1], -ray.direction[2]];
				drag = { pick, point: pick.hit.point, normal };
				this.grab(body, this.toSteel(pick.hit.point));
				options.onGrab?.(body);
			}),
			input.on("pointermove", (e) => {
				if (!drag) return;
				const ray = drag.pick.ray(e.x, e.y);
				const at = ray && rayPlane(ray, drag.point, drag.normal);
				if (at) this.moveGrab(this.toSteel(at));
			}),
			input.on("pointerup", (e) => {
				if (e.button !== button) return;
				pressing = false;
				letGo();
			}),
		];
		const world = this;
		return {
			get grabbed() {
				return world.held;
			},
			dispose() {
				for (const stop of stops) stop();
				letGo();
			},
		};
	}

	/** Frees the solver's GPU buffers; frames already stepped stay readable. */
	dispose(): void {
		this.sim?.destroy();
		this.sim = null;
		this.held = null;
		this.commands = [];
	}

	/** The state at `frame` (clamped to the frames stepped). */
	state(frame: number): SimState {
		return this.states[this.readable(frame)];
	}

	/** A body's origin at `frame`: position (m) and quaternion (x, y, z, w). */
	body(name: string, frame: number): { position: Vec3; quaternion: Quat } {
		const b = this.bodyOf(name);
		const q = this.state(frame).bodyQ.subarray(b * 7, b * 7 + 7);
		return {
			position: [q[0], q[1], q[2]],
			quaternion: [q[3], q[4], q[5], q[6]],
		};
	}

	/** A joint's coordinates at `frame` (one per axis; a free joint's pose). */
	joint(name: string, frame: number): number[] {
		const j = this.jointOf(name);
		const { q_start } = this.built.joints;
		return Array.from(
			this.state(frame).jointQ.subarray(q_start[j], q_start[j + 1]),
		);
	}

	/**
	 * Every dof's drive target that steps `frame` to the next: what
	 * robot-learning datasets call the action at `frame` (the last frame
	 * repeats the one before it). Indexed as `SimState.jointQd`.
	 */
	action(frame: number): Float32Array {
		const f = Math.max(0, Math.min(this.targets.length - 1, Math.round(frame)));
		return this.targets[f] ?? this.target;
	}

	/**
	 * A scene camera at one of the MJCF's `<camera>`s (a wrist camera, a
	 * fixed overhead one), or at `spec` on a body: it follows its pose every
	 * frame, with its vertical field of view. Add it to the composition
	 * that should see through it.
	 */
	camera(
		camera: string | ({ name: string } & SteelCamera),
		options: SteelCameraOptions = {},
	): LayoutNode {
		const name = typeof camera === "string" ? camera : camera.name;
		let part = this.cameras.find((c) => c.name === name);
		if (typeof camera !== "string") {
			if (part)
				throw new Error(`Physics.steel: there is a camera "${name}" already.`);
			part = this.addCamera(name, camera, this.startFrame + this.frames);
			const added = part;
			for (const [f, s] of this.states.entries())
				this.recordCamera(added, s, f);
		}
		if (!part)
			throw new Error(
				`Physics.steel: no camera "${name}" (cameras: ${this.cameras.map((c) => c.name).join(", ") || "none"}).`,
			);
		const rec = part.rec;
		const first = (c: string) => rec.channel(c)[this.startFrame];
		const node = Layer.camera({
			id: options.id ?? `steel-camera:${name}`,
			x: first("cameraX"),
			y: first("cameraY"),
			z: first("cameraZ"),
			targetX: first("targetX"),
			targetY: first("targetY"),
			targetZ: first("targetZ"),
			roll: first("cameraRoll"),
			fov: part.fovy,
		});
		const anim = LayerAnimation.create();
		for (const c of CAMERA_CHANNELS)
			anim.signal(c as AnimatableProp, rec.signal(c));
		(node as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
		return node as unknown as LayoutNode;
	}

	private addCamera(
		name: string,
		spec: SteelCamera,
		length: number,
	): CameraPart {
		const part: CameraPart = {
			name,
			body: spec.body ? this.bodyOf(spec.body) : -1,
			position: spec.position ?? [0, 0, 0],
			quaternion: spec.quaternion ?? [0, 0, 0, 1],
			fovy: spec.fovy ?? 45,
			rec: new Recording(length, this.fps, () => this.ensure()),
		};
		this.cameras.push(part);
		return part;
	}

	/**
	 * A camera's eye, a target along its view axis and the roll that turns
	 * the scene camera's up to the camera's (it looks along its -z, +y up).
	 */
	private recordCamera(part: CameraPart, state: SimState, frame: number): void {
		let p: Vec3 = part.position;
		let q: Quat = part.quaternion;
		if (part.body >= 0) {
			const b = state.bodyQ.subarray(part.body * 7, part.body * 7 + 7);
			const bq = b.subarray(3, 7);
			const r = rotate(bq, p);
			p = [b[0] + r[0], b[1] + r[1], b[2] + r[2]];
			q = qmul(bq, q);
		}
		const up = sceneDirection(rotate(q, [0, 1, 0]));
		let fwd = sceneDirection(rotate(q, [0, 0, -1]));
		// Looking straight up or down leaves look-at without a right: tilt a hair toward the camera's up.
		if (Math.abs(fwd[1]) > 0.99999)
			fwd = normalize([
				fwd[0] + up[0] * 1e-3,
				fwd[1] + up[1] * 1e-3,
				fwd[2] + up[2] * 1e-3,
			]);
		const eye = this.toScene(p);
		const right0 = normalize(cross(fwd, [0, -1, 0]));
		const up0 = cross(right0, fwd);
		const at = this.startFrame + frame;
		let roll = (Math.atan2(dot(up, right0), dot(up, up0)) * 180) / Math.PI;
		if (frame > 0) roll = unwrap(part.rec.channel("cameraRoll")[at - 1], roll);
		const values: Record<(typeof CAMERA_CHANNELS)[number], number> = {
			cameraX: eye[0],
			cameraY: eye[1],
			cameraZ: eye[2],
			targetX: eye[0] + fwd[0] * CAMERA_REACH,
			targetY: eye[1] + fwd[1] * CAMERA_REACH,
			targetZ: eye[2] + fwd[2] * CAMERA_REACH,
			cameraRoll: roll,
		};
		for (const c of CAMERA_CHANNELS) {
			const arr = part.rec.channel(c);
			if (frame === 0) arr.fill(values[c]);
			else arr[at] = values[c];
		}
	}

	/**
	 * Every shape and visual mesh as a layer that follows its body: spheres,
	 * capsules, cylinders and boxes as primitives, planes as thin slabs (their
	 * top at the plane), other hulls and meshes as flat-shaded triangles.
	 */
	layers(options: SteelLayersOptions = {}): LayoutNode[] {
		const prefix = options.idPrefix ?? "steel:";
		const layers: LayoutNode[] = [];
		this.built.shapes.forEach((s, i) => {
			const shape: SteelShape = {
				index: i,
				body: s.body >= 0 ? this.bodyNames[s.body] : null,
				type: GEO[s.type] ?? "hull",
				color: hex(s.color),
				visual: false,
			};
			const style = options.style?.(shape);
			if (style === false) return;
			const part = this.shapeParts[i];
			const node = this.shapeLayer(s, shape, options.planeSize ?? 10, {
				id: `${prefix}shape:${i}`,
				label: shape.body ?? "world",
				color: shape.color,
				...style,
				...this.stillPose(part),
			});
			if (!node) return;
			this.layerBodies.set(`${prefix}shape:${i}`, s.body);
			layers.push(this.follow(node, part));
		});
		this.built.visuals.forEach((v, i) => {
			const shape: SteelShape = {
				index: i,
				body: v.body >= 0 ? this.bodyNames[v.body] : null,
				type: "mesh",
				color: hex(v.color),
				visual: true,
			};
			const style = options.style?.(shape);
			if (style === false) return;
			const id = `${prefix}visual:${i}`;
			// A built scene keeps its meshes in `bin` (no `mesh()`, which loaded scene folders have).
			const pos = this.scene.f32(v.mesh.v);
			const idx = this.scene.u32(v.mesh.i);
			const part = this.visualParts[i];
			const node = this.meshLayer(id, pos, idx, {
				id,
				label: shape.body ?? "world",
				color: shape.color,
				...style,
				...this.stillPose(part),
			});
			this.layerBodies.set(id, v.body);
			layers.push(this.follow(node, part));
		});
		return layers;
	}

	// -------------------------------------------------------------------------

	private bodyOf(name: string): number {
		const b = this.bodyIndex.get(name);
		if (b === undefined)
			throw new Error(
				`Physics.steel: no body "${name}" (bodies: ${this.bodyNames.join(", ")})`,
			);
		return b;
	}

	private jointOf(name: string): number {
		const j = this.jointIndex.get(name);
		if (j === undefined)
			throw new Error(
				`Physics.steel: no joint "${name}" (joints: ${this.jointNames.join(", ")})`,
			);
		return j;
	}

	private readable(frame: number): number {
		return Math.max(0, Math.min(this.states.length - 1, Math.round(frame)));
	}

	/** Signals read an offline world only once it has run. */
	private ensure(): void {
		if (this.liveMode || this.states.length === this.frames) return;
		throw new Error(
			"Physics.steel: `await world.simulate()` before rendering (or make it live).",
		);
	}

	/** Steps up to `target`, one live request after another. */
	private stepTo(target: number): Promise<void> {
		const run = this.stepping.then(() => this.advance(target));
		this.stepping = run.catch(() => {});
		return run;
	}

	private async advance(target: number): Promise<void> {
		const last = Math.min(this.frames - 1, Math.round(target));
		while (this.states.length - 1 < last) {
			const sim = this.sim;
			if (!sim) throw new Error("Physics.steel: the world was disposed.");
			const frame = this.states.length - 1;
			for (const command of this.commands.splice(0)) command(sim);
			this.options.control?.(frame, this.frameState(sim, frame));
			this.targets[frame] = this.target.slice();
			sim.step(1);
			this.record(await sim.state(), frame + 1);
			if (frame % CHECK_EVERY === 0 || frame + 2 === this.frames)
				await this.checkCapacity(sim);
		}
		if (this.states.length === this.frames) this.dispose();
	}

	/**
	 * Fails when a solver buffer filled up: Steel then drops contacts and
	 * bodies fall through each other. Its flag stays set once raised.
	 */
	private async checkCapacity(sim: Sim): Promise<void> {
		const { overflow } = await sim.stats();
		if (!overflow.length) return;
		this.dispose();
		throw new Error(
			`Physics.steel: the solver ran out of room (${overflow.join(", ")}), so contacts were dropped. ` +
				"Each shape's `gap` (default 0.1 m) gathers contacts that far out: give small or crowded shapes a smaller one, such as 0.01.",
		);
	}

	private frameState(sim: Sim, frame: number): SteelFrameState {
		return {
			frame,
			time: frame / this.fps,
			state: this.states[frame],
			setJointTarget: (joint, position, velocity) =>
				this.drive(sim, this.jointOf(joint), position, velocity),
			setBodyPose: (body, position, quaternion) =>
				sim.setBodyPose(this.bodyOf(body), position, quaternion),
			setBodyTwist: (body, twist) => sim.setBodyTwist(this.bodyOf(body), twist),
			setBodyWrench: (body, force, torque) =>
				sim.setBodyWrench(this.bodyOf(body), force, torque),
		};
	}

	/** Keeps the frame's state and poses every part's layer channels. */
	private record(state: SimState, frame: number): void {
		this.states[frame] = {
			bodyQ: state.bodyQ.slice(),
			bodyQd: state.bodyQd.slice(),
			jointQ: state.jointQ.slice(),
			jointQd: state.jointQd.slice(),
		};
		const at = this.startFrame + frame;
		for (const part of [...this.shapeParts, ...this.visualParts]) {
			const values = this.pose(part, state.bodyQ, part.rec, at, frame > 0);
			POSE_CHANNELS.forEach((c, k) => {
				const arr = part.rec.channel(c);
				arr[at] = values[k];
				// Before the run starts, the start pose (and, until they are
				// stepped, every later frame of a live run).
				if (frame === 0) arr.fill(values[k]);
			});
		}
		for (const camera of this.cameras) this.recordCamera(camera, state, frame);
	}

	/** A part's scene pose (px, Euler degrees) from its body's. */
	private pose(
		part: Part,
		bodyQ: Float32Array,
		rec: Recording,
		at: number,
		continuing: boolean,
	): number[] {
		const { xf } = part;
		const down = rotate(xf.slice(3, 7), [0, 0, -part.sink]);
		let p: Vec3 = [xf[0] + down[0], xf[1] + down[1], xf[2] + down[2]];
		let q: Quat = [xf[3], xf[4], xf[5], xf[6]];
		if (part.body >= 0) {
			const b = bodyQ.subarray(part.body * 7, part.body * 7 + 7);
			const bq = b.subarray(3, 7);
			const r = rotate(bq, p);
			p = [b[0] + r[0], b[1] + r[1], b[2] + r[2]];
			q = qmul(bq, q);
		}
		const previous: Vec3 | undefined = continuing
			? [
					rec.channel("rotateX")[at - 1],
					rec.channel("rotateY")[at - 1],
					rec.channel("rotateZ")[at - 1],
				]
			: undefined;
		const ppm = this.pixelsPerMeter;
		return [
			this.origin[0] + p[0] * ppm,
			this.origin[1] - p[2] * ppm,
			this.origin[2] + p[1] * ppm,
			...eulerFromQuat(toSceneQuat(q), previous),
		];
	}

	/** A world part's pose, once (they never move); none for a body's. */
	private stillPose(
		part: Part,
	): Partial<Record<(typeof POSE_CHANNELS)[number], number>> {
		if (part.body >= 0) return {};
		return Object.fromEntries(
			POSE_CHANNELS.map((c) => [c, part.rec.channel(c)[this.startFrame]]),
		);
	}

	/** Binds a body part's layer pose to its channels. */
	private follow(node: LayoutNode, part: Part): LayoutNode {
		if (part.body < 0) return node;
		const anim = LayerAnimation.create();
		for (const c of POSE_CHANNELS) anim.signal(c, part.rec.signal(c));
		(node as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
		return node;
	}

	/**
	 * A shape in its own frame: Steel's local z (capsule and cylinder axes, a
	 * plane's normal) is the scene's local -y, its local y the scene's z.
	 */
	private shapeLayer(
		s: BuiltShape,
		shape: SteelShape,
		planeSize: number,
		base: Primitive3DNodeOptions,
	): LayoutNode | null {
		const ppm = this.pixelsPerMeter;
		const half = this.hullHalfExtents(s);
		switch (shape.type) {
			case "plane":
				// The slab's top at the plane: it hangs half its thickness below.
				return Layer3D.roundedBox({
					...base,
					width: planeSize * ppm,
					height: PLANE_SLAB,
					depth: planeSize * ppm,
				}) as unknown as LayoutNode;
			case "sphere":
				return Layer3D.sphere({
					...base,
					radius: (s.prim?.r ?? half[0]) * ppm,
				}) as unknown as LayoutNode;
			case "capsule":
				return Layer3D.capsule({
					...base,
					radius: (s.prim?.r ?? half[0]) * ppm,
					length: 2 * (s.prim?.h ?? half[2]) * ppm,
				}) as unknown as LayoutNode;
			case "cylinder":
				return Layer3D.cylinder({
					...base,
					radius: half[0] * ppm,
					height: 2 * half[2] * ppm,
				}) as unknown as LayoutNode;
			case "box":
				return Layer3D.roundedBox({
					...base,
					width: 2 * half[0] * ppm,
					height: 2 * half[2] * ppm,
					depth: 2 * half[1] * ppm,
				}) as unknown as LayoutNode;
			default: {
				const tris = this.hullTriangles(s);
				if (!tris) return null;
				return this.meshLayer(
					String(base.id),
					tris.positions,
					tris.indices,
					base,
				);
			}
		}
	}

	/** Half extents of a shape's hull along its own axes (a box's, a cylinder's). */
	private hullHalfExtents(s: BuiltShape): Vec3 {
		if (!s.hull) return [0, 0, 0];
		const v = this.scene.f32(s.hull.verts);
		const half: Vec3 = [0, 0, 0];
		for (let i = 0; i < v.length; i++)
			half[i % 3] = Math.max(half[i % 3], Math.abs(v[i]));
		return half;
	}

	/** A hull's faces as triangle fans, in its own frame (m). */
	private hullTriangles(
		s: BuiltShape,
	): { positions: Float32Array; indices: Uint32Array } | null {
		if (!s.hull) return null;
		const positions = this.scene.f32(s.hull.verts);
		const start = this.scene.u32(s.hull.face_start);
		const verts = this.scene.u32(s.hull.face_verts);
		const indices: number[] = [];
		for (let f = 0; f + 1 < start.length; f++)
			for (let k = start[f] + 1; k + 1 < start[f + 1]; k++)
				indices.push(verts[start[f]], verts[k], verts[k + 1]);
		return { positions, indices: Uint32Array.from(indices) };
	}

	/**
	 * Triangles in a body's frame (m, z up) as a flat-shaded model layer:
	 * one vertex per corner, turned to scene axes and px.
	 */
	private meshLayer(
		name: string,
		vertices: ArrayLike<number>,
		indices: ArrayLike<number>,
		base: Primitive3DNodeOptions,
	): LayoutNode {
		const ppm = this.pixelsPerMeter;
		const count = indices.length;
		const positions = new Float32Array(count * 3);
		const normals = new Float32Array(count * 3);
		for (let t = 0; t < count; t += 3) {
			const corner = (k: number): Vec3 => {
				const v = indices[t + k] * 3;
				return [
					vertices[v] * ppm,
					-vertices[v + 2] * ppm,
					vertices[v + 1] * ppm,
				];
			};
			const [a, b, c] = [corner(0), corner(1), corner(2)];
			const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const n = [
				e1[1] * e2[2] - e1[2] * e2[1],
				e1[2] * e2[0] - e1[0] * e2[2],
				e1[0] * e2[1] - e1[1] * e2[0],
			];
			const l = Math.hypot(n[0], n[1], n[2]) || 1;
			[a, b, c].forEach((p, k) => {
				positions.set(p, (t + k) * 3);
				normals.set([n[0] / l, n[1] / l, n[2] / l], (t + k) * 3);
			});
		}
		const color = base.color ?? "#b3b3b3";
		const rgb = [1, 3, 5].map(
			(k) => Number.parseInt(color.slice(k, k + 2), 16) / 255,
		);
		const data: Mesh3DData = {
			name,
			positions,
			normals,
			uvs: new Float32Array(count * 2),
			indices: Uint32Array.from({ length: count }, (_, k) => k),
			materialName: `${name}-material`,
		};
		const material: Material3D = {
			name: `${name}-material`,
			diffuseColor: [rgb[0], rgb[1], rgb[2], 1],
			shading: "lit",
		};
		const { id, label, opacity, x, y, z, rotateX, rotateY, rotateZ } = base;
		return Layer.model({
			id,
			label,
			x,
			y,
			z,
			rotateX,
			rotateY,
			rotateZ,
			modelData: finalizeModel3DData(name, [data], {
				[material.name]: material,
			}),
			is3D: true,
			opacity: typeof opacity === "number" ? opacity : 1,
		}) as unknown as LayoutNode;
	}
}
