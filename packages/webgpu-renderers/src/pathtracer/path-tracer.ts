/**
 * Renders a 3D batch by path tracing instead of rasterizing it. Geometry is
 * a two-level BVH: one tree per mesh (built once, refitted when the mesh
 * deforms) under a tree over the frame's instances, rebuilt every frame. The
 * frame's textures go into one atlas, then `samples` dispatches of the
 * kernel each add one path per pixel, the denoiser filters what is left and
 * the resolve pass writes the 3D pass's color (and bloom radiance) targets.
 */
import { parseColor } from "../color.js";
import type { Mesh3DData } from "../loaders/types.js";
import { type Mat4, Matrix4Math } from "../math3d/index.js";
import type {
	DrawMesh3DOpts,
	DrawQuad3DOpts,
} from "../renderer3d/renderer3d.js";
import { type AtlasSlot, TextureAtlas } from "./atlas.js";
import { buildBinnedSahBvh, flattenBvh } from "./bvh.js";
import {
	DENOISE_PARAMS_BYTES,
	DENOISE_VEC4,
	denoiseWgsl,
} from "./denoise.wgsl.js";
import { Blas, deformPose, unitQuadMesh } from "./geometry.js";
import {
	dispatchTiles,
	type PathTraceSettings,
	PreviewBudget,
	type PreviewPlan,
} from "./quality.js";
import { RESOLVE_PARAMS_BYTES, resolveWgsl } from "./resolve.wgsl.js";
import {
	ACCUM_VEC4,
	INSTANCE_CASTS_SHADOW,
	INSTANCE_ONE_SIDED,
	INSTANCE_VEC4,
	MAT_ALPHA,
	MAT_BASE_TEX,
	MAT_EMISSIVE_TEX,
	MAT_GLASS,
	MAT_MR_TEX,
	MAT_NORMAL_TEX,
	MAT_QUAD,
	MAT_TWO_SIDED,
	MAT_UNLIT,
	MATERIAL_VEC4,
	TRACE_BACKDROP,
	TRACE_ENV_TABLE,
	TRACE_FLOOR,
	TRACE_PARAMS_BYTES,
	traceWgsl,
} from "./trace.wgsl.js";

export type PathTraceItem =
	| {
			kind: "mesh";
			mesh: Mesh3DData;
			/** Object to world. */
			matrix: Mat4;
			opts: DrawMesh3DOpts;
			texture?: GPUTexture;
	  }
	| {
			kind: "quad";
			/** The unit quad (-0.5..0.5) to world. */
			matrix: Mat4;
			opts: DrawQuad3DOpts;
			texture: GPUTexture;
	  };

/** The scene light, as Renderer3D packs it for its raster shaders. */
export interface PathTraceLighting {
	camera: GPUBuffer;
	lights: GPUBuffer;
	directLights: Float32Array;
	directLightCount: number;
	envCube: GPUTextureView;
	envSampler: GPUSampler;
	/** `buildEnvImportance` table, or null when the scene has no environment light. */
	envImportance: Float32Array | null;
	floor?: {
		y: number;
		color: [number, number, number];
		reflectivity: number;
		roughness: number;
		fadeDistance: number;
		opacity: number;
	};
}

export interface PathTraceFrame {
	width: number;
	height: number;
	items: PathTraceItem[];
	lighting: PathTraceLighting;
	settings: PathTraceSettings;
	/** Frame number: the sample sequence's seed, so a frame renders the same every time. */
	frame: number;
	/** An interactive preview spends a time budget; a render takes every sample. */
	interactive: boolean;
	/** Thin lens: aperture radius (world px) and the distance kept sharp. */
	lens?: { radius: number; focusDistance: number };
	color: GPUTextureView;
	colorFormat: GPUTextureFormat;
	/** rgba16float radiance target for bloom. */
	hdr?: GPUTextureView;
	/** The 2D picture behind the batch, which glass shows bent. */
	backdrop?: GPUTexture;
}

interface FrameInstance {
	blas: Blas;
	matrix: Mat4;
	material: number;
	flags: number;
}

/** A segment of the BLAS arena: where one tree's nodes and triangles start. */
interface ArenaEntry {
	nodeOffset: number;
	triOffset: number;
	version: number;
}

function hashFrame(frame: number): number {
	let x = (frame + 0x9e3779b9) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
	x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
	return (x ^ (x >>> 16)) >>> 0;
}

/** Display RGBA of an option color; the kernel decodes display to linear as the raster shaders do. */
function rgba(
	c:
		| readonly number[]
		| string
		| { r: number; g: number; b: number; a: number }
		| undefined,
	fallback: [number, number, number, number],
): [number, number, number, number] {
	if (c === undefined) return fallback;
	if (typeof c !== "string" && !("r" in c)) {
		return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
	}
	const p = parseColor(c);
	return [p.r, p.g, p.b, p.a];
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function emissiveLinear(opts: DrawMesh3DOpts | DrawQuad3DOpts): number[] {
	const e = opts.emissive;
	if (e === undefined || e === null) return [0, 0, 0];
	const c = Array.isArray(e) ? [...e, 1] : rgba(e as string, [0, 0, 0, 1]);
	const k = opts.emissiveIntensity ?? 1;
	return [0, 1, 2].map((i) => srgbToLinear(c[i] * (c[3] ?? 1)) * k);
}

function iridescence(
	opts: DrawMesh3DOpts | DrawQuad3DOpts,
): [number, number, number] {
	const i = opts.iridescence;
	const o = typeof i === "object" && i ? i : {};
	const intensity = typeof i === "number" ? i : i ? (o.intensity ?? 1) : 0;
	return [
		Math.max(0, Math.min(1, intensity)),
		opts.iridescenceThickness ?? o.thickness ?? 400,
		opts.iridescenceIor ?? o.ior ?? 1.3,
	];
}

/** Shading features a traced surface does not have yet, named so a scene says what it gives up. */
function unsupported(item: PathTraceItem): string | null {
	const o = item.opts;
	if (o.material === "toon" || o.toon) return "toon shading";
	if (o.matte) return "track mattes";
	if (item.kind === "quad" && item.opts.relief) return "reliefs";
	if (item.kind === "mesh") {
		const m = item.opts;
		if (m.instanceBuffer || m.instanceCount)
			return "GPU-instanced meshes (scatter, swarms, crowds)";
		if (m.audioDeform) return "audio mesh deformation";
		if (m.wind) return "wind";
		if (m.wireframe) return "wireframes";
		if (item.mesh.topology && item.mesh.topology !== "triangle-list")
			return "line and point meshes";
		if (m.triplanar || m.triplanarScale) return "triplanar textures";
	}
	return null;
}

export class PathTracer {
	private tracePipeline: GPUComputePipeline;
	private traceLayout: GPUBindGroupLayout;
	private cameraLayout: GPUBindGroupLayout;
	private traceLightsLayout: GPUBindGroupLayout;
	private prepareDenoise: GPUComputePipeline;
	private atrous: GPUComputePipeline;
	private denoiseLayout: GPUBindGroupLayout;
	private resolveLayout: GPUBindGroupLayout;
	private resolveCameraLayout: GPUBindGroupLayout;
	private resolveLightsLayout: GPUBindGroupLayout;
	private resolveModule: GPUShaderModule;
	private resolvePipelines = new Map<string, GPURenderPipeline>();
	private atlas: TextureAtlas;
	private staticBlas = new WeakMap<Mesh3DData, Blas>();
	private deformedBlas = new WeakMap<Mesh3DData, Blas[]>();
	private quadBlas: Blas;
	private arena = new Map<Blas, ArenaEntry>();
	private arenaKey = "";
	/** Nodes the frame's mesh trees take; the instance tree follows them. */
	private arenaNodes = 0;
	private blasIds = new WeakMap<Blas, number>();
	private nextBlasId = 0;
	private nodes: GPUBuffer | null = null;
	private tris: GPUBuffer | null = null;
	private buffers = new Map<string, GPUBuffer>();
	private envTable: Float32Array | null = null;
	private placeholderBackdrop: GPUTexture;
	private budget = new PreviewBudget();
	/** What the last frame traced: samples per pixel and resolution scale. */
	lastPlan: PreviewPlan | null = null;
	private timing: {
		set: GPUQuerySet;
		resolve: GPUBuffer;
		readback: GPUBuffer[];
		/** Readbacks of earlier frames; `frame` orders them against this one. */
		pending: {
			buffer: GPUBuffer;
			samples: number;
			pixels: number;
			frame: number;
		}[];
		frame: number;
	} | null = null;

	constructor(private device: GPUDevice) {
		const traceModule = device.createShaderModule({
			label: "PathTraceKernel",
			code: traceWgsl,
		});
		const C = GPUShaderStage.COMPUTE;
		const storage = (
			binding: number,
			type: GPUBufferBindingType = "read-only-storage",
		) => ({
			binding,
			visibility: C,
			buffer: { type },
		});
		this.traceLayout = device.createBindGroupLayout({
			label: "PathTraceScene",
			entries: [
				{
					binding: 0,
					visibility: C,
					buffer: { type: "uniform", hasDynamicOffset: true },
				},
				storage(1),
				storage(2),
				storage(3),
				storage(4),
				{ binding: 5, visibility: C, texture: { viewDimension: "2d-array" } },
				{ binding: 6, visibility: C, sampler: {} },
				storage(7),
				storage(8, "storage"),
				{ binding: 9, visibility: C, texture: {} },
				storage(10),
			],
		});
		this.cameraLayout = device.createBindGroupLayout({
			entries: [{ binding: 0, visibility: C, buffer: { type: "uniform" } }],
		});
		this.traceLightsLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: C, buffer: { type: "uniform" } },
				storage(3),
				{ binding: 4, visibility: C, texture: { viewDimension: "cube" } },
				{ binding: 5, visibility: C, sampler: {} },
			],
		});
		const empty = device.createBindGroupLayout({ entries: [] });
		this.tracePipeline = device.createComputePipeline({
			label: "PathTraceKernel",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					this.traceLayout,
					this.cameraLayout,
					empty,
					this.traceLightsLayout,
				],
			}),
			compute: { module: traceModule, entryPoint: "main" },
		});

		const denoiseModule = device.createShaderModule({
			label: "PathTraceDenoise",
			code: denoiseWgsl,
		});
		this.denoiseLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: C,
					buffer: { type: "uniform", hasDynamicOffset: true },
				},
				storage(1),
				storage(2),
				storage(3, "storage"),
				storage(4, "storage"),
			],
		});
		const denoisePipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.denoiseLayout],
		});
		this.prepareDenoise = device.createComputePipeline({
			layout: denoisePipelineLayout,
			compute: { module: denoiseModule, entryPoint: "prepare" },
		});
		this.atrous = device.createComputePipeline({
			layout: denoisePipelineLayout,
			compute: { module: denoiseModule, entryPoint: "atrous" },
		});

		const F = GPUShaderStage.FRAGMENT;
		this.resolveModule = device.createShaderModule({
			label: "PathTraceResolve",
			code: resolveWgsl,
		});
		this.resolveLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: F, buffer: { type: "uniform" } },
				{ binding: 1, visibility: F, buffer: { type: "read-only-storage" } },
				{ binding: 2, visibility: F, buffer: { type: "read-only-storage" } },
			],
		});
		this.resolveCameraLayout = device.createBindGroupLayout({
			entries: [{ binding: 0, visibility: F, buffer: { type: "uniform" } }],
		});
		this.resolveLightsLayout = device.createBindGroupLayout({
			entries: [{ binding: 0, visibility: F, buffer: { type: "uniform" } }],
		});

		this.atlas = new TextureAtlas(device);
		this.quadBlas = new Blas(unitQuadMesh());
		this.placeholderBackdrop = device.createTexture({
			label: "PathTraceNoBackdrop",
			size: { width: 1, height: 1 },
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});
		if (device.features.has("timestamp-query")) {
			this.timing = {
				set: device.createQuerySet({ type: "timestamp", count: 4 }),
				resolve: device.createBuffer({
					size: 32,
					usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
				}),
				readback: [],
				pending: [],
				frame: 0,
			};
		}
	}

	/** A storage buffer by name, grown (never shrunk) to hold `bytes`. */
	private buffer(
		name: string,
		bytes: number,
		usage: GPUBufferUsageFlags = GPUBufferUsage.STORAGE |
			GPUBufferUsage.COPY_DST,
	): GPUBuffer {
		const size = Math.max(16, Math.ceil(bytes / 16) * 16);
		let b = this.buffers.get(name);
		if (!b || b.size < size) {
			b?.destroy();
			b = this.device.createBuffer({ label: `PathTrace:${name}`, size, usage });
			this.buffers.set(name, b);
		}
		return b;
	}

	private upload(name: string, data: Float32Array | Uint32Array): GPUBuffer {
		const b = this.buffer(name, data.byteLength);
		this.device.queue.writeBuffer(
			b,
			0,
			data.buffer,
			data.byteOffset,
			data.byteLength,
		);
		return b;
	}

	private blasFor(
		item: PathTraceItem,
		deformedUse: Map<Mesh3DData, number>,
	): Blas {
		if (item.kind === "quad") return this.quadBlas;
		const { mesh, opts } = item;
		const skinned = opts.isSkinned && opts.skinningMatrices;
		const morphed = opts.morphWeights?.some((w) => w !== 0);
		if (!skinned && !morphed) {
			let blas = this.staticBlas.get(mesh);
			if (!blas) {
				blas = new Blas(mesh);
				this.staticBlas.set(mesh, blas);
			}
			return blas;
		}
		// Each deformed use of a mesh this frame keeps its own refitted tree.
		const k = deformedUse.get(mesh) ?? 0;
		deformedUse.set(mesh, k + 1);
		const pool = this.deformedBlas.get(mesh) ?? [];
		this.deformedBlas.set(mesh, pool);
		const pose = deformPose(
			mesh,
			opts.morphWeights,
			skinned ? opts.skinningMatrices : undefined,
		);
		if (!pool[k]) pool[k] = new Blas(mesh, pose);
		else pool[k].update(pose);
		return pool[k];
	}

	private blasId(blas: Blas): number {
		let id = this.blasIds.get(blas);
		if (id === undefined) {
			id = this.nextBlasId++;
			this.blasIds.set(blas, id);
		}
		return id;
	}

	/**
	 * Lays the frame's trees into the node and triangle buffers, re-uploading
	 * only what changed, and leaves room for `tlasNodes` instance-tree nodes
	 * after them. Returns where the instance tree starts, in nodes.
	 */
	private updateArena(trees: Blas[], tlasNodes: number): number {
		const unique = [...new Set(trees)];
		// A rebuilt tree can have another node count: its segment no longer fits.
		const key = unique
			.map((b) => `${this.blasId(b)}:${b.flat.nodeCount}`)
			.join(",");
		if (key !== this.arenaKey || !this.nodes || !this.tris) {
			this.arena.clear();
			let nodeCount = 0;
			let triCount = 0;
			for (const b of unique) {
				this.arena.set(b, {
					nodeOffset: nodeCount,
					triOffset: triCount,
					version: -1,
				});
				nodeCount += b.flat.nodeCount;
				triCount += Math.max(1, b.triangleCount);
			}
			this.arenaNodes = nodeCount;
			this.tris = this.buffer("tris", triCount * 112);
			this.arenaKey = key;
		}
		const nodes = this.buffer("nodes", (this.arenaNodes + tlasNodes) * 32);
		if (nodes !== this.nodes) {
			// A new, larger buffer holds none of the trees yet.
			this.nodes = nodes;
			for (const entry of this.arena.values()) entry.version = -1;
		}
		for (const b of unique) {
			const entry = this.arena.get(b) as ArenaEntry;
			if (entry.version === b.version) continue;
			// A refit can rebuild the tree; a rebuilt tree of the same mesh has as many nodes.
			const nodes = b.flat.nodes;
			this.device.queue.writeBuffer(
				this.nodes,
				entry.nodeOffset * 32,
				nodes.buffer,
				nodes.byteOffset,
				nodes.byteLength,
			);
			this.device.queue.writeBuffer(
				this.tris,
				entry.triOffset * 112,
				b.records.buffer,
				b.records.byteOffset,
				b.records.byteLength,
			);
			entry.version = b.version;
		}
		return this.arenaNodes;
	}

	/**
	 * Every triangle of an emissive surface, so paths can aim at them: per
	 * triangle (instance slot, triangle slot, cumulative probability, its
	 * probability), chosen in proportion to world area × emission. Unlit
	 * layers are left out: they show their picture, not a light.
	 */
	private emitterTable(
		items: PathTraceItem[],
		instances: FrameInstance[],
		order: Uint32Array,
	): { table: Float32Array; count: number; power: number } {
		const slots: number[] = [];
		const tris: number[] = [];
		const powers: number[] = [];
		order.forEach((src, slot) => {
			const item = items[src];
			if (item.opts.material === "unlit") return;
			const e = emissiveLinear(item.opts);
			const strength = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
			if (!(strength > 0)) return;
			const inst = instances[src];
			const entry = this.arena.get(inst.blas) as ArenaEntry;
			const r = inst.blas.records;
			const m = inst.matrix;
			const world = (o: number) => {
				const x = r[o];
				const y = r[o + 1];
				const z = r[o + 2];
				return [0, 1, 2].map(
					(k) => m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k],
				);
			};
			for (let t = 0; t < inst.blas.triangleCount; t++) {
				const o = t * 28;
				const [a, b, c] = [world(o), world(o + 4), world(o + 8)];
				const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
				const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
				const area =
					0.5 *
					Math.hypot(
						e1[1] * e2[2] - e1[2] * e2[1],
						e1[2] * e2[0] - e1[0] * e2[2],
						e1[0] * e2[1] - e1[1] * e2[0],
					);
				if (!(area > 0)) continue;
				slots.push(slot);
				tris.push(entry.triOffset + t);
				powers.push(area * strength);
			}
		});
		const count = slots.length;
		const table = new Float32Array(Math.max(1, count) * 4);
		const words = new Uint32Array(table.buffer);
		const power = powers.reduce((a, b) => a + b, 0);
		let cdf = 0;
		for (let i = 0; i < count; i++) {
			const p = (powers[i] as number) / power;
			cdf += p;
			words[i * 4] = slots[i] as number;
			words[i * 4 + 1] = tris[i] as number;
			table[i * 4 + 2] = i === count - 1 ? 1 : cdf;
			table[i * 4 + 3] = p;
		}
		return { table, count, power };
	}

	private materialRecord(
		item: PathTraceItem,
		slots: Map<GPUTexture, AtlasSlot>,
		out: Float32Array,
		at: number,
	): void {
		const o = item.opts;
		const words = new Uint32Array(out.buffer);
		const v = (k: number, values: number[]) =>
			out.set(values, (at * MATERIAL_VEC4 + k) * 4);
		const tint = rgba(o.colorTint, [1, 1, 1, 1]);
		const glass =
			item.kind === "mesh" &&
			(o.material === "glass" ||
				o.material === "acrylic" ||
				o.material === "frosted");
		let flags = 0;
		const opacity = (o.opacity ?? 1) * tint[3];
		v(0, [tint[0], tint[1], tint[2], opacity]);
		const metallic = o.metallic ?? (o.material === "metallic" ? 1 : 0);
		// Glass is clear unless its roughness says otherwise (a model's own, or frosted's 0.5).
		const roughness = glass
			? (o.roughness ?? (o.material === "frosted" ? 0.5 : 0))
			: (o.roughness ?? 0.5);
		const ior =
			item.kind === "mesh"
				? (item.opts.ior ?? (o.material === "acrylic" ? 1.49 : 1.5))
				: 1.5;
		v(1, [roughness, metallic, glass ? 1 : 0, ior]);
		v(2, [...emissiveLinear(o), o.material === "unlit" ? 1 : 0]);
		const sheenColor = rgba(o.sheenColor, [1, 1, 1, 1]);
		v(3, [
			Math.max(0, Math.min(1, o.clearcoat ?? 0)),
			o.clearcoatRoughness ?? 0.08,
			Math.max(0, Math.min(1, o.sheen ?? 0)),
			Math.max(0.05, Math.min(1, o.sheenRoughness ?? 0.5)),
		]);
		const [irid, iridThickness, iridIor] = iridescence(o);
		v(4, [...sheenColor.slice(0, 3).map(srgbToLinear), irid]);
		const cutoff = item.kind === "mesh" ? (item.opts.alphaCutoff ?? 0) : 0;
		v(5, [iridThickness, iridIor, cutoff, 0]);
		const wrap = item.kind === "mesh" ? item.opts.textureWrap : undefined;
		const tex = [0, wrap === "repeat" ? 1 : wrap === "mirror" ? 2 : 0, 0, 0];
		const place = (
			texture: GPUTexture | undefined,
			k: number,
			layerAt: number,
			flag: number,
		) => {
			const slot = texture && slots.get(texture);
			if (!slot) return;
			v(k, slot.rect);
			tex[layerAt] = slot.layer;
			flags |= flag;
		};
		place(item.texture, 6, 0, MAT_BASE_TEX);
		const maps = item.kind === "mesh" ? item.opts.maps : undefined;
		place(maps?.metallicRoughness, 8, 2, MAT_MR_TEX);
		place(maps?.emissive, 9, 3, MAT_EMISSIVE_TEX);
		v(7, tex);
		// vec4 13 zw: anisotropy and its rotation (xy hold the normal map's layer and scale).
		out.set(
			[
				Math.max(-1, Math.min(1, o.anisotropy ?? 0)),
				((o.anisotropyRotation ?? 0) * Math.PI) / 180,
			],
			(at * MATERIAL_VEC4 + 13) * 4 + 2,
		);
		const normal = maps?.normal && slots.get(maps.normal);
		if (normal) {
			// vec4 11 is a mesh's normal map rect, a quad's border color.
			v(11, normal.rect);
			v(13, [normal.layer, maps?.normalScale ?? 1]);
			flags |= MAT_NORMAL_TEX;
		}
		if (item.kind === "quad") {
			const q = item.opts;
			flags |= MAT_QUAD | MAT_ALPHA;
			v(10, [q.width, q.height, q.borderRadius ?? 0, q.borderWidth ?? 0]);
			v(11, rgba(q.borderColor, [0, 0, 0, 0]));
			v(12, [q.textureExtent?.[0] || 1, q.textureExtent?.[1] || 1, 0, 0]);
		}
		if (opacity < 1 || cutoff > 0) flags |= MAT_ALPHA;
		if (o.material === "unlit") flags |= MAT_UNLIT;
		if (glass) flags |= MAT_GLASS;
		if (o.twoSided) flags |= MAT_TWO_SIDED;
		words[(at * MATERIAL_VEC4 + 5) * 4 + 3] = flags;
	}

	private instanceRecord(
		inst: FrameInstance,
		entry: ArenaEntry,
		out: Float32Array,
		at: number,
	): void {
		const m = inst.matrix;
		const inv = Matrix4Math.invert(m) ?? Matrix4Math.identity();
		const base = at * INSTANCE_VEC4 * 4;
		for (let r = 0; r < 3; r++) {
			out.set([m[r], m[4 + r], m[8 + r], m[12 + r]], base + r * 4);
			out.set([inv[r], inv[4 + r], inv[8 + r], inv[12 + r]], base + 12 + r * 4);
		}
		const words = new Uint32Array(out.buffer);
		words.set(
			[entry.nodeOffset, entry.triOffset, inst.material, inst.flags],
			base + 24,
		);
	}

	/** The instances' world boxes, from each tree's root box. */
	private instanceBoxes(instances: FrameInstance[]): Float32Array {
		const boxes = new Float32Array(instances.length * 6);
		instances.forEach((inst, i) => {
			const n = inst.blas.flat.nodes;
			const min = [Infinity, Infinity, Infinity];
			const max = [-Infinity, -Infinity, -Infinity];
			for (let c = 0; c < 8; c++) {
				const p = [
					c & 1 ? n[4] : n[0],
					c & 2 ? n[5] : n[1],
					c & 4 ? n[6] : n[2],
				];
				const m = inst.matrix;
				for (let r = 0; r < 3; r++) {
					const w = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
					min[r] = Math.min(min[r], w);
					max[r] = Math.max(max[r], w);
				}
			}
			boxes.set([...min, ...max], i * 6);
		});
		return boxes;
	}

	private sceneTextures(items: PathTraceItem[]): GPUTexture[] {
		const out: GPUTexture[] = [];
		for (const item of items) {
			if (item.texture) out.push(item.texture);
			if (item.kind === "mesh") {
				const m = item.opts.maps;
				for (const t of [m?.metallicRoughness, m?.emissive, m?.normal])
					if (t) out.push(t);
			}
		}
		return out;
	}

	private resolvePipeline(
		format: GPUTextureFormat,
		hdr: boolean,
	): GPURenderPipeline {
		const key = `${format}:${hdr}`;
		let p = this.resolvePipelines.get(key);
		if (!p) {
			const empty = this.device.createBindGroupLayout({ entries: [] });
			p = this.device.createRenderPipeline({
				label: "PathTraceResolve",
				layout: this.device.createPipelineLayout({
					bindGroupLayouts: [
						this.resolveLayout,
						this.resolveCameraLayout,
						empty,
						this.resolveLightsLayout,
					],
				}),
				vertex: { module: this.resolveModule, entryPoint: "vs" },
				fragment: {
					module: this.resolveModule,
					entryPoint: hdr ? "fs_bloom" : "fs_color",
					targets: hdr ? [{ format }, { format: "rgba16float" }] : [{ format }],
				},
				primitive: { topology: "triangle-list" },
			});
			this.resolvePipelines.set(key, p);
		}
		return p;
	}

	/**
	 * Folds in finished timestamp readbacks. A readback is mapped once the
	 * frame after it starts (its own encoder has been submitted by then) and
	 * read when the map lands, so measurements lag a frame or two.
	 */
	private collectTiming(): void {
		if (!this.timing) return;
		const t = this.timing;
		t.frame++;
		t.pending = t.pending.filter((p) => {
			if (p.buffer.mapState === "unmapped" && p.frame < t.frame) {
				p.buffer.mapAsync(GPUMapMode.READ).catch(() => {});
				return true;
			}
			if (p.buffer.mapState !== "mapped") return true;
			const [a, b, c, d] = new BigUint64Array(p.buffer.getMappedRange());
			p.buffer.unmap();
			t.readback.push(p.buffer);
			this.budget.record(
				Number(b - a) / 1e6,
				Number(d - c) / 1e6,
				p.samples,
				p.pixels,
			);
			return false;
		});
	}

	/** Encodes the traced frame into `encoder`. */
	render(encoder: GPUCommandEncoder, frame: PathTraceFrame): void {
		for (const item of frame.items) {
			const missing = unsupported(item);
			if (missing) {
				throw new Error(
					`pathTrace does not trace ${missing} yet: turn it off for this scene, or leave the feature out.`,
				);
			}
		}
		const { settings } = frame;
		this.collectTiming();
		const plan = frame.interactive
			? this.budget.plan(frame.width, frame.height, settings)
			: { samples: settings.samples, scale: 1 };
		this.lastPlan = plan;
		const width = Math.max(1, Math.round(frame.width * plan.scale));
		const height = Math.max(1, Math.round(frame.height * plan.scale));

		// Geometry.
		const deformedUse = new Map<Mesh3DData, number>();
		const instances: FrameInstance[] = frame.items.map((item, i) => ({
			blas: this.blasFor(item, deformedUse),
			matrix: item.matrix,
			material: i,
			flags:
				((item.opts.castShadow ?? item.kind === "mesh")
					? INSTANCE_CASTS_SHADOW
					: 0) |
				(item.kind === "quad" && !item.opts.twoSided ? INSTANCE_ONE_SIDED : 0),
		}));
		const tlas = flattenBvh(
			buildBinnedSahBvh(this.instanceBoxes(instances), instances.length),
		);
		const tlasOffset = this.updateArena(
			instances.map((i) => i.blas),
			tlas.nodeCount,
		);
		this.device.queue.writeBuffer(
			this.nodes as GPUBuffer,
			tlasOffset * 32,
			tlas.nodes.buffer,
			tlas.nodes.byteOffset,
			tlas.nodes.byteLength,
		);
		const instanceData = new Float32Array(
			Math.max(1, instances.length) * INSTANCE_VEC4 * 4,
		);
		tlas.primOrder.forEach((src, slot) => {
			const inst = instances[src];
			this.instanceRecord(
				inst,
				this.arena.get(inst.blas) as ArenaEntry,
				instanceData,
				slot,
			);
		});

		const emitters = this.emitterTable(frame.items, instances, tlas.primOrder);

		// Textures, then the materials that point into them.
		const layerSize = Math.min(
			this.device.limits.maxTextureDimension2D,
			Math.max(2048, settings.textureSize),
		);
		const atlas = this.atlas.build(
			encoder,
			this.sceneTextures(frame.items),
			layerSize,
			settings.textureSize,
		);
		const materialData = new Float32Array(
			Math.max(1, frame.items.length) * MATERIAL_VEC4 * 4,
		);
		frame.items.forEach((item, i) => {
			this.materialRecord(item, atlas.slots, materialData, i);
		});

		const { lighting } = frame;
		if (lighting.envImportance && lighting.envImportance !== this.envTable) {
			this.upload("env", lighting.envImportance);
			this.envTable = lighting.envImportance;
		}
		if (!lighting.envImportance) this.envTable = null;
		const envBuffer = this.envTable
			? this.buffer("env", 0)
			: this.upload("env", new Float32Array(16));

		const pixels = width * height;
		const accum = this.buffer("accum", pixels * ACCUM_VEC4 * 16);
		encoder.clearBuffer(accum, 0, pixels * ACCUM_VEC4 * 16);

		// One parameter block per (sample, tile) dispatch, at 256-byte dynamic offsets.
		const tiles = dispatchTiles(width, height);
		const blocks = plan.samples * tiles.length;
		const params = new ArrayBuffer(blocks * 256);
		const seed = hashFrame(frame.frame);
		let flags = 0;
		if (lighting.envImportance) flags |= TRACE_ENV_TABLE;
		if (lighting.floor) flags |= TRACE_FLOOR;
		if (frame.backdrop) flags |= TRACE_BACKDROP;
		const floor = lighting.floor;
		for (let s = 0; s < plan.samples; s++) {
			tiles.forEach((tile, t) => {
				const o = (s * tiles.length + t) * 256;
				const u = new Uint32Array(params, o, TRACE_PARAMS_BYTES / 4);
				const f = new Float32Array(params, o, TRACE_PARAMS_BYTES / 4);
				u.set([
					width,
					height,
					tile.x,
					tile.y,
					tile.w,
					tile.h,
					s,
					seed,
					settings.bounces,
					flags,
					lighting.directLightCount,
					instances.length,
				]);
				u.set([tlasOffset, emitters.count], 24);
				f[26] = emitters.power;
				f[27] = settings.filterGlossy;
				u[28] = settings.transmissionBounces;
				f[12] = settings.clamp;
				f[13] = frame.lens?.radius ?? 0;
				f[14] = frame.lens?.focusDistance ?? 0;
				u[15] = settings.rouletteDepth;
				if (floor) {
					f.set([...floor.color, Math.max(0.03, floor.roughness)], 16);
					f.set(
						[floor.y, floor.reflectivity, floor.fadeDistance, floor.opacity],
						20,
					);
				}
			});
		}
		const paramBuffer = this.buffer(
			"params",
			params.byteLength,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.device.queue.writeBuffer(paramBuffer, 0, params);

		const scene = this.device.createBindGroup({
			layout: this.traceLayout,
			entries: [
				{
					binding: 0,
					resource: { buffer: paramBuffer, size: TRACE_PARAMS_BYTES },
				},
				{ binding: 1, resource: { buffer: this.nodes as GPUBuffer } },
				{ binding: 2, resource: { buffer: this.tris as GPUBuffer } },
				{
					binding: 3,
					resource: { buffer: this.upload("instances", instanceData) },
				},
				{
					binding: 4,
					resource: { buffer: this.upload("materials", materialData) },
				},
				{ binding: 5, resource: atlas.view },
				{ binding: 6, resource: this.atlas.filterSampler },
				{ binding: 7, resource: { buffer: envBuffer } },
				{ binding: 8, resource: { buffer: accum } },
				{
					binding: 9,
					resource: (frame.backdrop ?? this.placeholderBackdrop).createView(),
				},
				{
					binding: 10,
					resource: { buffer: this.upload("emitters", emitters.table) },
				},
			],
		});
		const camera = this.device.createBindGroup({
			layout: this.cameraLayout,
			entries: [{ binding: 0, resource: { buffer: lighting.camera } }],
		});
		const directLights = this.upload("directLights", lighting.directLights);
		const lightsGroup = this.device.createBindGroup({
			layout: this.traceLightsLayout,
			entries: [
				{ binding: 0, resource: { buffer: lighting.lights } },
				{ binding: 3, resource: { buffer: directLights } },
				{ binding: 4, resource: lighting.envCube },
				{ binding: 5, resource: lighting.envSampler },
			],
		});

		const timed = frame.interactive && this.timing;
		const pass = encoder.beginComputePass({
			label: "PathTrace",
			...(timed && {
				timestampWrites: {
					querySet: (this.timing as NonNullable<typeof this.timing>).set,
					beginningOfPassWriteIndex: 0,
					endOfPassWriteIndex: 1,
				},
			}),
		});
		pass.setPipeline(this.tracePipeline);
		pass.setBindGroup(1, camera);
		pass.setBindGroup(3, lightsGroup);
		for (let s = 0; s < plan.samples; s++) {
			tiles.forEach((tile, t) => {
				pass.setBindGroup(0, scene, [(s * tiles.length + t) * 256]);
				pass.dispatchWorkgroups(Math.ceil(tile.w / 8), Math.ceil(tile.h / 8));
			});
		}
		pass.end();

		// After tracing: the denoiser's first pass writes the post timer's start, the resolve its end.
		const post = timed
			? (this.timing as NonNullable<typeof this.timing>).set
			: null;
		const filtered = settings.denoise
			? this.denoise(encoder, accum, width, height, post)
			: accum;
		this.resolve(
			encoder,
			frame,
			accum,
			filtered,
			width,
			height,
			plan.samples,
			post,
			!settings.denoise,
		);
		if (timed) this.readTiming(encoder, plan.samples, pixels);
	}

	private readTiming(
		encoder: GPUCommandEncoder,
		samples: number,
		pixels: number,
	): void {
		const t = this.timing as NonNullable<typeof this.timing>;
		encoder.resolveQuerySet(t.set, 0, 4, t.resolve, 0);
		const buffer =
			t.readback.pop() ??
			this.device.createBuffer({
				size: 32,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			});
		encoder.copyBufferToBuffer(t.resolve, 0, buffer, 0, 32);
		t.pending.push({ buffer, samples, pixels, frame: t.frame });
	}

	/** Five à-trous passes (spacing 1..16) over the demodulated radiance; returns the filtered buffer. */
	private denoise(
		encoder: GPUCommandEncoder,
		accum: GPUBuffer,
		width: number,
		height: number,
		timing: GPUQuerySet | null,
	): GPUBuffer {
		const bytes = width * height * DENOISE_VEC4 * 16;
		const ping = this.buffer("denoiseA", bytes);
		const pong = this.buffer("denoiseB", bytes);
		const guides = this.buffer("denoiseGuides", width * height * 16);
		const steps = [1, 2, 4, 8, 16];
		const params = new Uint32Array((steps.length + 1) * 64);
		for (let i = 0; i <= steps.length; i++) {
			params.set(
				[width, height, i === 0 ? 0 : steps[i - 1], i === steps.length ? 1 : 0],
				i * 64,
			);
		}
		const paramBuffer = this.buffer(
			"denoiseParams",
			params.byteLength,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.device.queue.writeBuffer(paramBuffer, 0, params);
		const group = (src: GPUBuffer, dst: GPUBuffer) =>
			this.device.createBindGroup({
				layout: this.denoiseLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: paramBuffer, size: DENOISE_PARAMS_BYTES },
					},
					{ binding: 1, resource: { buffer: accum } },
					{ binding: 2, resource: { buffer: src } },
					{ binding: 3, resource: { buffer: dst } },
					{ binding: 4, resource: { buffer: guides } },
				],
			});
		const aToB = group(ping, pong);
		const bToA = group(pong, ping);
		// prepare reads nothing from src; it writes ping.
		const prepare = group(pong, ping);
		const pass = encoder.beginComputePass({
			label: "PathTraceDenoise",
			...(timing && {
				timestampWrites: { querySet: timing, beginningOfPassWriteIndex: 2 },
			}),
		});
		const wg = [Math.ceil(width / 8), Math.ceil(height / 8)] as const;
		pass.setPipeline(this.prepareDenoise);
		pass.setBindGroup(0, prepare, [0]);
		pass.dispatchWorkgroups(...wg);
		pass.setPipeline(this.atrous);
		let result = ping;
		steps.forEach((_, i) => {
			const forward = i % 2 === 0;
			pass.setBindGroup(0, forward ? aToB : bToA, [(i + 1) * 256]);
			pass.dispatchWorkgroups(...wg);
			result = forward ? pong : ping;
		});
		pass.end();
		return result;
	}

	private resolve(
		encoder: GPUCommandEncoder,
		frame: PathTraceFrame,
		accum: GPUBuffer,
		filtered: GPUBuffer,
		width: number,
		height: number,
		samples: number,
		timing: GPUQuerySet | null,
		/** The resolve also starts the post timer (no denoiser ran). */
		startsPost: boolean,
	): void {
		const params = this.buffer(
			"resolveParams",
			RESOLVE_PARAMS_BYTES,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.device.queue.writeBuffer(
			params,
			0,
			new Uint32Array([width, height, filtered === accum ? 0 : 1, samples]),
		);
		const hdr = Boolean(frame.hdr);
		const pipeline = this.resolvePipeline(frame.colorFormat, hdr);
		const pass = encoder.beginRenderPass({
			label: "PathTraceResolve",
			...(timing && {
				timestampWrites: {
					querySet: timing,
					...(startsPost && { beginningOfPassWriteIndex: 2 }),
					endOfPassWriteIndex: 3,
				},
			}),
			colorAttachments: [
				{
					view: frame.color,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
				...(frame.hdr
					? [
							{
								view: frame.hdr,
								loadOp: "clear" as const,
								storeOp: "store" as const,
								clearValue: { r: 0, g: 0, b: 0, a: 0 },
							},
						]
					: []),
			],
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.resolveLayout,
				entries: [
					{ binding: 0, resource: { buffer: params } },
					{ binding: 1, resource: { buffer: accum } },
					{ binding: 2, resource: { buffer: filtered } },
				],
			}),
		);
		pass.setBindGroup(
			1,
			this.device.createBindGroup({
				layout: this.resolveCameraLayout,
				entries: [{ binding: 0, resource: { buffer: frame.lighting.camera } }],
			}),
		);
		pass.setBindGroup(
			3,
			this.device.createBindGroup({
				layout: this.resolveLightsLayout,
				entries: [{ binding: 0, resource: { buffer: frame.lighting.lights } }],
			}),
		);
		pass.draw(3);
		pass.end();
	}

	destroy(): void {
		for (const b of this.buffers.values()) b.destroy();
		this.buffers.clear();
		this.atlas.destroy();
		this.placeholderBackdrop.destroy();
		this.timing?.set.destroy();
	}
}
