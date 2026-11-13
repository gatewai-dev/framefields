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
import { clayBindingsWgsl, clayFieldWgsl } from "./field.wgsl.js";

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
${vertexWgsl}

struct ClayLit {
    display : vec3<f32>,
    hdr     : vec3<f32>,
    world   : vec3<f32>,
    normal  : vec3<f32>,
};

fn lightClay(point: ClayPoint) -> ClayLit {
    let brick = clayBricks[point.brick];
    let sample = clayField(point.local, brick, point.footprint);
    let localNormal = clayNormal(point.local, brick, clayNormalStep(point), point.footprint);
    var out : ClayLit;
    out.world = (model.modelMatrix * vec4<f32>(point.local, 1.0)).xyz;
    out.normal = normalize((model.normalMatrix * vec4<f32>(localNormal, 0.0)).xyz);
    let substrate = SubstrateParams(
        model.substrateClearcoat,
        model.substrateSubsurface,
        model.substrateSheen,
        model.substrateIridescence,
    );
    let shaded = shadeSurfaceSubstrate(out.world, out.normal, sample.rgb * model.colorTint.rgb, model.materialParams, model.pbr, model.emissive, model.toonShadow, model.toonLight, model.toonParams, substrate);
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
    let n = clayNormal(point.local, clayBricks[point.brick], clayNormalStep(point), 0.0);
    let facing = abs(dot(n, normalize(s.dir)));
    let bias = point.footprint * (1.5 + 2.5 * sqrt(max(1.0 - facing * facing, 0.0)) / max(facing, 0.15));
    let local = point.local + s.dir * (bias / dot(s.dir, s.dir));
    let clip = cam.viewProjMatrix * model.modelMatrix * vec4<f32>(local, 1.0);
    return clamp(clip.z / clip.w, 0.0, 1.0);
}
`;

interface ClayBuffers {
	ops: GPUBuffer;
	lists: GPUBuffer;
	bricks: GPUBuffer;
	grid: GPUBuffer;
}

/** Floats in `ClayUniforms`: the inverse model matrix, params, grid corner and size, grid dimensions. */
const CLAY_UNIFORM_FLOATS = 28;

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

	private fieldBuffers(field: ClayField): ClayBuffers {
		let buffers = this.buffers.get(field);
		if (!buffers) {
			buffers = {
				ops: this.upload(field.ops, "ClayOps"),
				lists: this.upload(field.lists, "ClayLists"),
				bricks: this.upload(field.bricks, "ClayBricks"),
				grid: this.upload(field.grid, "ClayGrid"),
			};
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
