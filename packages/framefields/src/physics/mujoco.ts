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
	type Material3D,
	type Mesh3DData,
} from "@framefields/webgpu-renderers";
import { encodePng } from "@framefields/webgpu-renderers/gltf";
import { Layer, type LayoutNode } from "../index.js";
import { Layer3D } from "../shapes3d.js";
import type { Vec3 } from "./backend.js";
import { Recording } from "./core.js";
import { quatFromMatrix } from "./poses.js";
import { eulerFromQuat } from "./world3d.js";

// ---------------------------------------------------------------------------
// The slice of the bindings this module uses (their typings are mostly `any`).
// ---------------------------------------------------------------------------

interface MjModel {
	nbody: number;
	ngeom: number;
	nq: number;
	nu: number;
	opt: { timestep: number };
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
}

interface MjData {
	time: number;
	ncon: number;
	qpos: Float64Array;
	ctrl: Float64Array;
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

/** A geom pair that touched in a frame, by geom name (or `geom<index>`). */
export interface MujocoContact {
	geom1: string;
	geom2: string;
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
	png: Uint8Array;
	/** Material `texrepeat`. */
	repeat: [number, number];
	/** Material `texuniform`: repeat per meter instead of per surface. */
	uniform: boolean;
}

/** MuJoCo's `mjtTexture` 2D type and the RGB texture role (`mjTEXROLE_RGB`). */
const TEX_2D = 0;
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
	private readonly stateFrames: Float64Array[] = [];
	private readonly contactFrames: MujocoContact[][] = [];
	private simulated = false;
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
		} catch (error) {
			model.delete();
			throw error;
		}
		this.compiled = model;
		const length = this.startFrame + this.frames;
		this.geomRecordings = this.geomNames.map(
			() => new Recording(length, this.fps, () => this.simulate()),
		);
	}

	/**
	 * Runs the whole simulation (once; reading any signal runs it too).
	 * Each frame takes as many MuJoCo steps as fit, the model's timestep
	 * shortened so they end exactly on the frame.
	 */
	simulate(): this {
		if (this.simulated) return this;
		this.simulated = true;
		const { mj } = this;
		const model = this.compiled ?? this.compile();
		this.compiled = null;
		const data = new mj.MjData(model);
		try {
			if (this.options.qpos) {
				this.replay(model, data, this.options.qpos);
				return this;
			}
			const dt = 1 / this.fps;
			const substeps = Math.max(1, Math.round(dt / model.opt.timestep));
			model.opt.timestep = dt / substeps;
			if (this.options.initialState) {
				mj.mj_setState(
					model,
					data,
					Array.from(this.options.initialState),
					this.stateSpec,
				);
			}
			mj.mj_forward(model, data);
			for (let f = 0; f < this.frames; f++) {
				if (f > 0) this.step(model, data, f - 1, substeps);
				this.record(model, data, f);
			}
		} finally {
			data.delete();
			model.delete();
		}
		return this;
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
		this.simulate();
		return this.qposFrames[this.clamp(frame)];
	}

	/**
	 * The full integration state at a frame (relative to the start): pass it
	 * as `initialState` to branch a new run from there.
	 */
	state(frame: number): Float64Array {
		this.simulate();
		return this.stateFrames[this.clamp(frame)];
	}

	/** Geom pairs in contact at a frame (relative to the start). */
	contacts(frame: number): MujocoContact[] {
		this.simulate();
		return this.contactFrames[this.clamp(frame)];
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
		for (let s = 0; s < substeps; s++) this.mj.mj_step(model, data);
		// mj_step computes positions before it integrates: bring poses and
		// contacts up to the state it ends on (the solver's warmstart, which
		// the next step uses, is left alone).
		this.mj.mj_fwdPosition(model, data);
	}

	private record(model: MjModel, data: MjData, frame: number): void {
		this.qposFrames.push(data.qpos.slice());
		const size = this.mj.mj_stateSize(model, this.stateSpec);
		const buffer = new this.mj.DoubleBuffer(size);
		try {
			this.mj.mj_getState(model, data, buffer, this.stateSpec);
			this.stateFrames.push(buffer.GetView().slice());
		} finally {
			buffer.delete();
		}
		this.contactFrames.push(this.readContacts(data));
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
				// Before the run starts, the start pose.
				if (frame === 0) arr.fill(values[k], 0, at);
			});
		});
	}

	private readContacts(data: MjData): MujocoContact[] {
		if (data.ncon === 0) return [];
		const list = data.contact;
		try {
			const out: MujocoContact[] = [];
			for (let i = 0; i < data.ncon; i++) {
				const c = list.get(i);
				if (c)
					out.push({
						geom1: this.geomNames[c.geom1],
						geom2: this.geomNames[c.geom2],
					});
			}
			return out;
		} finally {
			list.delete();
		}
	}

	private geomLayer(i: number, id: string): LayoutNode | null {
		const [r, g, b, a] = this.geomRgba.subarray(i * 4, i * 4 + 4);
		const hex = (v: number) =>
			Math.round(Math.max(0, Math.min(1, v)) * 255)
				.toString(16)
				.padStart(2, "0");
		const rec = this.geomRecordings[i];
		const still = this.geomBody[i] === 0;
		if (still) this.simulate();
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
				if (texture)
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

	/** A mesh geom as a model layer of its triangles (flat-shaded, as MuJoCo's). */
	private meshLayer(i: number, base: GeomLayerBase): LayoutNode | null {
		const mesh = this.geomMeshes[i];
		if (!mesh) return null;
		return this.modelLayer(
			i,
			base,
			mesh,
			mesh.uvs ? this.geomTextures[i] : undefined,
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
				textureWrap: "repeat",
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

/** Each geom's material's 2D RGB texture, encoded once per texture. */
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
		if (tex < 0 || model.tex_type[tex] !== TEX_2D) return undefined;
		let png = pngs.get(tex);
		if (!png) {
			png = texturePng(model, tex);
			pngs.set(tex, png);
		}
		return {
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
