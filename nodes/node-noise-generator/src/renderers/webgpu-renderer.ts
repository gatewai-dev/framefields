/// <reference types="webgpu" />
import type { SignalData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { signalRegistry } from "@gitframes/webgpu-renderers";

interface NoiseOp {
	op: "NoiseGenerator";
	noiseType?: "Perlin" | "Simplex" | "Voronoi";
	outputType?: "Image" | "Video";
	width?: number;
	height?: number;
	scale?: number;
	octaves?: number;
	persistence?: number;
	lacunarity?: number;
	speed?: number;
	colorStart?: string;
	colorEnd?: string;
	durationMs?: number;
	fps?: number;

	scaleHandleId?: string | null;
	octavesHandleId?: string | null;
	persistenceHandleId?: string | null;
	lacunarityHandleId?: string | null;
	speedHandleId?: string | null;

	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: {
				type: string;
				data: unknown;
			} | null;
		}
	>;
}

type NoiseSignalData = SignalData & { nodeId?: string };

const NOISE_SHADER = `
struct NoiseUniforms {
    noiseType             : f32, // 0 = Perlin, 1 = Simplex, 2 = Voronoi
    outputType            : f32, // 0 = Image, 1 = Video
    time                  : f32,
    _padding              : f32,
    
    scale                 : f32,
    octaves               : f32,
    persistence           : f32,
    lacunarity            : f32,
    
    speed                 : f32,
    hasSignal_scale       : f32,
    hasSignal_octaves     : f32,
    hasSignal_persistence : f32,
    
    hasSignal_lacunarity  : f32,
    hasSignal_speed       : f32,
    _pad2                 : f32,
    _pad3                 : f32,

    colorStart            : vec4<f32>,
    colorEnd              : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : NoiseUniforms;

@group(1) @binding(0) var scaleTex       : texture_2d<f32>;
@group(1) @binding(1) var octavesTex     : texture_2d<f32>;
@group(1) @binding(2) var persistenceTex : texture_2d<f32>;
@group(1) @binding(3) var lacunarityTex  : texture_2d<f32>;
@group(1) @binding(4) var speedTex       : texture_2d<f32>;
@group(1) @binding(5) var sigSamp        : sampler;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

fn hash3(p: vec3<f32>) -> vec3<f32> {
    var p3 = fract(p * vec3<f32>(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.xxy + p3.yzz) * p3.zyx) * 2.0 - 1.0;
}

fn perlin3d(p: vec3<f32>) -> f32 {
    let pi = floor(p);
    let pf = fract(p);
    
    let w = pf * pf * (3.0 - 2.0 * pf);
    
    let g000 = hash3(pi + vec3<f32>(0.0, 0.0, 0.0));
    let g100 = hash3(pi + vec3<f32>(1.0, 0.0, 0.0));
    let g010 = hash3(pi + vec3<f32>(0.0, 1.0, 0.0));
    let g110 = hash3(pi + vec3<f32>(1.0, 1.0, 0.0));
    let g001 = hash3(pi + vec3<f32>(0.0, 0.0, 1.0));
    let g101 = hash3(pi + vec3<f32>(1.0, 0.0, 1.0));
    let g011 = hash3(pi + vec3<f32>(0.0, 1.0, 1.0));
    let g111 = hash3(pi + vec3<f32>(1.0, 1.0, 1.0));
    
    let n000 = dot(g000, pf - vec3<f32>(0.0, 0.0, 0.0));
    let n100 = dot(g100, pf - vec3<f32>(1.0, 0.0, 0.0));
    let n010 = dot(g010, pf - vec3<f32>(0.0, 1.0, 0.0));
    let n110 = dot(g110, pf - vec3<f32>(1.0, 1.0, 0.0));
    let n001 = dot(g001, pf - vec3<f32>(0.0, 0.0, 1.0));
    let n101 = dot(g101, pf - vec3<f32>(1.0, 0.0, 1.0));
    let n011 = dot(g011, pf - vec3<f32>(0.0, 1.0, 1.0));
    let n111 = dot(g111, pf - vec3<f32>(1.0, 1.0, 1.0));
    
    let n_x00 = mix(n000, n100, w.x);
    let n_x10 = mix(n010, n110, w.x);
    let n_y0 = mix(n_x00, n_x10, w.y);
    
    let n_x01 = mix(n001, n101, w.x);
    let n_x11 = mix(n011, n111, w.x);
    let n_y1 = mix(n_x01, n_x11, w.y);
    
    return mix(n_y0, n_y1, w.z) * 0.5 + 0.5; // Map to [0, 1]
}

fn simplex3d(v: vec3<f32>) -> f32 {
    let skew = (v.x + v.y + v.z) * (1.0 / 3.0);
    let i = floor(v + skew);
    let unskew = (i.x + i.y + i.z) * (1.0 / 6.0);
    let x0 = v - i + unskew;
    
    var i1 = vec3<f32>(0.0);
    var i2 = vec3<f32>(0.0);
    
    if (x0.x >= x0.y) {
        if (x0.y >= x0.z) {
            i1 = vec3<f32>(1.0, 0.0, 0.0);
            i2 = vec3<f32>(1.0, 1.0, 0.0);
        } else if (x0.x >= x0.z) {
            i1 = vec3<f32>(1.0, 0.0, 0.0);
            i2 = vec3<f32>(1.0, 0.0, 1.0);
        } else {
            i1 = vec3<f32>(0.0, 0.0, 1.0);
            i2 = vec3<f32>(1.0, 0.0, 1.0);
        }
    } else {
        if (x0.y < x0.z) {
            i1 = vec3<f32>(0.0, 0.0, 1.0);
            i2 = vec3<f32>(0.0, 1.0, 1.0);
        } else if (x0.x < x0.z) {
            i1 = vec3<f32>(0.0, 1.0, 0.0);
            i2 = vec3<f32>(0.0, 1.0, 1.0);
        } else {
            i1 = vec3<f32>(0.0, 1.0, 0.0);
            i2 = vec3<f32>(1.0, 1.0, 0.0);
        }
    }
    
    let x1 = x0 - i1 + (1.0 / 6.0);
    let x2 = x0 - i2 + (1.0 / 3.0);
    let x3 = x0 - 1.0 + 0.5;
    
    var m = vec4<f32>(
        dot(x0, x0),
        dot(x1, x1),
        dot(x2, x2),
        dot(x3, x3)
    );
    m = max(0.6 - m, vec4<f32>(0.0));
    m = m * m;
    m = m * m;
    
    let g0 = dot(hash3(i + vec3<f32>(0.0)), x0);
    let g1 = dot(hash3(i + i1), x1);
    let g2 = dot(hash3(i + i2), x2);
    let g3 = dot(hash3(i + vec3<f32>(1.0)), x3);
    
    let n = dot(m, vec4<f32>(g0, g1, g2, g3));
    return 32.0 * n * 0.5 + 0.5;
}

fn voronoi3d(p: vec3<f32>) -> f32 {
    let pi = floor(p);
    let pf = fract(p);
    var min_dist = 8.0;
    
    for (var k = -1; k <= 1; k++) {
        for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {
                let g = vec3<f32>(f32(i), f32(j), f32(k));
                let o = hash3(pi + g) * 0.5 + 0.5;
                let r = g + o - pf;
                let d = dot(r, r);
                if (d < min_dist) {
                    min_dist = d;
                }
            }
        }
    }
    return clamp(sqrt(min_dist), 0.0, 1.0);
}

fn fbm_perlin(p: vec3<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
    var value = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var total_amp = 0.0;
    for (var i = 0; i < 8; i++) {
        if (i >= octaves) { break; }
        value += amp * perlin3d(p * freq);
        total_amp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }
    return value / total_amp;
}

fn fbm_simplex(p: vec3<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
    var value = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var total_amp = 0.0;
    for (var i = 0; i < 8; i++) {
        if (i >= octaves) { break; }
        value += amp * simplex3d(p * freq);
        total_amp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }
    return value / total_amp;
}

fn fbm_voronoi(p: vec3<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
    var value = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var total_amp = 0.0;
    for (var i = 0; i < 8; i++) {
        if (i >= octaves) { break; }
        value += amp * voronoi3d(p * freq);
        total_amp += amp;
        freq *= lacunarity;
        amp *= persistence;
    }
    return value / total_amp;
}

fn get_field(val: f32, hasSig: f32, tex: texture_2d<f32>, samp: sampler, uv: vec2<f32>) -> f32 {
    if (hasSig > 0.5) {
        return textureSampleLevel(tex, samp, uv, 0.0).r;
    }
    return val;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let scale = get_field(u.scale, u.hasSignal_scale, scaleTex, sigSamp, in.uv);
    let octaves_f = get_field(u.octaves, u.hasSignal_octaves, octavesTex, sigSamp, in.uv);
    let octaves = i32(clamp(octaves_f, 1.0, 8.0));
    let persistence = get_field(u.persistence, u.hasSignal_persistence, persistenceTex, sigSamp, in.uv);
    let lacunarity = get_field(u.lacunarity, u.hasSignal_lacunarity, lacunarityTex, sigSamp, in.uv);
    let speed = get_field(u.speed, u.hasSignal_speed, speedTex, sigSamp, in.uv);

    let isVideo = u.outputType > 0.5;
    let z_coord = select(0.0, u.time * speed, isVideo);
    
    let coord = vec3<f32>(in.uv * scale, z_coord);
    
    var n_val = 0.0;
    if (u.noiseType < 0.5) {
        n_val = fbm_perlin(coord, octaves, persistence, lacunarity);
    } else if (u.noiseType < 1.5) {
        n_val = fbm_simplex(coord, octaves, persistence, lacunarity);
    } else {
        n_val = fbm_voronoi(coord, octaves, persistence, lacunarity);
    }
    
    return mix(u.colorStart, u.colorEnd, clamp(n_val, 0.0, 1.0));
}
`;

interface DeviceNoiseResources {
	uniformLayout: GPUBindGroupLayout;
	signalsLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceNoiseResources>();
const noiseUniformData = new Float32Array(24);

function getDeviceLayouts(device: GPUDevice): DeviceNoiseResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const uniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const signalsLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 4,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 5,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		uniformLayout,
		signalsLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getNoiseResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `noise_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const noiseModule = device.createShaderModule({
			label: `noise_${format}.wgsl`,
			code: NOISE_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `NoiseGeneratorPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [layouts.uniformLayout, layouts.signalsLayout],
			}),
			vertex: { module: noiseModule, entryPoint: "vs" },
			fragment: {
				module: noiseModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		noisePipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		signalsLayout: layouts.signalsLayout,
	};
}

function hexToRgba(hex: string): [number, number, number, number] {
	let h = hex.replace("#", "");
	if (h.length === 3 || h.length === 4) {
		h = h
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const r = parseInt(h.substring(0, 2), 16) / 255;
	const g = parseInt(h.substring(2, 4), 16) / 255;
	const b = parseInt(h.substring(4, 6), 16) / 255;
	let a = 1.0;
	if (h.length === 8) {
		a = parseInt(h.substring(6, 8), 16) / 255;
	}
	return [r, g, b, a];
}

function resolveNoiseField(
	op: NoiseOp,
	fieldName: "scale" | "octaves" | "persistence" | "lacunarity" | "speed",
	defaultValue: number,
): { hasSignal: boolean; sd: any; value: number } {
	const handleIdKey = `${fieldName}HandleId` as keyof NoiseOp;
	const handleId = op[handleIdKey] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;

	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd = hasSignal ? signalInput?.outputItem?.data : null;

	let value = defaultValue;
	if (!hasSignal) {
		if (
			signalInput?.connectionValid &&
			signalInput.outputItem?.type === "Number"
		) {
			value = Number(signalInput.outputItem.data ?? defaultValue);
		} else {
			value = Number(op[fieldName] ?? defaultValue);
		}
	} else if (sd && typeof sd === "object" && "offset" in sd) {
		value = Number(sd.offset ?? defaultValue);
	}

	return { hasSignal, sd, value };
}

export const NoiseWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, encoder, pass, targetWidth, targetHeight, props } = args;

	const op = props.virtualMedia?.operation as NoiseOp | undefined;
	if (op?.op !== "NoiseGenerator" || !op) return;

	const {
		noisePipeline: pipeline,
		uniformLayout: uLayout,
		signalsLayout: sigLayout,
	} = getNoiseResources(ctx.device, ctx.renderer.format);

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;

	// Resolve fields & check signals
	const scaleInfo = resolveNoiseField(op, "scale", 10.0);
	const octavesInfo = resolveNoiseField(op, "octaves", 4);
	const persistenceInfo = resolveNoiseField(op, "persistence", 0.5);
	const lacunarityInfo = resolveNoiseField(op, "lacunarity", 2.0);
	const speedInfo = resolveNoiseField(op, "speed", 1.0);

	const noiseTypeVal =
		op.noiseType === "Simplex" ? 1.0 : op.noiseType === "Voronoi" ? 2.0 : 0.0;
	const outputTypeVal = op.outputType === "Video" ? 1.0 : 0.0;

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const colorStartVal = hexToRgba(op.colorStart ?? "#000000");
	const colorEndVal = hexToRgba(op.colorEnd ?? "#ffffff");

	// Fill uniforms array
	noiseUniformData[0] = noiseTypeVal;
	noiseUniformData[1] = outputTypeVal;
	noiseUniformData[2] = elapsedSeconds;
	noiseUniformData[3] = 0.0; // padding

	noiseUniformData[4] = scaleInfo.value;
	noiseUniformData[5] = octavesInfo.value;
	noiseUniformData[6] = persistenceInfo.value;
	noiseUniformData[7] = lacunarityInfo.value;

	noiseUniformData[8] = speedInfo.value;
	noiseUniformData[9] = scaleInfo.hasSignal ? 1.0 : 0.0;
	noiseUniformData[10] = octavesInfo.hasSignal ? 1.0 : 0.0;
	noiseUniformData[11] = persistenceInfo.hasSignal ? 1.0 : 0.0;

	noiseUniformData[12] = lacunarityInfo.hasSignal ? 1.0 : 0.0;
	noiseUniformData[13] = speedInfo.hasSignal ? 1.0 : 0.0;
	noiseUniformData[14] = 0.0; // padding
	noiseUniformData[15] = 0.0; // padding

	noiseUniformData[16] = colorStartVal[0];
	noiseUniformData[17] = colorStartVal[1];
	noiseUniformData[18] = colorStartVal[2];
	noiseUniformData[19] = colorStartVal[3];

	noiseUniformData[20] = colorEndVal[0];
	noiseUniformData[21] = colorEndVal[1];
	noiseUniformData[22] = colorEndVal[2];
	noiseUniformData[23] = colorEndVal[3];

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(noiseUniformData);

	// Load or create views for signals
	const signalFields = [
		{ name: "scale", info: scaleInfo },
		{ name: "octaves", info: octavesInfo },
		{ name: "persistence", info: persistenceInfo },
		{ name: "lacunarity", info: lacunarityInfo },
		{ name: "speed", info: speedInfo },
	];

	const signalViews: GPUTextureView[] = [];
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	for (const f of signalFields) {
		const isGenerator = !!(f.info.hasSignal && f.info.sd);
		if (isGenerator) {
			const view = signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				f.info.sd.nodeId ?? `noise_${f.name}_sig`,
				elapsedSeconds,
				durationSeconds,
				f.info.sd as NoiseSignalData,
				targetWidth,
				targetHeight,
				props.renderId,
				frame,
				fps,
			);
			signalViews.push(view);
		} else {
			signalViews.push(signalRegistry.getDummy1x1TextureView(ctx.device));
		}
	}

	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	pass.setBindGroup(
		1,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: signalViews[0] }, // scale
				{ binding: 1, resource: signalViews[1] }, // octaves
				{
					binding: 2,
					resource: persistenceInfo.hasSignal ? signalViews[2] : signalViews[2],
				}, // persistence
				{ binding: 3, resource: signalViews[3] }, // lacunarity
				{ binding: 4, resource: signalViews[4] }, // speed
				{ binding: 5, resource: sampler },
			],
		}),
	);

	pass.draw(4);
};
