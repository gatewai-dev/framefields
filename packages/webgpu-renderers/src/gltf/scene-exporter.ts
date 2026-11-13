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
 * `finish()`.
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
	GltfDocument,
	type MeshRef,
	type NodeRef,
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
}

export interface Scene3DExport {
	/** The GLB file. */
	glb: Uint8Array;
	/** Mesh nodes written (each instance counts). */
	meshes: number;
	/** Triangles in the file, counting each mesh once. */
	triangles: number;
	/** What the frame drew that the file does not carry, and why. */
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
	matrix: Mat4;
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
		count: number;
	};
}

interface CapturedPass {
	camera: Camera3DPose;
	lights: Light3DOptions[];
	width: number;
	height: number;
	draws: CapturedDraw[];
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

export class Scene3DExporter implements Scene3DCapture {
	private readonly passes: CapturedPass[] = [];
	private readonly textures = new Map<GPUTexture, TextureReadback>();
	private readonly skipped = new Set<string>();
	private blit: DisplayBlit | null = null;
	private readonly s: number;

	constructor(private readonly options: Scene3DExportOptions = {}) {
		this.s = options.metersPerPixel ?? 0.01;
		if (!(this.s > 0))
			throw new Error("Scene3DExporter: metersPerPixel must be positive");
	}

	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DPass,
	): void {
		this.blit ??= new DisplayBlit(device);
		if (pass.environment?.floor)
			this.skipped.add(
				"the environment's floor (an endless plane of the environment, not a mesh)",
			);
		const draws: CapturedDraw[] = [];
		pass.items.forEach((item, i) => {
			const draw = this.captureItem(device, encoder, item, i);
			if (draw) draws.push(draw);
		});
		this.passes.push({
			camera: pass.camera,
			lights: pass.lights,
			width: pass.width,
			height: pass.height,
			draws,
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
			read = new TextureReadback(
				device,
				encoder,
				this.blit as DisplayBlit,
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
	): CapturedDraw | null {
		const name = item.owner ?? `${item.kind}-${index}`;
		if (item.kind === "text") {
			this.skipped.add(
				"text drawn on a 3D plane (its glyphs have no triangles; Layer3D.extrudedText exports)",
			);
			return null;
		}
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
				matrix: item.matrix,
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
		const pose =
			skinned || opts.morphWeights?.some((w) => w !== 0)
				? deformPose(
						mesh,
						opts.morphWeights,
						skinned ? opts.skinningMatrices : undefined,
					)
				: { positions: mesh.positions, normals: mesh.normals };
		const read = (t: GPUTexture | undefined) =>
			this.readTexture(device, encoder, t);
		const draw: CapturedDraw = {
			name,
			mesh,
			positions: pose.positions,
			normals: pose.normals,
			matrix: item.matrix,
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
		};
		if (opts.instanceBuffer && opts.instanceCount) {
			const stride = instanceStride(opts);
			const first = opts.firstInstance ?? 0;
			draw.instances = {
				data: new BufferReadback(
					device,
					encoder,
					opts.instanceBuffer,
					first * stride * 4,
					opts.instanceCount * stride * 4,
				),
				stride,
				matrices: Boolean(opts.matrixInstances),
				count: opts.instanceCount,
			};
		}
		return draw;
	}

	/** The GLB of everything captured. Call after the frame has rendered. */
	async finish(): Promise<Scene3DExport> {
		const writer = new SceneWriter(this.s);
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
		for (const pass of this.passes) {
			for (const draw of pass.draws) {
				const maps: SceneTextures = {
					color: await texture(draw.color, true, draw.opts),
					normal: await texture(draw.maps.normal, false, draw.opts),
					metallicRoughness: await texture(
						draw.maps.metallicRoughness,
						false,
						draw.opts,
					),
					occlusion: await texture(draw.maps.occlusion, false, draw.opts),
					emissive: await texture(draw.maps.emissive, true, draw.opts),
				};
				await writer.draw(draw, maps);
			}
		}
		const first = this.passes[0];
		if (first && this.options.camera !== false)
			writer.camera(first.camera, first.width / first.height);
		if (this.options.lights !== false) {
			const seen = new Set<Light3DOptions>();
			for (const pass of this.passes)
				for (const light of pass.lights) {
					if (seen.has(light)) continue;
					seen.add(light);
					const skipped = writer.light(light);
					if (skipped) this.skipped.add(skipped);
				}
		}
		this.blit?.destroy();
		this.blit = null;
		return {
			glb: writer.doc.toGlb(),
			meshes: writer.meshNodes,
			triangles: writer.triangles,
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

/** Distinct instance colors written as their own materials; more fall back to the draw's. */
const MAX_INSTANCE_COLORS = 16;

class SceneWriter {
	readonly doc = new GltfDocument();
	meshNodes = 0;
	triangles = 0;
	/** One glTF mesh per engine mesh, pose and material. */
	private readonly meshes = new Map<Float32Array, Map<string, MeshRef>>();

	constructor(private readonly s: number) {}

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

	async draw(draw: CapturedDraw, maps: SceneTextures): Promise<void> {
		const matrix = convert(draw.matrix, this.s);
		if (!draw.instances) {
			this.doc.addNode({
				name: draw.name,
				mesh: this.mesh(draw, maps),
				matrix,
			});
			this.meshNodes++;
			return;
		}
		const { data, stride, matrices, count } = draw.instances;
		const d = await data.read();
		const colors = matrices ? null : instanceColors(d, stride, count);
		const children: NodeRef[] = [];
		for (let i = 0; i < count; i++) {
			const o = i * stride;
			const local = matrices
				? (Array.from(d.subarray(o, o + 16)) as Mat4)
				: instanceMatrix(d, o);
			const tint = colors?.[i];
			children.push(
				this.doc.addNode({
					name: `${draw.name}.${i}`,
					mesh: this.mesh(draw, maps, tint),
					matrix: convert(local, this.s),
				}),
			);
		}
		this.meshNodes += count;
		this.doc.addNode({ name: draw.name, matrix, children });
	}

	camera(pose: Camera3DPose, aspect: number): void {
		const view = Matrix4Math.lookAt(pose.eye, pose.target, pose.up);
		// The view's rows are the camera's right, up and forward in the world.
		const right = [view[0], view[4], view[8]];
		const up = [view[1], view[5], view[9]];
		const forward = [view[2], view[6], view[10]];
		const flip = (v: number[]) => [v[0], -v[1], -v[2]];
		const [r, u, f] = [flip(right), flip(up), flip(forward)];
		const e = pose.eye;
		const zoom = pose.zoom > 0 ? pose.zoom : 1;
		const fov =
			(2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) / zoom) * 180) /
			Math.PI;
		this.doc.addNode({
			name: "Camera",
			camera: this.doc.addCamera({
				name: "Camera",
				fov,
				aspectRatio: aspect,
				near: pose.near * this.s,
				far: pose.far * this.s,
			}),
			matrix: [
				...r,
				0,
				...u,
				0,
				-f[0],
				-f[1],
				-f[2],
				0,
				e[0] * this.s,
				-e[1] * this.s,
				-e[2] * this.s,
				1,
			],
		});
	}

	/** Writes a light, or says why it cannot. */
	light(options: Light3DOptions): string | null {
		const kind = options.lightType ?? options.type ?? "directional";
		if (kind === "ambient") return null;
		if (kind === "rect") return "rect lights (glTF has no area light)";
		const l = Light3D.processLight(options);
		const [r, g, b, intensity] = l.colorIntensity;
		const position = l.posType.slice(0, 3);
		const dir = [l.dirRadius[0], -l.dirRadius[1], -l.dirRadius[2]];
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
		this.doc.addNode({
			name: options.id ?? `${type} light`,
			light,
			matrix: aimNegativeZ(dir, [
				position[0] * this.s,
				-position[1] * this.s,
				-position[2] * this.s,
			]),
		});
		return null;
	}
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
