/**
 * Writes what a frame's 3D passes draw as one glTF 2.0 binary (GLB): every
 * mesh in its pose that frame (morphs and skins applied, clay as its
 * triangles), layer pictures on planes as textured quads, scattered and
 * swarmed instances as nodes sharing one mesh, materials with their maps,
 * the camera and the lights.
 *
 * The engine's world is in pixels with y down; glTF's is in meters with y
 * up. Positions are scaled by `metersPerPixel` and turned half a turn about
 * x (a rotation, so winding and handedness survive): an upright model in
 * the engine stands upright in the file, and the file's camera sees what
 * the frame shows.
 *
 * Attach an exporter as a frame's `scene3d` capture, render the frame, then
 * `finish()`. For an animation, call `beginFrame(seconds)` before and
 * `endFrame()` after each frame: the file then moves as the frames did.
 */
import type { Mesh3DData } from "../loaders/types.js";
import type { Camera3DPose } from "../math3d/camera3d.js";
import { Light3D, type Light3DOptions } from "../math3d/light3d.js";
import { type Mat4, Matrix4Math } from "../math3d/matrix4.js";
import { deformPose, unitQuadMesh } from "../pathtracer/geometry.js";
import { DisplayBlit } from "../renderer3d/display-blit.js";
import type { DrawMesh3DOpts } from "../renderer3d/renderer3d.js";
import type {
	Scene3DCapture,
	Scene3DItem,
	Scene3DPass,
} from "../renderer3d/scene-capture.js";
import { linearRgba } from "./color.js";
import {
	type ChannelSpec,
	GltfDocument,
	type MeshRef,
	type NodeRef,
	type NodeSpec,
	type PrimitiveSpec,
} from "./document.js";
import {
	BufferReadback,
	TextureReadback,
	unpremultiply,
} from "./gpu-readback.js";
import type { TextureRef } from "./material.js";
import { encodePng } from "./png.js";
import {
	type KeyTolerance,
	NodeMotion,
	visibilityChannel,
} from "./scene-animation.js";
import {
	displayColor,
	type SceneTextures,
	sceneMaterial,
} from "./scene-material.js";

export interface Scene3DExportOptions {
	/** Meters per world pixel. Default 0.01: 100 px is a meter. */
	metersPerPixel?: number;
	/** Write the frame's camera. Default true. */
	camera?: boolean;
	/** Write the frame's lights (KHR_lights_punctual). Default true. */
	lights?: boolean;
	/** Longest side of a written texture, px. Default 4096. */
	maxTextureSize?: number;
	/** The animation's name, when several frames are captured. Default "framefields". */
	animationName?: string;
}

export interface Scene3DExport {
	/** The GLB file. */
	glb: Uint8Array;
	/** Mesh nodes written (each instance counts). */
	meshes: number;
	/** Triangles in the file, counting each mesh once. */
	triangles: number;
	/** Animation channels written (0 for a single frame). */
	channels: number;
	/** What the frames drew that the file does not carry, and why. */
	skipped: string[];
}

type Maps = Partial<
	Record<Exclude<keyof SceneTextures, "color">, TextureReadback>
>;

interface CapturedDraw {
	name: string;
	mesh: Mesh3DData;
	/** The pose drawn this frame, when morphs or a skin moved it. */
	positions: Float32Array;
	normals: Float32Array;
	opts: Scene3DItem["opts"];
	quad: boolean;
	color?: TextureReadback;
	maps: Maps;
	/** Base color UV window, or a layer quad's used extent. */
	uvWindow?: [number, number, number, number];
	instances?: {
		data: BufferReadback;
		stride: number;
		matrices: boolean;
	};
}

/** Where a draw was in one frame: its matrix, which of its shapes, its instances. */
interface DrawSample {
	matrix: Mat4;
	variant: number;
	/** Instance-to-layer matrices (engine axes), once the frame's readback is in. */
	instances?: Mat4[];
	pending?: BufferReadback;
}

/**
 * One draw followed across the frames. A draw is the same from frame to
 * frame when its layer draws it in the same order: `owner`, then the how
 * manyth draw of that owner it is.
 */
interface DrawTrack {
	name: string;
	/** Each distinct shape it was drawn with, captured where it first appeared. */
	variants: CapturedDraw[];
	/** Mesh data seen per variant, so a reused mesh matches without hashing. */
	byMesh: Map<Mesh3DData | "quad", number>;
	/** Content hash per variant, computed when a new mesh object needs matching. */
	hashes: Array<number | undefined>;
	samples: Array<DrawSample | undefined>;
	/** Skinned or morphing: its shape is the first frame's pose. */
	deformed: boolean;
	material: string;
}

/** Floats per instance record: InstanceData, or a model + normal matrix, or InstanceData + a crowd record. */
function instanceStride(o: DrawMesh3DOpts): number {
	return o.matrixInstances || o.crowd ? 32 : 16;
}

/** GPU work that moves vertices the file cannot replay. */
function gpuDeformation(o: DrawMesh3DOpts): string | null {
	if (o.audioDeform) return "audio mesh deformation";
	if (o.wind) return "wind sway";
	if (o.crowd) return "crowd animation";
	return null;
}

function isDeformed(o: DrawMesh3DOpts): boolean {
	return Boolean(
		(o.isSkinned && o.skinningMatrices) || o.morphWeights?.some((w) => w !== 0),
	);
}

/** FNV-1a over a mesh's positions and indices: equal shapes from different mesh objects match. */
function shapeHash(mesh: Mesh3DData): number {
	let h = 0x811c9dc5;
	const mix = (words: Uint32Array) => {
		for (let i = 0; i < words.length; i++)
			h = Math.imul(h ^ words[i], 0x01000193);
	};
	const p = mesh.positions;
	mix(new Uint32Array(p.buffer, p.byteOffset, p.length));
	const idx = mesh.indices;
	if (idx.length)
		mix(
			idx instanceof Uint32Array
				? idx
				: Uint32Array.from(idx as ArrayLike<number>),
		);
	return h >>> 0;
}

/**
 * Captures what 3D passes draw and writes it as one GLB. One frame gives a
 * still scene. Several (`beginFrame` before each, `endFrame` after) give an
 * animation sampled at every frame: node motion as translation, rotation and
 * scale channels (keys an interpolation reproduces are dropped), the camera
 * and lights moving the same way, and a draw whose shape changes (a clay
 * stage, retessellated type) as one child per shape, shown in turn.
 */
export class Scene3DExporter implements Scene3DCapture {
	private readonly tracks = new Map<string, DrawTrack>();
	private readonly times: number[] = [];
	private readonly cameras: Array<Camera3DPose | undefined> = [];
	private readonly lights = new Map<
		string,
		Array<Light3DOptions | undefined>
	>();
	/** Read per frame: a pooled texture may hold another picture next frame. */
	private textures = new Map<GPUTexture, TextureReadback>();
	private occurrences = new Map<string, number>();
	private readonly skipped = new Set<string>();
	private aspect = 1;
	private blit: DisplayBlit | null = null;
	private readonly s: number;

	constructor(private readonly options: Scene3DExportOptions = {}) {
		this.s = options.metersPerPixel ?? 0.01;
		if (!(this.s > 0))
			throw new Error("Scene3DExporter: metersPerPixel must be positive");
	}

	/** Starts a frame at `time` seconds into the animation. */
	beginFrame(time: number): void {
		const last = this.times[this.times.length - 1];
		if (last !== undefined && !(time > last))
			throw new Error("Scene3DExporter: frame times must increase");
		this.times.push(time);
		this.textures = new Map();
		this.occurrences = new Map();
	}

	/** Reads the frame's instance buffers back. Call once the frame is submitted. */
	async endFrame(): Promise<void> {
		const f = this.times.length - 1;
		for (const track of this.tracks.values()) {
			const sample = track.samples[f];
			if (!sample?.pending) continue;
			const { stride, matrices } = track.variants[0].instances as NonNullable<
				CapturedDraw["instances"]
			>;
			sample.instances = instanceLocals(
				await sample.pending.read(),
				stride,
				matrices,
			);
			sample.pending = undefined;
		}
	}

	private frame(): number {
		if (!this.times.length) this.beginFrame(0);
		return this.times.length - 1;
	}

	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DPass,
	): void {
		const f = this.frame();
		if (pass.environment?.floor)
			this.skipped.add(
				"the environment's floor (an endless plane of the environment, not a mesh)",
			);
		if (!this.cameras[f]) {
			this.cameras[f] = pass.camera;
			if (f === 0) this.aspect = pass.width / pass.height;
		}
		pass.lights.forEach((light, i) => {
			const key = light.id ?? `light-${i}`;
			const frames = this.lights.get(key) ?? [];
			frames[f] ??= light;
			this.lights.set(key, frames);
		});
		pass.items.forEach((item, i) => {
			this.captureItem(device, encoder, item, i, f);
		});
	}

	private readTexture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		texture: GPUTexture | undefined,
	): TextureReadback | undefined {
		if (!texture) return undefined;
		let read = this.textures.get(texture);
		if (!read) {
			this.blit ??= new DisplayBlit(device);
			read = new TextureReadback(
				device,
				encoder,
				this.blit,
				texture,
				this.options.maxTextureSize ?? 4096,
			);
			this.textures.set(texture, read);
		}
		return read;
	}

	private captureItem(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		item: Scene3DItem,
		index: number,
		f: number,
	): void {
		if (item.kind === "text") {
			this.skipped.add(
				"text drawn on a 3D plane (its glyphs have no triangles; Layer3D.extrudedText exports)",
			);
			return;
		}
		const name = item.owner ?? `${item.kind}-${index}`;
		const nth = this.occurrences.get(name) ?? 0;
		this.occurrences.set(name, nth + 1);
		const key = `${name}\u0000${nth}`;
		const material = JSON.stringify(
			sceneMaterial(item.opts, item.kind === "quad", {}, this.s),
		);
		let track = this.tracks.get(key);
		if (!track) {
			const draw = this.captureDraw(device, encoder, item, name);
			if (!draw) return;
			track = {
				name,
				variants: [draw],
				byMesh: new Map([[item.kind === "quad" ? "quad" : item.mesh, 0]]),
				hashes: [],
				samples: [],
				deformed: item.kind === "mesh" && isDeformed(item.opts),
				material,
			};
			this.tracks.set(key, track);
			track.samples[f] = {
				matrix: item.matrix,
				variant: 0,
				pending: draw.instances?.data,
			};
			return;
		}
		if (material !== track.material)
			this.skipped.add(
				"material changes over time (color, opacity, roughness …; glTF animates transforms: written as first drawn)",
			);
		const variant = this.variant(device, encoder, item, track);
		if (variant < 0) return;
		const draw = track.variants[variant];
		track.samples[f] = {
			matrix: item.matrix,
			variant,
			pending:
				item.kind === "mesh" && draw.instances && item.opts.instanceBuffer
					? this.instanceRead(device, encoder, item.opts)
					: undefined,
		};
	}

	/** Which of the track's shapes this draw is, capturing a new one when it is none of them. */
	private variant(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		item: Scene3DItem,
		track: DrawTrack,
	): number {
		if (item.kind !== "mesh") return 0;
		if (track.deformed) {
			this.skipped.add(
				"skin and morph animation (the mesh keeps its first exported pose; its node still moves)",
			);
			return 0;
		}
		const known = track.byMesh.get(item.mesh);
		if (known !== undefined) return known;
		const hash = shapeHash(item.mesh);
		let match = track.variants.findIndex((v, k) => {
			track.hashes[k] ??= shapeHash(v.mesh);
			return track.hashes[k] === hash;
		});
		if (match < 0) {
			const draw = this.captureDraw(device, encoder, item, track.name);
			if (!draw) return -1;
			if (draw.instances)
				this.skipped.add(
					"instanced meshes that change shape (written with their first shape)",
				);
			match = draw.instances ? 0 : track.variants.push(draw) - 1;
			track.hashes[match] = hash;
		}
		track.byMesh.set(item.mesh, match);
		return match;
	}

	private instanceRead(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		opts: DrawMesh3DOpts,
	): BufferReadback | undefined {
		if (!opts.instanceBuffer || !opts.instanceCount) return undefined;
		const stride = instanceStride(opts);
		return new BufferReadback(
			device,
			encoder,
			opts.instanceBuffer,
			(opts.firstInstance ?? 0) * stride * 4,
			opts.instanceCount * stride * 4,
		);
	}

	private captureDraw(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		item: Exclude<Scene3DItem, { kind: "text" }>,
		name: string,
	): CapturedDraw | null {
		if (item.kind === "quad") {
			if ((item.opts.borderRadius ?? 0) > 0 || (item.opts.borderWidth ?? 0) > 0)
				this.skipped.add(
					"rounded corners and borders of layers on 3D planes (drawn by the shader; written square, without the border)",
				);
			const quad = unitQuadMesh();
			const extent = item.opts.textureExtent;
			return {
				name,
				mesh: quad,
				positions: quad.positions,
				normals: quad.normals,
				opts: item.opts,
				quad: true,
				color: this.readTexture(device, encoder, item.texture),
				maps: {},
				uvWindow: [0, 0, extent?.[0] || 1, extent?.[1] || 1],
			};
		}
		return this.captureMesh(device, encoder, item, name);
	}

	private captureMesh(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		item: Extract<Scene3DItem, { kind: "mesh" }>,
		name: string,
	): CapturedDraw | null {
		const { mesh, opts } = item;
		if (!mesh.positions.length) return null;
		const deformation = gpuDeformation(opts);
		if (deformation)
			this.skipped.add(`${deformation} (computed on the GPU; written at rest)`);
		const skinned = opts.isSkinned && opts.skinningMatrices;
		const pose = isDeformed(opts)
			? deformPose(
					mesh,
					opts.morphWeights,
					skinned ? opts.skinningMatrices : undefined,
				)
			: { positions: mesh.positions, normals: mesh.normals };
		const read = (t: GPUTexture | undefined) =>
			this.readTexture(device, encoder, t);
		const instances = this.instanceRead(device, encoder, opts);
		return {
			name,
			mesh,
			positions: pose.positions,
			normals: pose.normals,
			opts,
			quad: false,
			color: read(item.texture),
			maps: {
				normal: read(opts.maps?.normal),
				metallicRoughness: read(opts.maps?.metallicRoughness),
				occlusion: read(opts.maps?.occlusion),
				emissive: read(opts.maps?.emissive),
			},
			uvWindow: opts.uvRect,
			...(instances && {
				instances: {
					data: instances,
					stride: instanceStride(opts),
					matrices: Boolean(opts.matrixInstances),
				},
			}),
		};
	}

	/**
	 * The GLB of everything captured. Call after the last frame has rendered.
	 * An animation lasts `duration` seconds (default: one frame interval past
	 * the last frame): the last frame holds for its own time, as in a video,
	 * so a player looping the clip shows every frame once.
	 */
	async finish(duration?: number): Promise<Scene3DExport> {
		await this.endFrame();
		const n = this.times.length;
		const animated = n > 1;
		const last = this.times[n - 1] ?? 0;
		const end =
			duration ?? last + (last - (this.times[0] ?? 0)) / Math.max(1, n - 1);
		if (animated && !(end > last))
			throw new Error(
				"Scene3DExporter: duration must reach past the last frame",
			);
		// The closing key repeats the last frame.
		const hold = <T>(frames: ReadonlyArray<T>): T[] => {
			const out = Array.from({ length: n }, (_, f) => frames[f]);
			if (animated) out.push(out[n - 1]);
			return out;
		};
		const writer = new SceneWriter(this.s, {
			times: Float32Array.from(animated ? [...this.times, end] : this.times),
			skipped: this.skipped,
		});
		const textures = new Map<TextureReadback, TextureRef>();
		const texture = async (
			read: TextureReadback | undefined,
			color: boolean,
			opts: Scene3DItem["opts"],
		): Promise<TextureRef | undefined> => {
			if (!read) return undefined;
			let ref = textures.get(read);
			if (!ref) {
				const image = await read.read();
				if (color) unpremultiply(image);
				const mesh = opts as DrawMesh3DOpts;
				ref = writer.doc.addTexture({
					image: encodePng(image.data, image.width, image.height),
					mimeType: "image/png",
					wrap: mesh.textureWrap ?? (color ? "clamp" : "repeat"),
					filter: mesh.textureFilter ?? "linear",
				});
				textures.set(read, ref);
			}
			return ref;
		};
		const mapsOf = async (draw: CapturedDraw): Promise<SceneTextures> => ({
			color: await texture(draw.color, true, draw.opts),
			normal: await texture(draw.maps.normal, false, draw.opts),
			metallicRoughness: await texture(
				draw.maps.metallicRoughness,
				false,
				draw.opts,
			),
			occlusion: await texture(draw.maps.occlusion, false, draw.opts),
			emissive: await texture(draw.maps.emissive, true, draw.opts),
		});
		for (const track of this.tracks.values()) {
			const maps: SceneTextures[] = [];
			for (const v of track.variants) maps.push(await mapsOf(v));
			await writer.track(track.variants, maps, hold(track.samples));
		}
		if (this.options.camera !== false)
			writer.camera(hold(this.cameras), this.aspect);
		if (this.options.lights !== false)
			for (const frames of this.lights.values()) writer.light(hold(frames));
		writer.animate(this.options.animationName ?? "framefields");
		this.blit?.destroy();
		this.blit = null;
		return {
			glb: writer.doc.toGlb(),
			meshes: writer.meshNodes,
			triangles: writer.triangles,
			channels: writer.channels.length,
			skipped: [...this.skipped],
		};
	}
}

/** Engine world (px, y down, z away) to glTF (m, y up, z toward the viewer). */
function convert(m: Mat4, s: number): Mat4 {
	// K M K⁻¹ with K = diag(s, -s, -s): positions are stored as K p.
	const out = [...m] as Mat4;
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			const kr = r === 0 ? 1 : r === 3 ? 1 : -1;
			const kc = c === 0 ? 1 : c === 3 ? 1 : -1;
			out[c * 4 + r] = m[c * 4 + r] * kr * kc;
		}
	// The signs are in; K's scale moves the translation into meters.
	out[12] *= s;
	out[13] *= s;
	out[14] *= s;
	return out;
}

/** T(pos) · R(quat) · S(scale) of an InstanceData record. */
function instanceMatrix(d: Float32Array, o: number): Mat4 {
	const [x, y, z, w] = [d[o + 4], d[o + 5], d[o + 6], d[o + 7]];
	const k = d[o + 3];
	const xx = x * x;
	const yy = y * y;
	const zz = z * z;
	return [
		(1 - 2 * (yy + zz)) * k,
		2 * (x * y + z * w) * k,
		2 * (x * z - y * w) * k,
		0,
		2 * (x * y - z * w) * k,
		(1 - 2 * (xx + zz)) * k,
		2 * (y * z + x * w) * k,
		0,
		2 * (x * z + y * w) * k,
		2 * (y * z - x * w) * k,
		(1 - 2 * (xx + yy)) * k,
		0,
		d[o],
		d[o + 1],
		d[o + 2],
		1,
	];
}

/** Each instance's matrix (instance to layer, engine axes) from a frame's instance records. */
function instanceLocals(
	d: Float32Array,
	stride: number,
	matrices: boolean,
): Mat4[] {
	const out: Mat4[] = [];
	for (let o = 0; o + stride <= d.length; o += stride)
		out.push(
			matrices
				? (Array.from(d.subarray(o, o + 16)) as Mat4)
				: instanceMatrix(d, o),
		);
	return out;
}

/** Distinct instance colors written as their own materials; more fall back to the draw's. */
const MAX_INSTANCE_COLORS = 16;

/** A sheared pose (a non-uniform scale under a rotated parent) beyond this cosine loses its shear as TRS. */
const MAX_SHEAR = 1e-3;

/** What the writer needs to animate: the frame times and where to say what it dropped. */
interface Timeline {
	times: Float32Array;
	skipped: Set<string>;
}

class SceneWriter {
	readonly doc = new GltfDocument();
	readonly channels: ChannelSpec[] = [];
	meshNodes = 0;
	triangles = 0;
	/** One glTF mesh per engine mesh, pose and material. */
	private readonly meshes = new Map<Float32Array, Map<string, MeshRef>>();
	private readonly tol: KeyTolerance;

	constructor(
		private readonly s: number,
		private readonly timeline: Timeline,
	) {
		this.tol = {
			// A twentieth of a pixel, a hundredth of a degree: far below what shows.
			translation: 0.05 * s,
			rotation: (0.01 * Math.PI) / 180,
			scale: 1e-4,
		};
	}

	private get animated(): boolean {
		return this.timeline.times.length > 1;
	}

	private primitive(draw: CapturedDraw): Omit<PrimitiveSpec, "material"> {
		const { mesh, positions, normals } = draw;
		const count = positions.length / 3;
		const p = new Float32Array(positions.length);
		for (let i = 0; i < count; i++) {
			p[i * 3] = positions[i * 3] * this.s;
			p[i * 3 + 1] = -positions[i * 3 + 1] * this.s;
			p[i * 3 + 2] = -positions[i * 3 + 2] * this.s;
		}
		const topology = mesh.topology ?? "triangle-list";
		return {
			positions: p,
			...(normals.length === positions.length
				? { normals: unitNormals(normals) }
				: {}),
			...(mesh.uvs.length === count * 2
				? { uvs: windowed(mesh.uvs, draw.uvWindow) }
				: {}),
			...(mesh.colors?.length === count * 4
				? { colors: linearColors(mesh.colors) }
				: {}),
			...(mesh.indices.length ? { indices: mesh.indices } : {}),
			mode:
				topology === "line-list"
					? "lines"
					: topology === "point-list"
						? "points"
						: "triangles",
		};
	}

	private mesh(
		draw: CapturedDraw,
		maps: SceneTextures,
		tint?: [number, number, number, number],
	): MeshRef {
		const material = sceneMaterial(draw.opts, draw.quad, maps, this.s, tint);
		const key = JSON.stringify([material, draw.uvWindow]);
		const byPose =
			this.meshes.get(draw.positions) ?? new Map<string, MeshRef>();
		this.meshes.set(draw.positions, byPose);
		const found = byPose.get(key);
		if (found) return found;
		const primitive = this.primitive(draw);
		const ref = this.doc.addMesh({
			name: draw.mesh.name ?? draw.name,
			primitives: [{ ...primitive, material: this.doc.addMaterial(material) }],
		});
		if (primitive.mode === "triangles")
			this.triangles +=
				(draw.mesh.indices.length || draw.positions.length / 3) / 3;
		byPose.set(key, ref);
		return ref;
	}

	/**
	 * A node following `matrices` (glTF axes; null where it is not drawn):
	 * a fixed matrix when it holds still, else translation / rotation / scale
	 * with channels. `hide` scales it to 0 where it is absent.
	 */
	private node(
		spec: Omit<NodeSpec, "matrix" | "translation" | "rotation" | "scale">,
		matrices: ReadonlyArray<Mat4 | null>,
		hide: boolean,
	): NodeRef {
		const motion = new NodeMotion(matrices, hide);
		const first = matrices.find(Boolean) as Mat4;
		if (!this.animated || (motion.still(this.tol) && motion.shear <= MAX_SHEAR))
			return this.doc.addNode({ ...spec, matrix: first });
		if (motion.shear > MAX_SHEAR)
			this.timeline.skipped.add(
				"shear in animated transforms (a non-uniform scale under a rotation; channels carry translation, rotation and scale)",
			);
		const ref = this.doc.addNode({ ...spec, ...motion.trs });
		this.channels.push(...motion.channels(ref, this.timeline.times, this.tol));
		return ref;
	}

	/** One draw across the frames: its node, its shapes, its instances. */
	async track(
		variants: CapturedDraw[],
		maps: SceneTextures[],
		samples: ReadonlyArray<DrawSample | undefined>,
	): Promise<void> {
		const first = variants[0];
		const matrices = samples.map((sm) =>
			sm ? convert(sm.matrix, this.s) : null,
		);
		if (first.instances) {
			await this.instanced(first, maps[0], matrices, samples);
			return;
		}
		const always = samples.every(Boolean);
		if (variants.length === 1 && always) {
			this.node(
				{ name: first.name, mesh: this.mesh(first, maps[0]) },
				matrices,
				false,
			);
			this.meshNodes++;
			return;
		}
		// Shown and hidden per frame: each shape on a child, the motion on the parent.
		const children = variants.map((v, k) => {
			const ref = this.doc.addNode({
				name: `${v.name}:${k}`,
				mesh: this.mesh(v, maps[k]),
			});
			this.channels.push(
				visibilityChannel(
					ref,
					this.timeline.times,
					samples.map((sm) => sm?.variant === k),
				),
			);
			return ref;
		});
		this.meshNodes += variants.length;
		this.node({ name: first.name, children }, matrices, false);
	}

	/** Instances: a node per instance, sharing the mesh, under the layer's node. */
	private async instanced(
		draw: CapturedDraw,
		maps: SceneTextures,
		matrices: ReadonlyArray<Mat4 | null>,
		samples: ReadonlyArray<DrawSample | undefined>,
	): Promise<void> {
		const {
			data,
			stride,
			matrices: full,
		} = draw.instances as NonNullable<CapturedDraw["instances"]>;
		const d = await data.read();
		const colors = full ? null : instanceColors(d, stride, d.length / stride);
		const count = Math.max(...samples.map((sm) => sm?.instances?.length ?? 0));
		const children: NodeRef[] = [];
		for (let i = 0; i < count; i++) {
			const locals = samples.map((sm) => {
				const local = sm?.instances?.[i];
				return local ? convert(local, this.s) : null;
			});
			children.push(
				this.node(
					{
						name: `${draw.name}.${i}`,
						mesh: this.mesh(draw, maps, colors?.[i]),
					},
					locals,
					true,
				),
			);
		}
		this.meshNodes += count;
		this.node({ name: draw.name, children }, matrices, true);
	}

	/** The camera, from the first pass of every frame. */
	camera(poses: ReadonlyArray<Camera3DPose | undefined>, aspect: number): void {
		const first = poses.find(Boolean);
		if (!first) return;
		const fov = cameraFov(first);
		if (poses.some((p) => p && Math.abs(cameraFov(p) - fov) > 1e-3))
			this.timeline.skipped.add(
				"camera zoom and field-of-view changes (glTF animates the camera's transform: written as first drawn)",
			);
		this.node(
			{
				name: "Camera",
				camera: this.doc.addCamera({
					name: "Camera",
					fov,
					aspectRatio: aspect,
					near: first.near * this.s,
					far: first.far * this.s,
				}),
			},
			poses.map((p) => (p ? cameraMatrix(p, this.s) : null)),
			false,
		);
	}

	/** A light across the frames, or the reason it is not written. */
	light(frames: ReadonlyArray<Light3DOptions | undefined>): void {
		const options = frames.find(Boolean) as Light3DOptions;
		const kind = options.lightType ?? options.type ?? "directional";
		if (kind === "ambient") return;
		if (kind === "rect") {
			this.timeline.skipped.add("rect lights (glTF has no area light)");
			return;
		}
		const processed = frames.map((o) => (o ? Light3D.processLight(o) : null));
		const l = processed.find(Boolean) as ReturnType<
			typeof Light3D.processLight
		>;
		const [r, g, b, intensity] = l.colorIntensity;
		const sameLight = (p: typeof l | null) =>
			!p ||
			p.colorIntensity.every(
				(v, i) => Math.abs(v - l.colorIntensity[i]) < 1e-4,
			);
		if (!processed.every(sameLight))
			this.timeline.skipped.add(
				"light color and intensity changes (glTF animates the light's transform: written as first drawn)",
			);
		if (frames.some((o) => !o))
			this.timeline.skipped.add(
				"lights that switch on or off during the animation (written on throughout)",
			);
		const outer = (Math.acos(l.spotParams[0]) * 180) / Math.PI;
		const inner = (Math.acos(l.spotParams[1]) * 180) / Math.PI;
		const type =
			kind === "point" ? "point" : kind === "spot" ? "spot" : "directional";
		const light = this.doc.addLight({
			name: options.id,
			type,
			// The engine's light colors are linear; the writer takes display colors.
			color: [linearToDisplay(r), linearToDisplay(g), linearToDisplay(b)],
			// Intensities are the engine's: a directional 1 lights like 1 W/m², which
			// DCC importers read back from 683 lux.
			intensity: intensity * 683,
			...(type === "spot"
				? {
						outerConeAngle: Math.min(90, outer),
						innerConeAngle: Math.min(inner, Math.min(90, outer) - 0.01),
					}
				: {}),
			...(type !== "directional" ? { range: l.dirRadius[3] * this.s } : {}),
		});
		this.node(
			{ name: options.id ?? `${type} light`, light },
			processed.map((p) => (p ? lightMatrix(p, this.s) : null)),
			false,
		);
	}

	/** Writes the channels gathered, as one animation. */
	animate(name: string): void {
		if (this.channels.length)
			this.doc.addAnimation({ name, channels: this.channels });
	}
}

/** Vertical field of view in degrees, with the camera's zoom applied. */
function cameraFov(pose: Camera3DPose): number {
	const zoom = pose.zoom > 0 ? pose.zoom : 1;
	return (
		(2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) / zoom) * 180) / Math.PI
	);
}

/** The camera node's matrix in glTF axes: it looks down its -Z. */
function cameraMatrix(pose: Camera3DPose, s: number): Mat4 {
	const view = Matrix4Math.lookAt(pose.eye, pose.target, pose.up);
	// The view's rows are the camera's right, up and forward in the world.
	const flip = (v: number[]) => [v[0], -v[1], -v[2]];
	const r = flip([view[0], view[4], view[8]]);
	const u = flip([view[1], view[5], view[9]]);
	const f = flip([view[2], view[6], view[10]]);
	const e = pose.eye;
	return [
		...r,
		0,
		...u,
		0,
		-f[0],
		-f[1],
		-f[2],
		0,
		e[0] * s,
		-e[1] * s,
		-e[2] * s,
		1,
	] as Mat4;
}

/** A light node's matrix in glTF axes: at its position, its -Z along its direction. */
function lightMatrix(
	l: ReturnType<typeof Light3D.processLight>,
	s: number,
): Mat4 {
	const dir = [l.dirRadius[0], -l.dirRadius[1], -l.dirRadius[2]];
	return aimNegativeZ(dir, [
		l.posType[0] * s,
		-l.posType[1] * s,
		-l.posType[2] * s,
	]) as Mat4;
}

function linearToDisplay(c: number): number {
	const v = Math.max(0, Math.min(1, c));
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** A node matrix at `at` whose -Z points along `dir`. */
function aimNegativeZ(dir: number[], at: number[]): number[] {
	const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
	const z = [-dir[0] / len, -dir[1] / len, -dir[2] / len];
	const hint = Math.abs(z[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
	const x = normalize(cross(hint, z));
	const y = cross(z, x);
	return [...x, 0, ...y, 0, ...z, 0, at[0], at[1], at[2], 1];
}

const cross = (a: number[], b: number[]) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: number[]) => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};

/** Unit normals in glTF axes (glTF requires unit length; a zero normal faces the viewer). */
function unitNormals(n: Float32Array): Float32Array {
	const out = new Float32Array(n.length);
	for (let i = 0; i < n.length; i += 3) {
		const x = n[i];
		const y = -n[i + 1];
		const z = -n[i + 2];
		const l = Math.hypot(x, y, z);
		if (Number.isFinite(l) && l > 1e-8) {
			out[i] = x / l;
			out[i + 1] = y / l;
			out[i + 2] = z / l;
		} else out[i + 2] = 1;
	}
	return out;
}

/** UVs mapped into `window` [x, y, width, height] of their texture. */
function windowed(
	uvs: Float32Array,
	window: [number, number, number, number] | undefined,
): Float32Array {
	if (!window) return uvs;
	const [x, y, w, h] = window;
	const out = new Float32Array(uvs.length);
	for (let i = 0; i < uvs.length; i += 2) {
		out[i] = x + uvs[i] * w;
		out[i + 1] = y + uvs[i + 1] * h;
	}
	return out;
}

/** Vertex colors are display RGBA; glTF's COLOR_0 is linear. */
function linearColors(c: Float32Array): Float32Array {
	const out = new Float32Array(c.length);
	for (let i = 0; i < c.length; i += 4) {
		const l = linearRgba([
			Math.max(0, Math.min(1, c[i])),
			Math.max(0, Math.min(1, c[i + 1])),
			Math.max(0, Math.min(1, c[i + 2])),
			Math.max(0, Math.min(1, c[i + 3])),
		]);
		out.set(l, i);
	}
	return out;
}

/** Each instance's color multiplier, or null when there are too many distinct ones to write. */
function instanceColors(
	d: Float32Array,
	stride: number,
	count: number,
): Array<[number, number, number, number] | undefined> | null {
	const distinct = new Set<string>();
	const out: Array<[number, number, number, number] | undefined> = [];
	for (let i = 0; i < count; i++) {
		const o = i * stride + 8;
		const c = displayColor([d[o], d[o + 1], d[o + 2], d[o + 3]], [1, 1, 1, 1]);
		const q = c.map(
			(v) => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255,
		) as [number, number, number, number];
		const white = q.every((v) => v === 1);
		out.push(white ? undefined : q);
		if (!white) distinct.add(q.join());
	}
	return distinct.size > MAX_INSTANCE_COLORS ? null : out;
}
