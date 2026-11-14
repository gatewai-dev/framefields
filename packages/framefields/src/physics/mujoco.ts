/**
 * MuJoCo worlds: a model in MJCF (robots, articulated mechanisms, the
 * models labs already have) simulated by Google DeepMind's MuJoCo, compiled
 * to WebAssembly (`@mujoco/mujoco`, single-threaded, so a run is the same on
 * every machine). Like the Rapier worlds, it simulates once, while the
 * composition is built, and replays as per-frame signals: `layers()` draws
 * every visible geom as a Layer3D primitive that follows its body.
 *
 * MuJoCo is z-up in meters; the scene is y-down in pixels. A point (x, y, z)
 * of the model lands at `origin + pixelsPerMeter * (x, -z, y)`, a proper
 * rotation, so the model is not mirrored.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	type AnimatableProp,
	LayerAnimation,
} from "@framefields/compositions/program";
import type { FrameSignal } from "@framefields/core";
import {
	finalizeModel3DData,
	getPrimitiveGeometry,
	type Material3D,
	type Mesh3DData,
	type PrimitiveGeometryOptions,
} from "@framefields/webgpu-renderers";
import { encodePng } from "@framefields/webgpu-renderers/gltf";
import { Layer, type LayoutNode } from "../index.js";
import { Layer3D } from "../shapes3d.js";
import type { Quat, Vec3 } from "./backend.js";
import { type LiveHost, Recording } from "./core.js";
import { quatFromMatrix } from "./poses.js";
import { eulerFromQuat } from "./world3d.js";

// ---------------------------------------------------------------------------
// The slice of the bindings this module uses (their typings are mostly `any`).
// ---------------------------------------------------------------------------

interface MjModel {
	nbody: number;
	ngeom: number;
	nq: number;
	nv: number;
	nu: number;
	na: number;
	njnt: number;
	nsensor: number;
	ncam: number;
	ntendon: number;
	jnt_type: Int32Array;
	jnt_qposadr: Int32Array;
	jnt_dofadr: Int32Array;
	name_jntadr: Int32Array;
	name_actuatoradr: Int32Array;
	name_sensoradr: Int32Array;
	sensor_adr: Int32Array;
	sensor_dim: Int32Array;
	name_camadr: Int32Array;
	cam_fovy: Float64Array;
	name_tendonadr: Int32Array;
	tendon_num: Int32Array;
	tendon_group: Int32Array;
	tendon_width: Float64Array;
	tendon_rgba: Float32Array;
	opt: { timestep: number; integrator: number };
	geom_type: Int32Array;
	geom_size: Float64Array;
	geom_rgba: Float32Array;
	geom_bodyid: Int32Array;
	geom_group: Int32Array;
	geom_dataid: Int32Array;
	geom_matid: Int32Array;
	mat_rgba: Float32Array;
	/** Per material, one texture per role (`mjNTEXROLE` of them); role 1 is RGB. */
	mat_texid: Int32Array;
	mat_texrepeat: Float32Array;
	mat_texuniform: Uint8Array;
	nmat: number;
	tex_type: Int32Array;
	tex_width: Int32Array;
	tex_height: Int32Array;
	tex_nchannel: Int32Array;
	tex_adr: Int32Array;
	tex_data: Uint8Array;
	mesh_texcoord: Float32Array;
	mesh_texcoordadr: Int32Array;
	mesh_texcoordnum: Int32Array;
	mesh_facetexcoord: Int32Array;
	mesh_vert: Float32Array;
	mesh_vertadr: Int32Array;
	mesh_vertnum: Int32Array;
	mesh_face: Int32Array;
	mesh_faceadr: Int32Array;
	mesh_facenum: Int32Array;
	names: Int8Array;
	name_geomadr: Int32Array;
	name_bodyadr: Int32Array;
	delete(): void;
}

interface MjContact {
	geom1: number;
	geom2: number;
	pos: ArrayLike<number>;
}

interface MjData {
	time: number;
	ncon: number;
	qpos: Float64Array;
	qvel: Float64Array;
	act: Float64Array;
	ctrl: Float64Array;
	sensordata: Float64Array;
	cam_xpos: Float64Array;
	cam_xmat: Float64Array;
	ten_wrapadr: Int32Array;
	ten_wrapnum: Int32Array;
	wrap_obj: Int32Array;
	wrap_xpos: Float64Array;
	xpos: Float64Array;
	xquat: Float64Array;
	geom_xpos: Float64Array;
	geom_xmat: Float64Array;
	contact: { get(i: number): MjContact | undefined; delete(): void };
	delete(): void;
}

interface DoubleBuffer {
	GetView(): Float64Array;
	delete(): void;
}

interface MujocoModule {
	MjModel: { from_xml_path(path: string): MjModel };
	/**
	 * Emscripten's in-memory file system. Writing a file there is one copy;
	 * `MjVFS.addBuffer` converts bytes one by one (about 0.5 s per MB).
	 */
	FS: {
		mkdirTree(path: string): void;
		writeFile(path: string, data: Uint8Array): void;
		unlink(path: string): void;
	};
	MjData: new (model: MjModel) => MjData;
	DoubleBuffer: new (size: number) => DoubleBuffer;
	mj_forward(model: MjModel, data: MjData): void;
	mj_step(model: MjModel, data: MjData): void;
	mj_fwdPosition(model: MjModel, data: MjData): void;
	mj_step1(model: MjModel, data: MjData): void;
	mj_step2(model: MjModel, data: MjData): void;
	mj_contactForce(
		model: MjModel,
		data: MjData,
		id: number,
		out: DoubleBuffer,
	): void;
	mj_stateSize(model: MjModel, spec: number): number;
	mj_getState(
		model: MjModel,
		data: MjData,
		out: DoubleBuffer,
		spec: number,
	): void;
	mj_setState(
		model: MjModel,
		data: MjData,
		state: number[],
		spec: number,
	): void;
	mjtState: { mjSTATE_INTEGRATION: { value: number } };
}

let modulePromise: Promise<MujocoModule> | null = null;
/** Models compiled so far: each gets its own folder in MuJoCo's file system. */
let compiledModels = 0;

/** Loads MuJoCo's WebAssembly once (about 50 ms), on first use. */
function loadMujoco(): Promise<MujocoModule> {
	modulePromise ??= import("@mujoco/mujoco").then(
		async ({ default: load }) => (await load()) as unknown as MujocoModule,
	);
	return modulePromise;
}

// ---------------------------------------------------------------------------
// Axes: MuJoCo (z up, meters) → scene (y down, px).
// ---------------------------------------------------------------------------

/** MuJoCo's geom types (`mjtGeom`) this module draws. */
const GEOM = {
	plane: 0,
	sphere: 2,
	capsule: 3,
	ellipsoid: 4,
	cylinder: 5,
	box: 6,
	mesh: 7,
} as const;

/** `mjtIntegrator` RK4. */
const RK4 = 1;

/** `mjtJoint` by value. */
const JOINT_TYPES = ["free", "ball", "slide", "hinge"] as const;

/** Animated props of a model camera. */
const CAMERA_CHANNELS = [
	"cameraX",
	"cameraY",
	"cameraZ",
	"targetX",
	"targetY",
	"targetZ",
	"cameraRoll",
] as const;

/** How far ahead of a model camera its look-at target sits, px. */
const CAMERA_REACH = 1000;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
	const len = Math.hypot(...v) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
};

/** `next` in degrees, moved by whole turns to sit nearest `previous`. */
function unwrap(previous: number, next: number): number {
	return next + 360 * Math.round((previous - next) / 360);
}

/** The shortest rotation turning unit `a` onto unit `b`, as [x, y, z, w]. */
function quatBetween(a: Vec3, b: Vec3): Quat {
	const d = dot(a, b);
	if (d < -0.999999) {
		// Opposite: half a turn about any axis perpendicular to a.
		const axis = normalize(
			Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]),
		);
		return [axis[0], axis[1], axis[2], 0];
	}
	const c = cross(a, b);
	const w = 1 + d;
	const len = Math.hypot(c[0], c[1], c[2], w);
	return [c[0] / len, c[1] / len, c[2] / len, w / len];
}

/** C · R · Cᵀ for C = [[1,0,0],[0,0,-1],[0,1,0]], on a row-major 3×3. */
function toSceneMatrix(m: ArrayLike<number>, o: number): number[] {
	const r = (i: number, j: number) => m[o + i * 3 + j];
	return [
		r(0, 0),
		-r(0, 2),
		r(0, 1),
		-r(2, 0),
		r(2, 2),
		-r(2, 1),
		r(1, 0),
		-r(1, 2),
		r(1, 1),
	];
}

function readName(model: MjModel, adr: number): string {
	let end = adr;
	while (end < model.names.length && model.names[end] !== 0) end++;
	return String.fromCharCode(...model.names.subarray(adr, end));
}

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

/** What `control` sees before each frame is stepped. */
export interface MujocoFrameState {
	/** Simulated seconds since the run began. */
	time: number;
	/** Generalized positions (MuJoCo's `qpos`), read-only. */
	qpos: Float64Array;
}

export interface MujocoWorldOptions {
	/**
	 * The model's MJCF file. Every file in its folder (and below) is given to
	 * MuJoCo, so meshes, textures and includes resolve as they do natively.
	 */
	path?: string;
	/** Or the model as MJCF XML, with the files it names in `files`. */
	mjcf?: string;
	/** Files an `mjcf` string refers to (meshes, includes), by the name it uses. */
	files?: Record<string, Uint8Array>;
	fps: number;
	/** How many frames to simulate. Signals hold the last frame afterwards. */
	frames: number;
	/** Composition frame the run starts at; before it, the start pose. Default 0. */
	startFrame?: number;
	/** Scene pixels per meter. Default 100 (what `exportModel` assumes). */
	pixelsPerMeter?: number;
	/** Where the model's origin lands in the scene, px. Default [0, 0, 0]. */
	origin?: Vec3;
	/**
	 * Actuator commands for each frame (MuJoCo's `ctrl`, one per actuator),
	 * held while that frame is stepped. `frame` is relative to the start.
	 */
	control?: (frame: number, state: MujocoFrameState) => ArrayLike<number>;
	/** A state from `world.state(frame)` to start from instead of the model's. */
	initialState?: Float64Array;
	/**
	 * Generalized positions recorded by another simulator (native MuJoCo,
	 * MJX, a policy rollout), one `nq`-long row per frame: each frame is
	 * posed from its row through MuJoCo's kinematics instead of simulated.
	 * Needs at least `frames` rows; `control` and `initialState` do not apply.
	 */
	qpos?: ArrayLike<ArrayLike<number>>;
}

export interface MujocoLayersOptions {
	/** Geom groups to draw. Default [0, 1, 2]: MuJoCo's visible groups. */
	groups?: number[];
	/** Prefixed to geom names for layer ids. Default "mujoco:". */
	idPrefix?: string;
}

/** A plane draws as a slab this thick (px), its top face on the plane. */
const PLANE_SLAB = 2;

/**
 * A geom pair that touched during a frame (in any of its MuJoCo steps, so
 * a contact that starts and ends between two frames still counts), by geom
 * name (or `geom<index>`).
 */
export interface MujocoContact {
	geom1: string;
	geom2: string;
	/** Peak normal force over the frame's steps, newtons. */
	force: number;
	/** Where it peaked, scene px. */
	position: Vec3;
}

/** A joint of the model, and where its values sit in qpos / qvel. */
export interface MujocoJoint {
	name: string;
	type: "free" | "ball" | "slide" | "hinge";
	/** First index in `qpos(frame)` (free: 7 values, ball: 4, else 1). */
	qpos: number;
	/** First index in `qvel(frame)` (free: 6, ball: 3, else 1). */
	qvel: number;
}

/** A sensor of the model, and where its values sit in `sensordata(frame)`. */
export interface MujocoSensor {
	name: string;
	adr: number;
	dim: number;
}

/** What `camera()` takes. */
export interface MujocoCameraOptions {
	/** Layer id. Default `mujoco-camera:<name>`. */
	id?: string;
}

const POSE_CHANNELS = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"] as const;

/** A model to compile: MJCF text or the entry file, and the files it reads. */
interface ModelSource {
	xml?: string;
	entry?: string;
	files: Record<string, Uint8Array>;
}

/** MuJoCo's default geom color: a geom that keeps it shows its material's. */
const DEFAULT_RGBA = [0.5, 0.5, 0.5, 1];

/** A mesh geom's triangles in its own frame, scene axes and px, unwelded. */
interface GeomMesh {
	positions: Float32Array;
	normals: Float32Array;
	/** Per corner, when the mesh has texture coordinates. */
	uvs?: Float32Array;
	/** Seen from both sides (a plane's single face). */
	twoSided?: boolean;
}

/** A geom's 2D color texture (its material's), as a PNG. */
interface GeomTexture {
	/** `2d`, or `cube`: six square faces stacked top to bottom (+x, -x, +y, -y, +z, -z). */
	kind: "2d" | "cube";
	png: Uint8Array;
	/** Material `texrepeat`. */
	repeat: [number, number];
	/** Material `texuniform`: repeat per meter instead of per surface. */
	uniform: boolean;
}

/** MuJoCo's `mjtTexture` types and the RGB texture role (`mjTEXROLE_RGB`). */
const TEX_2D = 0;
const TEX_CUBE = 1;
const TEXROLE_RGB = 1;

export class MujocoWorld {
	readonly fps: number;
	readonly frames: number;
	readonly startFrame: number;
	readonly pixelsPerMeter: number;
	/** Geom names by index (`geom<index>` when unnamed). */
	readonly geomNames: string[];
	/** Body names by index (`body<index>` when unnamed; 0 is the world). */
	readonly bodyNames: string[];
	/** Joints, in model order, with their qpos / qvel addresses. */
	readonly joints: MujocoJoint[];
	/** Actuator names, in `ctrl` order (`actuator<index>` when unnamed). */
	readonly actuatorNames: string[];
	/** Sensors, in `sensordata` order. */
	readonly sensors: MujocoSensor[];
	/** The model's `<camera>` names (`camera<index>` when unnamed). */
	readonly cameraNames: string[];
	/** Tendon names (`tendon<index>` when unnamed). */
	readonly tendonNames: string[];
	private readonly tendonMaxSegments: number[];

	private readonly origin: Vec3;
	private readonly geomRecordings: Recording[];
	private readonly geomType: Int32Array;
	private readonly geomSize: Float64Array;
	private readonly geomRgba: Float32Array;
	private readonly geomBody: Int32Array;
	private readonly geomGroup: Int32Array;
	private readonly geomMeshes: Array<GeomMesh | undefined>;
	private readonly geomTextures: Array<GeomTexture | undefined>;
	private readonly qposFrames: Float64Array[] = [];
	private readonly qvelFrames: Float64Array[] = [];
	private readonly actFrames: Float64Array[] = [];
	private readonly ctrlFrames: Float64Array[] = [];
	private readonly sensorFrames: Float64Array[] = [];
	/** Contacts seen in the steps since the last recorded frame, by geom pair. */
	private readonly pendingContacts = new Map<string, MujocoContact>();
	private forceBuffer?: DoubleBuffer;
	private readonly cameraFovy: number[];
	private readonly cameraRecordings: Recording[];
	private readonly tendonWidth: Float64Array;
	private readonly tendonRgba: Float32Array;
	private readonly tendonGroup: Int32Array;
	/** Per tendon: one recording per drawable segment of its path. */
	private readonly tendonSegments: Recording[][];
	private readonly stateFrames: Float64Array[] = [];
	private readonly contactFrames: MujocoContact[][] = [];
	/** The model and data of a run in progress, and the last frame stepped. */
	private run?: {
		model: MjModel;
		data: MjData;
		substeps: number;
		current: number;
	};
	private finished = false;
	private liveMode = false;
	/** The model compiled for reading it, kept for `simulate()` to run and free. */
	private compiled: MjModel | null;

	/** @internal */
	constructor(
		private readonly mj: MujocoModule,
		private readonly options: MujocoWorldOptions,
		private readonly source: ModelSource,
	) {
		this.fps = options.fps;
		this.frames = Math.max(1, Math.round(options.frames));
		this.startFrame = Math.max(0, Math.round(options.startFrame ?? 0));
		this.pixelsPerMeter = options.pixelsPerMeter ?? 100;
		this.origin = options.origin ?? [0, 0, 0];
		const model = this.compile();
		try {
			this.geomNames = Array.from(
				model.name_geomadr,
				(adr, i) => readName(model, adr) || `geom${i}`,
			);
			this.bodyNames = Array.from(model.name_bodyadr, (adr, i) =>
				i === 0 ? "world" : readName(model, adr) || `body${i}`,
			);
			this.geomType = model.geom_type.slice();
			this.geomSize = model.geom_size.slice();
			this.geomRgba = geomColors(model);
			this.geomBody = model.geom_bodyid.slice();
			this.geomGroup = model.geom_group.slice();
			this.geomMeshes = Array.from(model.geom_type, (type, i) =>
				type === GEOM.mesh
					? meshTriangles(model, model.geom_dataid[i], this.pixelsPerMeter)
					: undefined,
			);
			this.geomTextures = geomTextures(model);
			const named = (adr: Int32Array, kind: string) =>
				Array.from(adr, (a, i) => readName(model, a) || `${kind}${i}`);
			const jointNames = named(model.name_jntadr, "joint");
			this.joints = jointNames.map((name, i) => ({
				name,
				type: JOINT_TYPES[model.jnt_type[i]],
				qpos: model.jnt_qposadr[i],
				qvel: model.jnt_dofadr[i],
			}));
			this.actuatorNames = named(model.name_actuatoradr, "actuator");
			this.sensors = named(model.name_sensoradr, "sensor").map((name, i) => ({
				name,
				adr: model.sensor_adr[i],
				dim: model.sensor_dim[i],
			}));
			this.cameraNames = named(model.name_camadr, "camera");
			this.cameraFovy = Array.from(model.cam_fovy);
			this.tendonNames = named(model.name_tendonadr, "tendon");
			this.tendonWidth = model.tendon_width.slice();
			this.tendonRgba = model.tendon_rgba.slice();
			this.tendonGroup = model.tendon_group.slice();
			// A path has at most a few points per wrap object (sites one, wrapped
			// geoms two tangent points): room for every segment it can draw.
			this.tendonMaxSegments = Array.from(model.tendon_num, (n) =>
				Math.max(1, 3 * n - 1),
			);
		} catch (error) {
			model.delete();
			throw error;
		}
		this.compiled = model;
		const length = this.startFrame + this.frames;
		const recording = () =>
			new Recording(length, this.fps, () => {
				// A live world shows what it has stepped; the rest runs now.
				if (!this.liveMode) this.stepTo(this.frames - 1);
			});
		this.geomRecordings = this.geomNames.map(recording);
		this.cameraRecordings = this.cameraNames.map(recording);
		this.tendonSegments = this.tendonMaxSegments.map((n) =>
			Array.from({ length: n }, recording),
		);
	}

	/**
	 * Runs the whole simulation (once; reading any signal runs it too).
	 * Each frame takes as many MuJoCo steps as fit, the model's timestep
	 * shortened so they end exactly on the frame.
	 */
	simulate(): this {
		if (this.liveMode)
			throw new Error(
				"Physics.mujoco: this world is live; it steps as frames render.",
			);
		this.stepTo(this.frames - 1);
		return this;
	}

	/**
	 * Steps the world as the composition renders instead of all at once:
	 * before each frame draws, the world advances to it, calling `control`
	 * for every frame it steps. Use it for agents: set the action `control`
	 * returns, then render the next frame. Frames already stepped are kept.
	 */
	live(comp: LiveHost): this {
		if (this.run || this.finished)
			throw new Error(
				"Physics.mujoco: live() must come before simulate() or reading the run.",
			);
		if (this.options.qpos)
			throw new Error(
				"Physics.mujoco: a `qpos` replay is recorded already; it cannot be live.",
			);
		this.liveMode = true;
		comp.onPrepareFrame((ctx) => {
			this.stepTo(ctx.frame - this.startFrame);
		});
		return this;
	}

	/** The last frame stepped (relative to the start); -1 before the run starts. */
	get steppedFrame(): number {
		return this.finished ? this.frames - 1 : (this.run?.current ?? -1);
	}

	/** Runs (or continues) the simulation up to `target`, freeing it at the end. */
	private stepTo(target: number): void {
		if (this.finished) return;
		const run = this.run ?? this.start();
		if (!run) return;
		const last = Math.min(this.frames - 1, Math.round(target));
		try {
			while (run.current < last) {
				const f = run.current + 1;
				this.step(run.model, run.data, f - 1, run.substeps);
				this.record(run.model, run.data, f);
				run.current = f;
			}
		} catch (error) {
			this.free();
			throw error;
		}
		if (run.current === this.frames - 1) this.free();
	}

	/** Compiles the model, sets the start state and records frame 0. */
	private start(): typeof this.run {
		const { mj } = this;
		const model = this.compiled ?? this.compile();
		this.compiled = null;
		const data = new mj.MjData(model);
		this.run = { model, data, substeps: 1, current: 0 };
		try {
			if (this.options.qpos) {
				this.replay(model, data, this.options.qpos);
				this.free();
				return undefined;
			}
			const dt = 1 / this.fps;
			const substeps = Math.max(1, Math.round(dt / model.opt.timestep));
			model.opt.timestep = dt / substeps;
			this.run.substeps = substeps;
			if (this.options.initialState) {
				mj.mj_setState(
					model,
					data,
					Array.from(this.options.initialState),
					this.stateSpec,
				);
			}
			mj.mj_forward(model, data);
			this.record(model, data, 0);
		} catch (error) {
			this.free();
			throw error;
		}
		return this.run;
	}

	private free(): void {
		this.finished = true;
		this.forceBuffer?.delete();
		this.forceBuffer = undefined;
		if (!this.run) return;
		this.run.data.delete();
		this.run.model.delete();
		this.run = undefined;
	}

	/**
	 * Every visible geom as a Layer3D primitive that follows its body
	 * (planes as thin slabs, their top at the plane). Meshes draw as their
	 * triangles. A material's 2D texture shows on planes (with its
	 * `texrepeat` / `texuniform`) and on meshes with texture coordinates;
	 * other geoms, and cube textures, show the material's color. Types not
	 * drawn (height fields, SDFs) are named in `skipped`.
	 */
	layers(options: MujocoLayersOptions = {}): {
		layers: LayoutNode[];
		skipped: string[];
	} {
		const groups = options.groups ?? [0, 1, 2];
		const prefix = options.idPrefix ?? "mujoco:";
		const layers: LayoutNode[] = [];
		const skipped: string[] = [];
		this.geomNames.forEach((name, i) => {
			if (!groups.includes(this.geomGroup[i])) return;
			const layer = this.geomLayer(i, `${prefix}${name}`);
			if (layer) layers.push(layer);
			else skipped.push(`${name} (type ${this.geomType[i]})`);
		});
		layers.push(...this.tendonLayers(groups, `${prefix}tendon:`));
		return { layers, skipped };
	}

	/** A geom's center (px) and rotation (degrees) as per-frame signals. */
	geom(
		name: string,
	): Record<(typeof POSE_CHANNELS)[number], FrameSignal<number>> {
		const i = this.geomNames.indexOf(name);
		if (i < 0)
			throw new Error(
				`MuJoCo: no geom "${name}" (geoms: ${this.geomNames.join(", ")}).`,
			);
		const rec = this.geomRecordings[i];
		return Object.fromEntries(
			POSE_CHANNELS.map((c) => [c, rec.signal(c)]),
		) as Record<(typeof POSE_CHANNELS)[number], FrameSignal<number>>;
	}

	/** Generalized positions at a frame (relative to the start). */
	qpos(frame: number): Float64Array {
		return this.qposFrames[this.readable(frame)];
	}

	/**
	 * The full integration state at a frame (relative to the start): pass it
	 * as `initialState` to branch a new run from there.
	 */
	state(frame: number): Float64Array {
		return this.stateFrames[this.readable(frame)];
	}

	/** Generalized velocities at a frame (relative to the start). */
	qvel(frame: number): Float64Array {
		return this.qvelFrames[this.readable(frame)];
	}

	/** Actuator activations at a frame (empty for stateless actuators). */
	act(frame: number): Float64Array {
		return this.actFrames[this.readable(frame)];
	}

	/** The actuator commands that stepped the world into `frame` (zeros at 0). */
	ctrl(frame: number): Float64Array {
		return this.ctrlFrames[this.readable(frame)];
	}

	/**
	 * The commands that drive `frame` to the next one: what robot-learning
	 * datasets call the action at `frame` (the last frame repeats its own).
	 */
	action(frame: number): Float64Array {
		const f = this.readable(frame);
		const next = Math.min(f + 1, this.steppedFrame);
		return this.ctrlFrames[next > f ? next : f];
	}

	/** Every sensor's values at a frame (`sensors` says where each sits). */
	sensordata(frame: number): Float64Array {
		return this.sensorFrames[this.readable(frame)];
	}

	/** One sensor's values at a frame. */
	sensor(name: string, frame: number): Float64Array {
		const s = this.sensors.find((x) => x.name === name);
		if (!s)
			throw new Error(
				`MuJoCo: no sensor "${name}" (sensors: ${this.sensors.map((x) => x.name).join(", ") || "none"}).`,
			);
		return this.sensordata(frame).subarray(s.adr, s.adr + s.dim);
	}

	/**
	 * A scene camera at one of the model's `<camera>`s (a wrist camera, a
	 * fixed overhead one): it follows the camera's pose every frame, with
	 * its vertical field of view. Add it to the composition that should
	 * see through it.
	 */
	camera(name: string, options: MujocoCameraOptions = {}): LayoutNode {
		const i = this.cameraNames.indexOf(name);
		if (i < 0)
			throw new Error(
				`MuJoCo: no camera "${name}" (cameras: ${this.cameraNames.join(", ") || "none"}).`,
			);
		const rec = this.cameraRecordings[i];
		if (!this.run && !this.finished) {
			if (this.liveMode) this.start();
			else this.simulate();
		}
		const first = (c: string) => rec.channel(c)[this.startFrame];
		const node = Layer.camera({
			id: options.id ?? `mujoco-camera:${name}`,
			x: first("cameraX"),
			y: first("cameraY"),
			z: first("cameraZ"),
			targetX: first("targetX"),
			targetY: first("targetY"),
			targetZ: first("targetZ"),
			roll: first("cameraRoll"),
			fov: this.cameraFovy[i],
		});
		const anim = LayerAnimation.create();
		for (const c of CAMERA_CHANNELS)
			anim.signal(c as AnimatableProp, rec.signal(c));
		(node as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
		return node as unknown as LayoutNode;
	}

	/** Geom pairs in contact at a frame (relative to the start). */
	contacts(frame: number): MujocoContact[] {
		return this.contactFrames[this.readable(frame)];
	}

	/**
	 * Compiles the model from its files, written for the call into a folder
	 * of MuJoCo's in-memory file system, so relative paths (`meshdir`,
	 * includes) resolve as they do natively.
	 */
	private compile(): MjModel {
		const { FS, MjModel } = this.mj;
		const root = `/framefields-mujoco/${++compiledModels}`;
		const entry = this.source.entry ?? "model.xml";
		const files = this.source.entry
			? this.source.files
			: {
					...this.source.files,
					[entry]: new TextEncoder().encode(this.source.xml ?? ""),
				};
		const written: string[] = [];
		try {
			for (const [name, bytes] of Object.entries(files)) {
				const file = path.posix.join(root, name);
				FS.mkdirTree(path.posix.dirname(file));
				FS.writeFile(file, bytes);
				written.push(file);
			}
			return MjModel.from_xml_path(path.posix.join(root, entry));
		} finally {
			for (const file of written) FS.unlink(file);
		}
	}

	/** Poses each frame from its recorded `qpos` row (kinematics only). */
	private replay(
		model: MjModel,
		data: MjData,
		qpos: ArrayLike<ArrayLike<number>>,
	): void {
		if (this.options.control || this.options.initialState)
			throw new Error(
				"Physics.mujoco: `qpos` replays a recorded run; drop `control` and `initialState`.",
			);
		if (qpos.length < this.frames)
			throw new Error(
				`Physics.mujoco: \`qpos\` has ${qpos.length} rows for ${this.frames} frames.`,
			);
		for (let f = 0; f < this.frames; f++) {
			const row = qpos[f];
			if (row.length !== model.nq)
				throw new Error(
					`Physics.mujoco: \`qpos\` row ${f} has ${row.length} values; the model has nq = ${model.nq}.`,
				);
			data.qpos.set(row);
			this.mj.mj_forward(model, data);
			this.record(model, data, f);
		}
	}

	private get stateSpec(): number {
		return this.mj.mjtState.mjSTATE_INTEGRATION.value;
	}

	/**
	 * A recorded frame to read: the whole run is simulated first, or (live)
	 * the frame must have been stepped.
	 */
	private readable(frame: number): number {
		const f = this.clamp(frame);
		if (!this.liveMode) this.stepTo(this.frames - 1);
		else if (f > this.steppedFrame)
			throw new Error(
				`Physics.mujoco: frame ${f} has not been stepped yet (live, at ${this.steppedFrame}).`,
			);
		return f;
	}

	private clamp(frame: number): number {
		return Math.max(0, Math.min(this.frames - 1, Math.round(frame)));
	}

	private step(
		model: MjModel,
		data: MjData,
		frame: number,
		substeps: number,
	): void {
		const ctrl = this.options.control?.(frame, {
			time: data.time,
			qpos: data.qpos,
		});
		if (ctrl) {
			if (ctrl.length !== model.nu)
				throw new Error(
					`MuJoCo: control returned ${ctrl.length} values; the model has ${model.nu} actuators.`,
				);
			data.ctrl.set(ctrl);
		}
		// RK4 cannot be split; the other integrators step as mj_step2 then
		// mj_step1 (the same trajectory as mj_step), which leaves positions,
		// velocities, contacts and sensors at the state each step ends on.
		const split = model.opt.integrator !== RK4;
		for (let s = 0; s < substeps; s++) {
			if (split) this.mj.mj_step2(model, data);
			else this.mj.mj_step(model, data);
			// The contacts (and forces) this step solved: brief ones count too.
			this.collectContacts(model, data);
			if (split) this.mj.mj_step1(model, data);
		}
		// mj_step computes positions before it integrates: bring poses up to
		// the state it ends on (the solver's warmstart is left alone).
		if (!split) this.mj.mj_fwdPosition(model, data);
	}

	private record(model: MjModel, data: MjData, frame: number): void {
		// The first frame (and a replayed one) has no steps: its own contacts.
		if (frame === 0 || this.options.qpos) this.collectContacts(model, data);
		this.qposFrames.push(data.qpos.slice());
		this.qvelFrames.push(data.qvel.slice());
		this.actFrames.push(data.act.slice());
		this.ctrlFrames.push(data.ctrl.slice());
		this.sensorFrames.push(data.sensordata.slice());
		const size = this.mj.mj_stateSize(model, this.stateSpec);
		const buffer = new this.mj.DoubleBuffer(size);
		try {
			this.mj.mj_getState(model, data, buffer, this.stateSpec);
			this.stateFrames.push(buffer.GetView().slice());
		} finally {
			buffer.delete();
		}
		this.contactFrames.push([...this.pendingContacts.values()]);
		this.pendingContacts.clear();
		this.recordCameras(data, frame);
		this.recordTendons(data, frame);
		const ppm = this.pixelsPerMeter;
		const at = this.startFrame + frame;
		this.geomRecordings.forEach((rec, i) => {
			const p = data.geom_xpos.subarray(i * 3, i * 3 + 3);
			const m = toSceneMatrix(data.geom_xmat, i * 9);
			const q = quatFromMatrix(m);
			// A plane's slab hangs below it: half its thickness along local +y.
			const sink = this.geomType[i] === GEOM.plane ? PLANE_SLAB / 2 : 0;
			const prev =
				at > 0
					? ([
							rec.channel("rotateX")[at - 1],
							rec.channel("rotateY")[at - 1],
							rec.channel("rotateZ")[at - 1],
						] as Vec3)
					: undefined;
			const e = eulerFromQuat(q, frame > 0 ? prev : undefined);
			const values = [
				this.origin[0] + p[0] * ppm + m[1] * sink,
				this.origin[1] - p[2] * ppm + m[4] * sink,
				this.origin[2] + p[1] * ppm + m[7] * sink,
				...e,
			];
			POSE_CHANNELS.forEach((c, k) => {
				const arr = rec.channel(c);
				arr[at] = values[k];
				// Before the run starts, the start pose (and, until they are
				// stepped, every later frame of a live run).
				if (frame === 0) arr.fill(values[k]);
			});
		});
	}

	/**
	 * Folds the contacts MuJoCo holds now into the frame's. A geom pair may
	 * touch at several points (a box's corners): its force is their sum,
	 * at their force-weighted center; the frame keeps each pair's peak.
	 */
	private collectContacts(model: MjModel, data: MjData): void {
		if (data.ncon === 0) return;
		this.forceBuffer ??= new this.mj.DoubleBuffer(6);
		const buffer = this.forceBuffer;
		const list = data.contact;
		const now = new Map<
			string,
			{ g1: number; g2: number; force: number; at: Vec3; points: number }
		>();
		try {
			for (let i = 0; i < data.ncon; i++) {
				const c = list.get(i);
				if (!c) continue;
				this.mj.mj_contactForce(model, data, i, buffer);
				const force = Math.abs(buffer.GetView()[0]);
				const key = `${c.geom1}:${c.geom2}`;
				const p = c.pos;
				const pair = now.get(key) ?? {
					g1: c.geom1,
					g2: c.geom2,
					force: 0,
					at: [0, 0, 0] as Vec3,
					points: 0,
				};
				pair.force += force;
				// Weighted by force; equally while nothing pushes yet.
				const w = force > 0 ? force : 1e-9;
				for (let k = 0; k < 3; k++) pair.at[k] += p[k] * w;
				pair.points += w;
				now.set(key, pair);
			}
		} finally {
			list.delete();
		}
		for (const [key, pair] of now) {
			const seen = this.pendingContacts.get(key);
			if (seen && seen.force >= pair.force) continue;
			const [x, y, z] = pair.at.map((v) => v / pair.points);
			this.pendingContacts.set(key, {
				geom1: this.geomNames[pair.g1],
				geom2: this.geomNames[pair.g2],
				force: pair.force,
				position: this.toScene(x, y, z),
			});
		}
	}

	/** A model point (meters, z up) in scene px. */
	private toScene(x: number, y: number, z: number): Vec3 {
		const ppm = this.pixelsPerMeter;
		return [
			this.origin[0] + x * ppm,
			this.origin[1] - z * ppm,
			this.origin[2] + y * ppm,
		];
	}

	/**
	 * Each camera's eye, a target along its view axis and the roll that turns
	 * the scene camera's up to the camera's: MuJoCo cameras look along their
	 * -z with +y up.
	 */
	private recordCameras(data: MjData, frame: number): void {
		const at = this.startFrame + frame;
		this.cameraRecordings.forEach((rec, i) => {
			const p = data.cam_xpos.subarray(i * 3, i * 3 + 3);
			const m = data.cam_xmat.subarray(i * 9, i * 9 + 9);
			// Columns of the row-major frame: the camera's axes in model space.
			const axis = (k: number) => this.direction(m[k], m[3 + k], m[6 + k]);
			const up = axis(1);
			let fwd = axis(2).map((v) => -v) as Vec3;
			// Looking straight up or down leaves look-at without a right: tilt a hair toward the camera's up.
			if (Math.abs(fwd[1]) > 0.99999)
				fwd = normalize([
					fwd[0] + up[0] * 1e-3,
					fwd[1] + up[1] * 1e-3,
					fwd[2] + up[2] * 1e-3,
				]);
			const eye = this.toScene(p[0], p[1], p[2]);
			const right0 = normalize(cross(fwd, [0, -1, 0]));
			const up0 = cross(right0, fwd);
			let roll = (Math.atan2(dot(up, right0), dot(up, up0)) * 180) / Math.PI;
			if (frame > 0) roll = unwrap(rec.channel("cameraRoll")[at - 1], roll);
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
				const arr = rec.channel(c);
				if (frame === 0) arr.fill(values[c]);
				else arr[at] = values[c];
			}
		});
	}

	/** A model direction in scene axes (unit length). */
	private direction(x: number, y: number, z: number): Vec3 {
		return normalize([x, -z, y]);
	}

	/**
	 * Each tendon path's segments (between consecutive path points, broken
	 * at pulleys) as capsule poses: center, rotation turning +y along the
	 * segment, length; segments the path does not use this frame hide.
	 */
	private recordTendons(data: MjData, frame: number): void {
		const at = this.startFrame + frame;
		this.tendonSegments.forEach((segments, t) => {
			const adr = data.ten_wrapadr[t];
			const num = data.ten_wrapnum[t];
			const points: Array<Vec3 | null> = [];
			for (let k = 0; k < num; k++) {
				const j = adr + k;
				// A pulley (-2) divides the path.
				points.push(
					data.wrap_obj[j] === -2
						? null
						: this.toScene(
								data.wrap_xpos[j * 3],
								data.wrap_xpos[j * 3 + 1],
								data.wrap_xpos[j * 3 + 2],
							),
				);
			}
			const pairs: Array<[Vec3, Vec3]> = [];
			for (let k = 0; k + 1 < points.length; k++) {
				const a = points[k];
				const b = points[k + 1];
				if (a && b) pairs.push([a, b]);
			}
			segments.forEach((rec, k) => {
				const pair = pairs[k];
				const prev = (c: string) => rec.channel(c)[at - 1];
				let values: Record<string, number>;
				if (pair) {
					const [a, b] = pair;
					const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
					const length = Math.hypot(...d);
					const e = eulerFromQuat(
						quatBetween([0, 1, 0], length > 0 ? normalize(d) : [0, 1, 0]),
						frame > 0
							? [prev("rotateX"), prev("rotateY"), prev("rotateZ")]
							: undefined,
					);
					values = {
						x: (a[0] + b[0]) / 2,
						y: (a[1] + b[1]) / 2,
						z: (a[2] + b[2]) / 2,
						rotateX: e[0],
						rotateY: e[1],
						rotateZ: e[2],
						scaleY: Math.max(length, 1e-3),
						opacity: 1,
					};
				} else {
					values = {
						x: 0,
						y: 0,
						z: 0,
						rotateX: 0,
						rotateY: 0,
						rotateZ: 0,
						scaleY: 1,
						opacity: 0,
					};
				}
				for (const [c, v] of Object.entries(values)) {
					const arr = rec.channel(c);
					if (frame === 0) arr.fill(v);
					else arr[at] = v;
				}
			});
		});
	}

	/** Every tendon (in `groups`) as capsule segments that follow its path. */
	private tendonLayers(groups: number[], prefix: string): LayoutNode[] {
		const out: LayoutNode[] = [];
		this.tendonSegments.forEach((segments, t) => {
			if (!groups.includes(this.tendonGroup[t])) return;
			const [r, g, b] = this.tendonRgba.subarray(t * 4, t * 4 + 3);
			const hex = (v: number) =>
				Math.round(Math.max(0, Math.min(1, v)) * 255)
					.toString(16)
					.padStart(2, "0");
			const radius = Math.max(0.5, this.tendonWidth[t] * this.pixelsPerMeter);
			segments.forEach((rec, k) => {
				const node = Layer3D.cylinder({
					id: `${prefix}${this.tendonNames[t]}:${k}`,
					label: this.tendonNames[t],
					radius,
					// One px tall, stretched to the segment by scaleY.
					height: 1,
					color: `#${hex(r)}${hex(g)}${hex(b)}`,
				});
				const anim = LayerAnimation.create();
				for (const c of [
					"x",
					"y",
					"z",
					"rotateX",
					"rotateY",
					"rotateZ",
					"scaleY",
					"opacity",
				])
					anim.signal(c as AnimatableProp, rec.signal(c));
				(node as unknown as { animate(a: LayerAnimation): unknown }).animate(
					anim,
				);
				out.push(node as LayoutNode);
			});
		});
		return out;
	}

	private geomLayer(i: number, id: string): LayoutNode | null {
		const [r, g, b, a] = this.geomRgba.subarray(i * 4, i * 4 + 4);
		const hex = (v: number) =>
			Math.round(Math.max(0, Math.min(1, v)) * 255)
				.toString(16)
				.padStart(2, "0");
		const rec = this.geomRecordings[i];
		const still = this.geomBody[i] === 0;
		if (still) {
			if (this.liveMode) {
				if (!this.run && !this.finished) this.start();
			} else this.simulate();
		}
		// World geoms do not move: their pose, once; the rest follow signals.
		const pose = still
			? Object.fromEntries(
					POSE_CHANNELS.map((c) => [c, rec.channel(c)[this.startFrame]]),
				)
			: {};
		const node = this.primitive(i, {
			id,
			label: this.bodyNames[this.geomBody[i]],
			color: `#${hex(r)}${hex(g)}${hex(b)}`,
			...(a < 1 && { opacity: a }),
			...pose,
		});
		if (!node || still) return node;
		const anim = LayerAnimation.create();
		for (const c of POSE_CHANNELS) {
			anim.signal(c as AnimatableProp, rec.signal(c));
		}
		(node as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
		return node;
	}

	/**
	 * The Layer3D primitive of a geom, in its local frame: MuJoCo's local z
	 * (capsule and cylinder axes, a plane's normal) is the scene's local -y,
	 * and its local y the scene's local z.
	 */
	private primitive(i: number, base: GeomLayerBase): LayoutNode | null {
		const ppm = this.pixelsPerMeter;
		const [s0, s1, s2] = this.geomSize.subarray(i * 3, i * 3 + 3);
		const texture = this.geomTextures[i];
		const solid = texture && this.solidGeometry(i);
		if (texture && solid)
			return this.modelLayer(
				i,
				base,
				texturedTriangles(solid, texture, [s0, s1, s2], ppm, this.geomType[i]),
				texture,
			);
		switch (this.geomType[i]) {
			case GEOM.sphere:
				return Layer3D.sphere({ ...base, radius: s0 * ppm }) as LayoutNode;
			case GEOM.ellipsoid:
				// A unit sphere scaled along its axes (MuJoCo local y is scene z).
				return Layer3D.sphere({
					...base,
					radius: ppm,
					scaleX: s0,
					scaleY: s2,
					scaleZ: s1,
				}) as LayoutNode;
			case GEOM.box:
				return Layer3D.roundedBox({
					...base,
					width: 2 * s0 * ppm,
					height: 2 * s2 * ppm,
					depth: 2 * s1 * ppm,
				}) as LayoutNode;
			case GEOM.capsule:
				return Layer3D.capsule({
					...base,
					radius: s0 * ppm,
					length: 2 * s1 * ppm,
				}) as LayoutNode;
			case GEOM.cylinder:
				return Layer3D.cylinder({
					...base,
					radius: s0 * ppm,
					height: 2 * s1 * ppm,
				}) as LayoutNode;
			case GEOM.plane: {
				// An infinite plane (size 0) draws 10 m wide.
				const half = (h: number) => (h > 0 ? h : 5);
				const side = (h: number) => 2 * half(h) * ppm;
				const texture = this.geomTextures[i];
				if (texture?.kind === "2d")
					return this.modelLayer(
						i,
						base,
						planeQuad(half(s0), half(s1), ppm, texture),
						texture,
					);
				return Layer3D.roundedBox({
					...base,
					width: side(s0),
					height: PLANE_SLAB,
					depth: side(s1),
				}) as LayoutNode;
			}
			case GEOM.mesh:
				return this.meshLayer(i, base);
			default:
				return null;
		}
	}

	/**
	 * A solid geom's triangles from the engine's primitive meshes (the ones
	 * its untextured layer draws), for texturing: the mesh, and the scale an
	 * ellipsoid stretches its unit sphere by.
	 */
	private solidGeometry(
		i: number,
	): { options: PrimitiveGeometryOptions; scale: Vec3 } | null {
		const ppm = this.pixelsPerMeter;
		const [s0, s1, s2] = this.geomSize.subarray(i * 3, i * 3 + 3);
		const one: Vec3 = [1, 1, 1];
		switch (this.geomType[i]) {
			case GEOM.sphere:
				return {
					options: { type: "sphere", radius: s0 * ppm, segments: 48 },
					scale: one,
				};
			case GEOM.ellipsoid:
				return {
					options: { type: "sphere", radius: ppm, segments: 48 },
					scale: [s0, s2, s1],
				};
			case GEOM.box:
				return {
					options: {
						type: "roundedBox",
						width: 2 * s0 * ppm,
						height: 2 * s2 * ppm,
						depth: 2 * s1 * ppm,
					},
					scale: one,
				};
			case GEOM.capsule:
				return {
					options: { type: "capsule", radius: s0 * ppm, length: 2 * s1 * ppm },
					scale: one,
				};
			case GEOM.cylinder:
				return {
					options: { type: "cylinder", radius: s0 * ppm, height: 2 * s1 * ppm },
					scale: one,
				};
			default:
				return null;
		}
	}

	/** A mesh geom as a model layer of its triangles (flat-shaded, as MuJoCo's). */
	private meshLayer(i: number, base: GeomLayerBase): LayoutNode | null {
		const mesh = this.geomMeshes[i];
		if (!mesh) return null;
		return this.modelLayer(
			i,
			base,
			mesh,
			mesh.uvs && this.geomTextures[i]?.kind === "2d"
				? this.geomTextures[i]
				: undefined,
		);
	}

	/** Unwelded triangles in the geom's frame as a model layer, maybe textured. */
	private modelLayer(
		i: number,
		base: GeomLayerBase,
		mesh: GeomMesh,
		texture: GeomTexture | undefined,
	): LayoutNode {
		const count = mesh.positions.length / 3;
		const name = `mujoco-geom-${i}`;
		const data: Mesh3DData = {
			name,
			positions: mesh.positions,
			normals: mesh.normals,
			uvs: mesh.uvs ?? new Float32Array(count * 2),
			indices: Uint32Array.from({ length: count }, (_, k) => k),
			materialName: `${name}-material`,
		};
		const [r, g, b, a] = this.geomRgba.subarray(i * 4, i * 4 + 4);
		const material: Material3D = {
			name: `${name}-material`,
			diffuseColor: [r, g, b, a],
			shading: "lit",
			...(mesh.twoSided && { twoSided: true }),
			...(texture && {
				diffuseTextureBuffer: texture.png,
				diffuseTextureMime: "image/png",
				// A cube texture's faces sit side by side: no wrapping into the next.
				textureWrap: texture.kind === "cube" ? "clamp" : "repeat",
			}),
		};
		const modelData = finalizeModel3DData(name, [data], {
			[material.name]: material,
		});
		const { color: _color, opacity, ...pose } = base;
		return Layer.model({
			...pose,
			modelData,
			is3D: true,
			opacity: opacity ?? 1,
		}) as unknown as LayoutNode;
	}
}

/** Each geom's rgba: its own, or its material's when it keeps the default. */
function geomColors(model: MjModel): Float32Array {
	const rgba = model.geom_rgba.slice();
	for (let i = 0; i < model.ngeom; i++) {
		const mat = model.geom_matid[i];
		const own = rgba.subarray(i * 4, i * 4 + 4);
		if (mat < 0 || own.some((v, k) => Math.abs(v - DEFAULT_RGBA[k]) > 1e-6))
			continue;
		own.set(model.mat_rgba.subarray(mat * 4, mat * 4 + 4));
	}
	return rgba;
}

/**
 * Mesh `id`'s triangles in its geom's frame (MuJoCo stores mesh vertices
 * there), turned to scene axes (x, -z, y) and pixels, one vertex per corner
 * with its face's normal.
 */
function meshTriangles(model: MjModel, id: number, ppm: number): GeomMesh {
	// Each property read crosses into the bindings: read the arrays once.
	const vert = model.mesh_vert;
	const face = model.mesh_face;
	const vadr = model.mesh_vertadr[id];
	const fadr = model.mesh_faceadr[id];
	const nface = model.mesh_facenum[id];
	const positions = new Float32Array(nface * 9);
	const normals = new Float32Array(nface * 9);
	const textured = model.mesh_texcoordnum[id] > 0;
	const uvs = textured ? new Float32Array(nface * 6) : undefined;
	const texcoord = textured ? model.mesh_texcoord : undefined;
	const faceTexcoord = textured ? model.mesh_facetexcoord : undefined;
	const tadr = model.mesh_texcoordadr[id];
	const corner = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (let f = 0; f < nface; f++) {
		for (let k = 0; k < 3; k++) {
			const v = (vadr + face[(fadr + f) * 3 + k]) * 3;
			corner[k * 3] = vert[v] * ppm;
			corner[k * 3 + 1] = -vert[v + 2] * ppm;
			corner[k * 3 + 2] = vert[v + 1] * ppm;
			if (uvs && texcoord && faceTexcoord) {
				const t = (tadr + faceTexcoord[(fadr + f) * 3 + k]) * 2;
				uvs[f * 6 + k * 2] = texcoord[t];
				uvs[f * 6 + k * 2 + 1] = texcoord[t + 1];
			}
		}
		positions.set(corner, f * 9);
		const n = faceNormal(corner);
		for (let k = 0; k < 3; k++) normals.set(n, f * 9 + k * 3);
	}
	return { positions, normals, ...(uvs && { uvs }) };
}

/**
 * A plane's top face (half sizes in meters) in its slab's frame: the slab's
 * center sits half its thickness below the plane, so the face is at local
 * y = -PLANE_SLAB / 2, facing up (-y). Texture coordinates repeat
 * `texrepeat` times across it, or per meter with `texuniform`.
 */
function planeQuad(
	hx: number,
	hy: number,
	ppm: number,
	texture: GeomTexture,
): GeomMesh {
	const top = -PLANE_SLAB / 2;
	const [ru, rv] = texture.repeat;
	const u = (x: number) => (texture.uniform ? x * ru : (x / hx + 1) * 0.5 * ru);
	const v = (y: number) => (texture.uniform ? y * rv : (y / hy + 1) * 0.5 * rv);
	// MuJoCo (x, y) on the plane is scene (x, z); counter-clockwise seen from above.
	const corners: Array<[number, number]> = [
		[-hx, -hy],
		[-hx, hy],
		[hx, hy],
		[-hx, -hy],
		[hx, hy],
		[hx, -hy],
	];
	const positions = new Float32Array(18);
	const normals = new Float32Array(18);
	const uvs = new Float32Array(12);
	corners.forEach(([x, y], k) => {
		positions.set([x * ppm, top, y * ppm], k * 3);
		normals.set([0, -1, 0], k * 3);
		uvs.set([u(x), v(y)], k * 2);
	});
	return { positions, normals, uvs, twoSided: true };
}

/** Scene-local (x right, y down) to MuJoCo-local (z up) axes. */
const toMujoco = (x: number, y: number, z: number): Vec3 => [x, z, -y];

/**
 * Where direction `d` (MuJoCo-local) reads a cube texture, as OpenGL
 * samples cube maps: the face of its largest component, and (s, t) on it.
 */
function cubeFace(axis: number, d: Vec3): [number, number] {
	const [x, y, z] = d;
	const m = Math.abs(d[axis >> 1]) || 1;
	const [sc, tc] = (
		[
			[-z, -y],
			[z, -y],
			[x, z],
			[x, -z],
			[x, -y],
			[-x, -y],
		] as const
	)[axis];
	return [(sc / m + 1) / 2, (tc / m + 1) / 2];
}

/** The cube face (0..5: +x, -x, +y, -y, +z, -z) a direction points into. */
function faceOf(d: Vec3): number {
	const a = d.map(Math.abs);
	const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
	return k * 2 + (d[k] < 0 ? 1 : 0);
}

/**
 * A solid geom's triangles with texture coordinates as MuJoCo maps them:
 * a 2D texture projected along the geom's local z (`texrepeat` across it,
 * or per meter with `texuniform`); a cube texture by direction, each
 * triangle reading the face it points into (a box's faces each show one).
 */
function texturedTriangles(
	solid: { options: PrimitiveGeometryOptions; scale: Vec3 },
	texture: GeomTexture,
	size: Vec3,
	ppm: number,
	type: number,
): GeomMesh {
	const meshes = getPrimitiveGeometry(solid.options).meshes;
	const [kx, ky, kz] = solid.scale;
	let count = 0;
	for (const m of meshes) count += m.indices.length;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	// Half extents along MuJoCo-local x and y, meters.
	const hx = size[0];
	const hy = type === GEOM.box || type === GEOM.ellipsoid ? size[1] : size[0];
	const [ru, rv] = texture.repeat;
	const planar = (m: Vec3): [number, number] =>
		texture.uniform
			? [m[0] * ru, m[1] * rv]
			: [(m[0] / (2 * hx) + 0.5) * ru, (m[1] / (2 * hy) + 0.5) * rv];
	let o = 0;
	const corner: Vec3[] = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	for (const mesh of meshes) {
		const { positions: p, normals: n, indices } = mesh;
		for (let t = 0; t < indices.length; t += 3) {
			for (let k = 0; k < 3; k++) {
				const v = indices[t + k] * 3;
				const x = p[v] * kx;
				const y = p[v + 1] * ky;
				const z = p[v + 2] * kz;
				corner[k] = [x, y, z];
				positions.set([x, y, z], (o + k) * 3);
				// Normals of a stretched surface scale by the inverse.
				const nx = n[v] / kx;
				const ny = n[v + 1] / ky;
				const nz = n[v + 2] / kz;
				const len = Math.hypot(nx, ny, nz) || 1;
				normals.set([nx / len, ny / len, nz / len], (o + k) * 3);
			}
			const local = corner.map(([x, y, z]) =>
				toMujoco(x / ppm, y / ppm, z / ppm),
			);
			let face = 0;
			if (texture.kind === "cube") {
				// A box face by its normal; a curved surface by where it points.
				const c: Vec3 = [0, 1, 2].map(
					(a) => (local[0][a] + local[1][a] + local[2][a]) / 3,
				) as Vec3;
				const ref =
					type === GEOM.box
						? (() => {
								const v = indices[t] * 3;
								return toMujoco(n[v], n[v + 1], n[v + 2]);
							})()
						: c;
				face = faceOf(ref);
			}
			for (let k = 0; k < 3; k++) {
				let uv: [number, number];
				if (texture.kind === "cube") {
					const [s, tt] = cubeFace(face, local[k]);
					const clamp = (v: number) => Math.min(1, Math.max(0, v));
					uv = [clamp(s), (face + clamp(tt)) / 6];
				} else uv = planar(local[k]);
				uvs.set(uv, (o + k) * 2);
			}
			o += 3;
		}
	}
	return { positions, normals, uvs };
}

/** Each geom's material's RGB texture (2D or cube), encoded once per texture. */
function geomTextures(model: MjModel): Array<GeomTexture | undefined> {
	const texid = model.mat_texid;
	const roles = model.nmat > 0 ? texid.length / model.nmat : 0;
	const pngs = new Map<number, Uint8Array>();
	const matid = model.geom_matid;
	const repeat = model.mat_texrepeat;
	const uniform = model.mat_texuniform;
	return Array.from({ length: model.ngeom }, (_, i) => {
		const mat = matid[i];
		if (mat < 0) return undefined;
		const tex = texid[mat * roles + TEXROLE_RGB];
		if (tex < 0) return undefined;
		const type = model.tex_type[tex];
		if (type !== TEX_2D && type !== TEX_CUBE) return undefined;
		let png = pngs.get(tex);
		if (!png) {
			png = texturePng(model, tex);
			pngs.set(tex, png);
		}
		return {
			kind: type === TEX_CUBE ? "cube" : "2d",
			png,
			repeat: [repeat[mat * 2], repeat[mat * 2 + 1]],
			uniform: uniform[mat] !== 0,
		};
	});
}

/** Texture `id`'s pixels (1, 3 or 4 channels, rows as MuJoCo samples them) as PNG. */
function texturePng(model: MjModel, id: number): Uint8Array {
	const width = model.tex_width[id];
	const height = model.tex_height[id];
	const channels = model.tex_nchannel[id];
	const adr = model.tex_adr[id];
	const src = model.tex_data.subarray(adr, adr + width * height * channels);
	const rgba = new Uint8Array(width * height * 4);
	for (let p = 0; p < width * height; p++) {
		const o = p * channels;
		rgba[p * 4] = src[o];
		rgba[p * 4 + 1] = channels >= 3 ? src[o + 1] : src[o];
		rgba[p * 4 + 2] = channels >= 3 ? src[o + 2] : src[o];
		rgba[p * 4 + 3] = channels === 4 ? src[o + 3] : 255;
	}
	return encodePng(rgba, width, height);
}

function faceNormal(c: number[]): [number, number, number] {
	const ux = c[3] - c[0];
	const uy = c[4] - c[1];
	const uz = c[5] - c[2];
	const vx = c[6] - c[0];
	const vy = c[7] - c[1];
	const vz = c[8] - c[2];
	const n: [number, number, number] = [
		uy * vz - uz * vy,
		uz * vx - ux * vz,
		ux * vy - uy * vx,
	];
	const len = Math.hypot(...n) || 1;
	return [n[0] / len, n[1] / len, n[2] / len];
}

/** What every geom layer gets: its id, color and (world geoms) pose. */
interface GeomLayerBase {
	id: string;
	/** Its body's name: what it is part of. */
	label: string;
	color: string;
	opacity?: number;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
}

/** Every file under `dir`, by its path relative to `dir` (forward slashes). */
async function folderFiles(dir: string): Promise<Record<string, Uint8Array>> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const files: Record<string, Uint8Array> = {};
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const full = path.join(entry.parentPath, entry.name);
		const name = path.relative(dir, full).split(path.sep).join("/");
		files[name] = new Uint8Array(await readFile(full));
	}
	return files;
}

async function modelSource(options: MujocoWorldOptions): Promise<ModelSource> {
	if (options.path && options.mjcf)
		throw new Error("Physics.mujoco: pass `path` or `mjcf`, not both.");
	if (options.path) {
		const file = path.resolve(options.path);
		return {
			entry: path.basename(file),
			files: await folderFiles(path.dirname(file)),
		};
	}
	if (options.mjcf) return { xml: options.mjcf, files: options.files ?? {} };
	throw new Error("Physics.mujoco: pass the model as `path` or `mjcf`.");
}

/** Loads MuJoCo (once) and compiles the model. */
export async function mujocoWorld(
	options: MujocoWorldOptions,
): Promise<MujocoWorld> {
	const [mj, source] = await Promise.all([loadMujoco(), modelSource(options)]);
	return new MujocoWorld(mj, options, source);
}
