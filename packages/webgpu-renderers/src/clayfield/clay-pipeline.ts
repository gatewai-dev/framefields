/**
 * Draws a clay field without triangles. The field's box is rasterized; each
 * of its pixels sends one ray through the brick grid and writes the surface
 * it finds (color, depth, normal) where a mesh's fragments would go, so
 * lights, shadows and the screen-space passes treat it as any other
 * surface. Silhouettes are antialiased from the field itself: how close a
 * ray passes sets how much of the pixel the edge covers.
 */
import { type Mat4, Matrix4Math } from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import {
	MESH_MODEL_FLOATS,
	type MeshUniformData,
	packMeshModel,
} from "../renderer3d/mesh3d-pipeline.js";
import {
	BloomPipelineVariants,
	createBasePipelines,
	type PipelineVariantBase,
} from "../renderer3d/pipeline-variants.js";
import { SHADOW_DEPTH_STENCIL } from "../renderer3d/shadow-depth.js";
import {
	cameraUniformsWgsl,
	lighting3dWgsl,
	lightsBindingsWgsl,
} from "../shaders/lighting3d.js";
import { meshStructsWgsl } from "../shaders/mesh3d.js";
import type { ClayField } from "./field.js";
import {
	clayBindingsWgsl,
	clayFieldWgsl,
	clayRayWgsl,
	clayStructsWgsl,
} from "./field.wgsl.js";

const vertexWgsl = /* wgsl */ `
struct ClayVertex {
    @builtin(position) clip : vec4<f32>,
    @location(0) local : vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> ClayVertex {
    var out : ClayVertex;
    out.local = clayBoxCorner(vertex);
    out.clip = cam.viewProjMatrix * model.modelMatrix * vec4<f32>(out.local, 1.0);
    return out;
}

// The step normals are measured over: half a pixel, inside the brick's margin.
fn clayNormalStep(point: ClayPoint) -> f32 {
    let size = clayBricks[point.brick].size;
    return clamp(0.5 * point.footprint, size * 1e-4, size * 0.05);
}
`;

const clayWgsl = (sampleCount: number) => /* wgsl */ `
${lighting3dWgsl}
${meshStructsWgsl}
@group(0) @binding(0) var<uniform> cam   : CameraUniforms;
@group(1) @binding(0) var<uniform> model : ModelUniforms;
${clayBindingsWgsl(1)}
${lightsBindingsWgsl}
${clayFieldWgsl}
${clayRayWgsl}
${vertexWgsl}

struct ClayLit {
    display : vec3<f32>,
    hdr     : vec3<f32>,
    world   : vec3<f32>,
    normal  : vec3<f32>,
};

fn lightClay(point: ClayPoint) -> ClayLit {
    let brick = clayBricks[point.brick];
    let e = clayNormalStep(point);
    var surface : ClayShading;
    // Where the cache follows the field to a twentieth of a pixel, shading
    // reads it and evaluates nothing; elsewhere it evaluates the field.
    if (clay.bake.x > 0.5 && clayCacheBlur(point.brick, brick) <= 0.05 * point.footprint) {
        surface = clayCachedShading(point.local, point.brick, max(e, 0.5 * brick.size / clay.bake.x), point.footprint);
    } else {
        surface = clayShading(point.local, brick, e, point.footprint);
    }
    var out : ClayLit;
    out.world = (model.modelMatrix * vec4<f32>(point.local, 1.0)).xyz;
    out.normal = normalize((model.normalMatrix * vec4<f32>(surface.normal, 0.0)).xyz);
    let substrate = SubstrateParams(
        model.substrateClearcoat,
        model.substrateSubsurface,
        model.substrateSheen,
        model.substrateIridescence,
    );
    let shaded = shadeSurfaceSubstrate(out.world, out.normal, surface.color * model.colorTint.rgb, model.materialParams, model.pbr, model.emissive, model.toonShadow, model.toonLight, model.toonParams, substrate);
    out.display = shaded.display;
    out.hdr = shaded.hdr;
    return out;
}

struct ClayFragment {
    color    : vec4<f32>,
    hdr      : vec4<f32>,
    geometry : vec4<f32>,
    depth    : f32,
    mask     : u32,
};

fn shadeClay(in: ClayVertex) -> ClayFragment {
    var out : ClayFragment;
    let s = claySurface(in.clip.xy, cam.screenParams.xy, cam.invViewProjMatrix, in.local);
    let solid = s.hit.cover >= 1.0;
    // A grazed silhouette alone covers part of the pixel: that many MSAA samples.
    out.mask = select((1u << u32(round(s.edge.cover * ${sampleCount}.0))) - 1u, 0xffffffffu, solid);
    if (out.mask == 0u) {
        discard;
    }
    // The normal is already taken over the pixel's footprint.
    specularFilterAlpha2 = 0.0;
    var lit : ClayLit;
    if (solid) {
        lit = lightClay(s.hit);
        if (s.edge.cover > 0.0) {
            // A nearer silhouette of the same sculpture crosses the pixel.
            let edge = lightClay(s.edge);
            lit.display = mix(lit.display, edge.display, s.edge.cover);
            lit.hdr = mix(lit.hdr, edge.hdr, s.edge.cover);
        }
    } else {
        lit = lightClay(s.edge);
    }
    let clip = cam.viewProjMatrix * vec4<f32>(lit.world, 1.0);
    out.depth = clip.z / clip.w;
    if (out.depth < 0.0 || out.depth > 1.0) {
        discard;
    }
    out.color = vec4<f32>(lit.display, 1.0);
    out.hdr = vec4<f32>(lit.hdr, 1.0);
    out.geometry = geometryPixel(dot(lit.world - cam.cameraPos.xyz, cam.cameraDir.xyz), lit.normal, model.toonParams.y);
    return out;
}

struct ClaySingle {
    @location(0) color : vec4<f32>,
    @builtin(frag_depth) depth : f32,
    @builtin(sample_mask) mask : u32,
};

struct ClayMrt {
    @location(0) color : vec4<f32>,
    @location(1) geometry : vec4<f32>,
    @builtin(frag_depth) depth : f32,
    @builtin(sample_mask) mask : u32,
};

struct ClayBloom {
    @location(0) color : vec4<f32>,
    @location(1) hdr : vec4<f32>,
    @builtin(frag_depth) depth : f32,
    @builtin(sample_mask) mask : u32,
};

struct ClayMrtBloom {
    @location(0) color : vec4<f32>,
    @location(1) geometry : vec4<f32>,
    @location(2) hdr : vec4<f32>,
    @builtin(frag_depth) depth : f32,
    @builtin(sample_mask) mask : u32,
};

@fragment
fn fs_single(in: ClayVertex) -> ClaySingle {
    let f = shadeClay(in);
    return ClaySingle(f.color, f.depth, f.mask);
}

@fragment
fn fs_mrt(in: ClayVertex) -> ClayMrt {
    let f = shadeClay(in);
    return ClayMrt(f.color, f.geometry, f.depth, f.mask);
}

@fragment
fn fs_single_bloom(in: ClayVertex) -> ClayBloom {
    let f = shadeClay(in);
    return ClayBloom(f.color, f.hdr, f.depth, f.mask);
}

@fragment
fn fs_mrt_bloom(in: ClayVertex) -> ClayMrtBloom {
    let f = shadeClay(in);
    return ClayMrtBloom(f.color, f.geometry, f.hdr, f.depth, f.mask);
}
`;

const shadowWgsl = /* wgsl */ `
${cameraUniformsWgsl}
${meshStructsWgsl}
@group(0) @binding(0) var<uniform> cam   : CameraUniforms;
@group(1) @binding(0) var<uniform> model : ModelUniforms;
${clayBindingsWgsl(1)}
${clayFieldWgsl}
${clayRayWgsl}
${vertexWgsl}

@fragment
fn fs_shadow(in: ClayVertex) -> @builtin(frag_depth) f32 {
    let s = claySurface(in.clip.xy, cam.screenParams.xy, cam.invViewProjMatrix, in.local);
    if (s.hit.cover < 1.0 && s.edge.cover < 0.5) {
        discard;
    }
    var point = s.edge;
    if (s.hit.cover >= 1.0) {
        point = s.hit;
    }
    // Depth bias along the light's ray: a texel and a half, more where the
    // surface turns away from the light (as slope-scaled bias does for meshes).
    let n = clayFacing(point.local, point.brick, clayNormalStep(point));
    let facing = abs(dot(n, normalize(s.dir)));
    let bias = point.footprint * (1.5 + 2.5 * sqrt(max(1.0 - facing * facing, 0.0)) / max(facing, 0.15));
    let local = point.local + s.dir * (bias / dot(s.dir, s.dir));
    let clip = cam.viewProjMatrix * model.modelMatrix * vec4<f32>(local, 1.0);
    return clamp(clip.z / clip.w, 0.0, 1.0);
}
`;

/**
 * Fills a field's distance cache: the field without its detail at every
 * lattice point of every brick, evaluated once by the same WGSL the rays
 * use, and how far the cache strays from the field in each brick. Rays
 * step by the cache while it shows them clear of the surface; what they
 * find at the surface still comes from the field itself.
 */
const bakeWgsl = /* wgsl */ `
${clayStructsWgsl}
@group(0) @binding(0) var<uniform> clay : ClayUniforms;
@group(0) @binding(1) var<storage, read> clayOps : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> clayLists : array<u32>;
@group(0) @binding(3) var<storage, read> clayBricks : array<ClayBrick>;
@group(0) @binding(4) var<storage, read_write> clayCache : array<f32>;
${clayFieldWgsl}

// The cache read between its lattice points, as the rays read it.
fn cachedAt(first: u32, side: u32, lo: vec3<u32>, f: vec3<f32>) -> f32 {
    let at = first + (lo.z * side + lo.y) * side + lo.x;
    let dy = side;
    let dz = side * side;
    let x00 = mix(clayCache[at], clayCache[at + 1u], f.x);
    let x10 = mix(clayCache[at + dy], clayCache[at + dy + 1u], f.x);
    let x01 = mix(clayCache[at + dz], clayCache[at + dz + 1u], f.x);
    let x11 = mix(clayCache[at + dz + dy], clayCache[at + dz + dy + 1u], f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// Per brick: how far the cache is from the field at the centers of its
// cells, edges and faces, where interpolation strays most. Stored doubled
// (the worst point need not be one of those) after the lattice values.
@compute @workgroup_size(64)
fn measure(@builtin(global_invocation_id) id: vec3<u32>) {
    let bricks = u32(clay.bake.z);
    if (id.x >= bricks) {
        return;
    }
    let cells = u32(clay.bake.x);
    let side = cells + 1u;
    let first = id.x * side * side * side;
    let brick = clayBricks[id.x];
    let h = brick.size / clay.bake.x;
    var worst = 0.0;
    // Half-cell steps: every point with an odd coordinate lies between lattice points.
    for (var k = 0u; k <= 2u * cells; k++) {
        for (var j = 0u; j <= 2u * cells; j++) {
            for (var i = 0u; i <= 2u * cells; i++) {
                let half = vec3<u32>(i, j, k);
                if (all((half & vec3<u32>(1u)) == vec3<u32>(0u))) {
                    continue;
                }
                let lo = min(half / 2u, vec3<u32>(cells - 1u));
                let f = vec3<f32>(half) * 0.5 - vec3<f32>(lo);
                let exact = clayField(brick.origin + vec3<f32>(half) * (0.5 * h), brick, 0.0).w;
                worst = max(worst, abs(exact - cachedAt(first, side, lo, f)));
            }
        }
    }
    clayCache[bricks * side * side * side + id.x] = 2.0 * worst + 1e-4 * brick.size;
}

// The color lattice: half as fine as the distances, after them and the errors.
@compute @workgroup_size(64)
fn tint(@builtin(global_invocation_id) id: vec3<u32>) {
    let bricks = u32(clay.bake.z);
    let full = u32(clay.bake.x) + 1u;
    let cells = u32(clay.bake.x) / 2u;
    let side = cells + 1u;
    let perBrick = side * side * side;
    let index = id.y * u32(clay.bake.y) + id.x;
    let brickIndex = index / perBrick;
    if (brickIndex >= bricks) {
        return;
    }
    let at = index % perBrick;
    let point = vec3<f32>(vec3<u32>(at % side, (at / side) % side, at / (side * side)));
    let brick = clayBricks[brickIndex];
    let color = clayField(brick.origin + brick.size * point / f32(cells), brick, 0.0).rgb;
    let to = bricks * (full * full * full + 1u) + index * 3u;
    clayCache[to] = color.r;
    clayCache[to + 1u] = color.g;
    clayCache[to + 2u] = color.b;
}

@compute @workgroup_size(64)
fn bake(@builtin(global_invocation_id) id: vec3<u32>) {
    let side = u32(clay.bake.x) + 1u;
    let perBrick = side * side * side;
    let index = id.y * u32(clay.bake.y) + id.x;
    let brickIndex = index / perBrick;
    if (brickIndex >= u32(clay.bake.z)) {
        return;
    }
    let at = index % perBrick;
    let point = vec3<f32>(vec3<u32>(at % side, (at / side) % side, at / (side * side)));
    let brick = clayBricks[brickIndex];
    clayCache[index] = clayField(brick.origin + brick.size * point / clay.bake.x, brick, 0.0).w;
}
`;

/** Invocations per workgroup of the bake, and most workgroups along one dispatch axis. */
const BAKE_GROUP = 64;
const BAKE_ROW_GROUPS = 32768;
/** Cells along a brick's edge in the distance cache, and the most memory a cache may take. */
const CACHE_CELLS = 16;
const CACHE_BYTES = 128 * 1024 * 1024;

/** Floats in a field's cache: per brick its distances, its error, and (colored fields) its colors. */
function cacheFloats(field: ClayField, cells: number): number {
	const colors = field.colored ? (cells / 2 + 1) ** 3 * 3 : 0;
	return field.brickCount * ((cells + 1) ** 3 + 1 + colors);
}

interface ClayBuffers {
	ops: GPUBuffer;
	lists: GPUBuffer;
	bricks: GPUBuffer;
	grid: GPUBuffer;
	cache: GPUBuffer;
	/** Cells along a brick's edge in `cache`; 0 = no cache. */
	cells: number;
}

/** Floats in `ClayUniforms`: the inverse model matrix, params, grid corner and size, grid dimensions, cache. */
const CLAY_UNIFORM_FLOATS = 32;

export class ClayPipeline {
	private layout: GPUBindGroupLayout;
	private emptyGroup: GPUBindGroup;
	private pipelineSingle: GPURenderPipeline;
	private pipelineMrt: GPURenderPipeline;
	private bloomVariants: BloomPipelineVariants;
	private pipelineShadow: GPURenderPipeline;
	private modelPool: BufferPool;
	private clayPool: BufferPool;
	private buffers = new WeakMap<ClayField, ClayBuffers>();
	private bake?: {
		pipeline: GPUComputePipeline;
		measure: GPUComputePipeline;
		tint: GPUComputePipeline;
		layout: GPUBindGroupLayout;
	};
	private modelData = new Float32Array(MESH_MODEL_FLOATS);
	private clayData = new Float32Array(CLAY_UNIFORM_FLOATS);

	constructor(
		private device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat,
		cameraLayout: GPUBindGroupLayout,
		lightsLayout: GPUBindGroupLayout,
		sampleCount: number,
	) {
		const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
		this.modelPool = new BufferPool(MESH_MODEL_FLOATS * 4, uniform);
		this.clayPool = new BufferPool(CLAY_UNIFORM_FLOATS * 4, uniform);

		const stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
		const storage = (binding: number): GPUBindGroupLayoutEntry => ({
			binding,
			visibility: stages,
			buffer: { type: "read-only-storage" },
		});
		this.layout = device.createBindGroupLayout({
			label: "ClayLayout",
			entries: [
				{ binding: 0, visibility: stages, buffer: { type: "uniform" } },
				{ binding: 1, visibility: stages, buffer: { type: "uniform" } },
				storage(2),
				storage(3),
				storage(4),
				storage(5),
				storage(6),
			],
		});
		// The lights sit in group 3 for every 3D pipeline; clay binds nothing in group 2.
		const emptyLayout = device.createBindGroupLayout({
			label: "ClayEmptyLayout",
			entries: [],
		});
		this.emptyGroup = device.createBindGroup({
			layout: emptyLayout,
			entries: [],
		});

		const module = device.createShaderModule({
			label: "clay.wgsl",
			code: clayWgsl(sampleCount),
		});
		const base: PipelineVariantBase = {
			label: "ClayPipeline",
			layout: device.createPipelineLayout({
				label: "ClayPipelineLayout",
				bindGroupLayouts: [
					cameraLayout,
					this.layout,
					emptyLayout,
					lightsLayout,
				],
			}),
			vertex: { module, entryPoint: "vs_main" },
			module,
			format,
			depthStencil: {
				format: depthFormat,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "triangle-list", cullMode: "none" },
			multisample: { count: sampleCount },
		};
		const { single, mrt } = createBasePipelines(device, base);
		this.pipelineSingle = single;
		this.pipelineMrt = mrt;
		this.bloomVariants = new BloomPipelineVariants(device, base);

		const shadowModule = device.createShaderModule({
			label: "clay-shadow.wgsl",
			code: shadowWgsl,
		});
		this.pipelineShadow = device.createRenderPipeline({
			label: "ClayPipelineShadow",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [cameraLayout, this.layout],
			}),
			vertex: { module: shadowModule, entryPoint: "vs_main" },
			fragment: { module: shadowModule, entryPoint: "fs_shadow", targets: [] },
			// The fragment writes its own biased depth.
			depthStencil: {
				format: SHADOW_DEPTH_STENCIL.format,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "triangle-list", cullMode: "none" },
		});
	}

	resetPools(): void {
		this.modelPool.reset();
		this.clayPool.reset();
	}

	private upload(
		data: ArrayBufferView | ArrayBuffer,
		label: string,
	): GPUBuffer {
		const bytes = ArrayBuffer.isView(data)
			? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			: new Uint8Array(data);
		const buffer = this.device.createBuffer({
			label,
			// Never empty: a binding needs at least one element.
			size: Math.max(48, Math.ceil(bytes.byteLength / 4) * 4),
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		this.device.queue.writeBuffer(buffer, 0, bytes);
		return buffer;
	}

	/** The finest cache that fits the memory budget and the device: cells along a brick's edge. */
	private cacheCells(field: ClayField): number {
		const limit = Math.min(
			CACHE_BYTES,
			this.device.limits.maxStorageBufferBindingSize,
		);
		for (let cells = CACHE_CELLS; cells >= 2; cells /= 2) {
			if (cacheFloats(field, cells) * 4 <= limit) return cells;
		}
		return 0;
	}

	private bakePipeline(): NonNullable<ClayPipeline["bake"]> {
		if (!this.bake) {
			const entry = (
				binding: number,
				type: GPUBufferBindingType,
			): GPUBindGroupLayoutEntry => ({
				binding,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type },
			});
			const layout = this.device.createBindGroupLayout({
				label: "ClayBakeLayout",
				entries: [
					entry(0, "uniform"),
					entry(1, "read-only-storage"),
					entry(2, "read-only-storage"),
					entry(3, "read-only-storage"),
					entry(4, "storage"),
				],
			});
			const module = this.device.createShaderModule({
				label: "clay-bake.wgsl",
				code: bakeWgsl,
			});
			const pipelineLayout = this.device.createPipelineLayout({
				bindGroupLayouts: [layout],
			});
			const stage = (entryPoint: string) =>
				this.device.createComputePipeline({
					label: `ClayBakePipeline:${entryPoint}`,
					layout: pipelineLayout,
					compute: { module, entryPoint },
				});
			this.bake = {
				pipeline: stage("bake"),
				measure: stage("measure"),
				tint: stage("tint"),
				layout,
			};
		}
		return this.bake;
	}

	/**
	 * Bakes the field's distance cache, submitted on its own so it is done
	 * before the pass being recorded runs.
	 */
	private bakeCache(
		field: ClayField,
		buffers: Omit<ClayBuffers, "cache">,
	): GPUBuffer {
		const { cells } = buffers;
		if (cells === 0 || field.brickCount === 0)
			return this.upload(new Float32Array(1), "ClayCache");
		const cache = this.device.createBuffer({
			label: "ClayCache",
			size: cacheFloats(field, cells) * 4,
			usage: GPUBufferUsage.STORAGE,
		});
		const { pipeline, measure, tint, layout } = this.bakePipeline();
		const retired: GPUBuffer[] = [];
		/** Binds the bake with a dispatch row wide enough for `points` invocations. */
		const stage = (points: number) => {
			const groups = Math.ceil(points / BAKE_GROUP);
			const row = Math.min(groups, BAKE_ROW_GROUPS);
			const uniforms = new Float32Array(CLAY_UNIFORM_FLOATS);
			uniforms[16] = field.symmetry;
			uniforms.set([cells, row * BAKE_GROUP, field.brickCount, 1], 28);
			const uniformBuffer = this.device.createBuffer({
				label: "ClayBakeUniforms",
				size: uniforms.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});
			this.device.queue.writeBuffer(uniformBuffer, 0, uniforms);
			retired.push(uniformBuffer);
			const group = this.device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: { buffer: buffers.ops } },
					{ binding: 2, resource: { buffer: buffers.lists } },
					{ binding: 3, resource: { buffer: buffers.bricks } },
					{ binding: 4, resource: { buffer: cache } },
				],
			});
			return { group, row, rows: Math.ceil(groups / row) };
		};
		const encoder = this.device.createCommandEncoder({ label: "ClayBake" });
		const pass = encoder.beginComputePass();
		const distances = stage(field.brickCount * (cells + 1) ** 3);
		pass.setBindGroup(0, distances.group);
		pass.setPipeline(pipeline);
		pass.dispatchWorkgroups(distances.row, distances.rows);
		pass.setPipeline(measure);
		pass.dispatchWorkgroups(Math.ceil(field.brickCount / BAKE_GROUP));
		if (field.colored) {
			const colors = stage(field.brickCount * (cells / 2 + 1) ** 3);
			pass.setBindGroup(0, colors.group);
			pass.setPipeline(tint);
			pass.dispatchWorkgroups(colors.row, colors.rows);
		}
		pass.end();
		this.device.queue.submit([encoder.finish()]);
		for (const buffer of retired) buffer.destroy();
		return cache;
	}

	private fieldBuffers(field: ClayField): ClayBuffers {
		let buffers = this.buffers.get(field);
		if (!buffers) {
			const data = {
				ops: this.upload(field.ops, "ClayOps"),
				lists: this.upload(field.lists, "ClayLists"),
				bricks: this.upload(field.bricks, "ClayBricks"),
				grid: this.upload(field.grid, "ClayGrid"),
				cells: this.cacheCells(field),
			};
			buffers = { ...data, cache: this.bakeCache(field, data) };
			this.buffers.set(field, buffers);
		}
		return buffers;
	}

	/**
	 * `filterDetail`: fade detail finer than a pixel. A shadow map keeps it
	 * all, so its surface is the one the camera sees up close.
	 */
	private bindGroup(
		field: ClayField,
		data: MeshUniformData,
		filterDetail: boolean,
	): GPUBindGroup {
		packMeshModel(this.modelData, data);
		const model = Array.from(data.modelMatrix) as Mat4;
		this.clayData.set(Matrix4Math.invert(model) ?? Matrix4Math.identity(), 0);
		this.clayData[16] = field.symmetry;
		this.clayData[17] = filterDetail ? 1 : 0;
		this.clayData.set([...field.min, field.brickSize, ...field.dims, 0], 20);
		const buffers = this.fieldBuffers(field);
		this.clayData.set(
			[buffers.cells, field.colored ? 1 : 0, field.brickCount, 0],
			28,
		);
		return this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{
					binding: 0,
					resource: {
						buffer: this.modelPool.getBuffer(this.device, this.modelData),
					},
				},
				{
					binding: 1,
					resource: {
						buffer: this.clayPool.getBuffer(this.device, this.clayData),
					},
				},
				{ binding: 2, resource: { buffer: buffers.ops } },
				{ binding: 3, resource: { buffer: buffers.lists } },
				{ binding: 4, resource: { buffer: buffers.bricks } },
				{ binding: 5, resource: { buffer: buffers.grid } },
				{ binding: 6, resource: { buffer: buffers.cache } },
			],
		});
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		field: ClayField,
		data: MeshUniformData,
		useMrt: boolean,
		useBloom: boolean,
	): void {
		if (field.brickCount === 0) return;
		pass.setPipeline(
			useBloom
				? this.bloomVariants.get(useMrt)
				: useMrt
					? this.pipelineMrt
					: this.pipelineSingle,
		);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, this.bindGroup(field, data, true));
		pass.setBindGroup(2, this.emptyGroup);
		pass.setBindGroup(3, lightsBindGroup);
		pass.draw(36);
	}

	/** Draws the field into a shadow map from the light camera in `cameraBindGroup`. */
	drawShadow(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		field: ClayField,
		modelMatrix: MeshUniformData["modelMatrix"],
	): void {
		if (field.brickCount === 0) return;
		pass.setPipeline(this.pipelineShadow);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, this.bindGroup(field, { modelMatrix }, false));
		pass.draw(36);
	}
}
