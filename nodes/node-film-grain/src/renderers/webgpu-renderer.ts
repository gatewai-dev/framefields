/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";

interface FilmGrainOp {
	op: "FilmGrain";
	strength?: number;
	size?: number;
	monochrome?: boolean;
	animated?: boolean;
	speed?: number;
	shadows?: number;
	midtones?: number;
	highlights?: number;
	opacity?: number;
	strengthHandleId?: string | null;
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

type FilmGrainSignalData = SignalData & { nodeId?: string };

const FILM_GRAIN_SHADER = `
struct FilmUniforms {
    strength    : f32,
    size        : f32,
    monochrome  : f32,
    animated    : f32,

    frameIndex  : f32, // discrete per-output-frame counter (speed-scaled), NOT continuous time
    shadows     : f32,
    midtones    : f32,
    highlights  : f32,

    hasSignal   : f32,
    _pad0       : f32,
    _pad1       : f32,
    _pad2       : f32,
};

@group(0) @binding(0) var<uniform> u : FilmUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;
@group(2) @binding(0) var signalTex  : texture_2d<f32>;
@group(2) @binding(1) var signalSamp : sampler;

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

fn hash2D(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn smoothNoise(p: vec2<f32>) -> f32 {
    let pi = floor(p);
    let pf = fract(p);

    // Quintic interpolation
    let w = pf * pf * pf * (pf * (pf * 6.0 - 15.0) + 10.0);

    let h00 = hash2D(pi + vec2<f32>(0.0, 0.0));
    let h10 = hash2D(pi + vec2<f32>(1.0, 0.0));
    let h01 = hash2D(pi + vec2<f32>(0.0, 1.0));
    let h11 = hash2D(pi + vec2<f32>(1.0, 1.0));

    let n0 = mix(h00, h10, w.x);
    let n1 = mix(h01, h11, w.x);

    return mix(n0, n1, w.y);
}

// Produces a pseudo-random, NON-directional offset that changes once per
// output frame. This replaces the old time * constant translation, which
// smoothly scrolled the noise lattice in a fixed direction (17.31, 43.19)
// every frame -- that's why grain visibly drifted instead of flickering.
//
// The frame index is wrapped into a bounded range before hashing so the
// pattern stays high quality over long renders (f32 precision degrades on
// very large hash inputs); the wrap period is long enough that any repeat
// is imperceptible in grain.
fn frameJitter(frameIndex: f32) -> vec2<f32> {
    let raw = floor(frameIndex);
    let n = raw - floor(raw / 4096.0) * 4096.0;
    let hx = hash2D(vec2<f32>(n, n * 1.6180339887));
    let hy = hash2D(vec2<f32>(n * 3.14159265, n + 91.7));
    return vec2<f32>(hx, hy) * 1024.0;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    var color = textureSampleLevel(tex, samp, in.uv, 0.0);

    var strength = u.strength;
    if (u.hasSignal > 0.5) {
        let sigVal = textureSampleLevel(signalTex, signalSamp, in.uv, 0.0).r;
        strength = sigVal;
    }

    if (strength <= 0.0) {
        return color;
    }

    let dimensions = vec2<f32>(textureDimensions(tex));
    let grainCoord = (in.uv * dimensions) / u.size;

    let jitter = select(vec2<f32>(0.0), frameJitter(u.frameIndex), u.animated > 0.5);

    let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));

    // Luminance response curve logic
    let shadowFactor = exp(-luminance * luminance / 0.1);
    let highlightFactor = exp(-(1.0 - luminance) * (1.0 - luminance) / 0.1);
    let midtoneFactor = max(0.0, 1.0 - shadowFactor - highlightFactor);

    let response = (u.shadows * shadowFactor) + (u.midtones * midtoneFactor) + (u.highlights * highlightFactor);
    let finalGrainStrength = (strength / 100.0) * response * 0.15; // Normalized scale

    if (u.monochrome > 0.5) {
        let seed = grainCoord + jitter;
        let noiseVal = smoothNoise(seed);
        let grain = (noiseVal - 0.5) * finalGrainStrength;
        color.r += grain;
        color.g += grain;
        color.b += grain;
    } else {
        // Fixed per-channel spatial offsets (unrelated to time) keep the
        // R/G/B lattices decorrelated from each other; temporal variation
        // comes entirely from jitter now.
        let seedR = grainCoord + jitter;
        let seedG = grainCoord + jitter + vec2<f32>(173.3, 281.9);
        let seedB = grainCoord + jitter + vec2<f32>(391.7, 127.1);

        let noiseR = smoothNoise(seedR);
        let noiseG = smoothNoise(seedG);
        let noiseB = smoothNoise(seedB);

        color.r += (noiseR - 0.5) * finalGrainStrength;
        color.g += (noiseG - 0.5) * finalGrainStrength;
        color.b += (noiseB - 0.5) * finalGrainStrength;
    }

    return clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
}
`;

interface DeviceFilmGrainResources {
	filmUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceFilmGrainResources>();
const filmGrainUniformData = new Float32Array(12);

function getDeviceLayouts(device: GPUDevice): DeviceFilmGrainResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const filmUniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const singleTextureLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	const signalTextureLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		filmUniformLayout,
		singleTextureLayout,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getFilmGrainResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `filmgrain_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const filmModule = device.createShaderModule({
			label: `filmgrain_${format}.wgsl`,
			code: FILM_GRAIN_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `FilmGrainPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.filmUniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: filmModule, entryPoint: "vs" },
			fragment: {
				module: filmModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		filmPipeline: pipeline,
		filmUniformLayout: layouts.filmUniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const FilmGrainWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		encoder,
		pass,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		props,
		drawChild,
	} = args;

	const frame = props.frame ?? 0;
	const compositionFrame = props.compositionFrame ?? frame;
	const fps = props.fps || 30;
	const op = props.virtualMedia?.operation as FilmGrainOp | undefined;
	if (op?.op !== "FilmGrain" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	const logicalWidth =
		props.containerWidth ??
		ctx.surface.width /
			(typeof window !== "undefined" ? window.devicePixelRatio : 1);
	const dpiScale = width / logicalWidth;

	// Resolve Strength Signal
	const signalInput = op.strengthHandleId
		? op.inputs?.[op.strengthHandleId]
		: null;
	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd =
		hasSignal && signalInput?.outputItem?.data
			? (signalInput.outputItem.data as FilmGrainSignalData)
			: null;

	const resolveVal = (val: unknown, fallback: number): number => {
		if (val === undefined || val === null) return fallback;
		if (typeof val === "object" && val !== null) {
			if (
				"get" in (val as Record<string, unknown>) &&
				typeof (val as { get: unknown }).get === "function"
			) {
				val = (
					val as { get: (ctx: { frame: number; fps: number }) => unknown }
				).get({ frame: compositionFrame, fps });
			} else if ("value" in (val as Record<string, unknown>)) {
				val = (val as { value: unknown }).value;
			}
		} else if (typeof val === "function") {
			val = (val as (f: number, fps: number) => unknown)(compositionFrame, fps);
		}
		const n = Number(val);
		return Number.isFinite(n) ? n : fallback;
	};

	let strength = 0;
	let hasStaticSignal = false;

	if (!hasSignal) {
		if (
			signalInput?.connectionValid &&
			signalInput.outputItem?.type === "Number"
		) {
			strength = Math.max(0, Number(signalInput.outputItem.data ?? 0));
		} else {
			strength = Math.max(0, resolveVal(op.strength, 15));
		}
	} else if (sd) {
		strength = Math.max(0, Number(sd.offset ?? 0));
		hasStaticSignal = true;
	}

	// 1. Draw input child to temporary texture
	const tmpTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	const childPass = ctx.renderer.beginFrame(
		encoder,
		tmpView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{ ...props, virtualMedia: childMedia },
		tmpView,
		tmpTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// End any active pass from drawing child
	args.pass.end();

	// 2. Fetch resources and pipeline
	const {
		filmPipeline: pipeline,
		filmUniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getFilmGrainResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Fetch dynamic signal texture view on-demand
	let signalView: GPUTextureView;
	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	if (hasStaticSignal && sd) {
		signalView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			sd.nodeId ?? "filmgrain_strength_sig",
			elapsedSeconds,
			durationSeconds,
			sd,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		signalView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	// 3. Prepare uniforms
	// Scale size based on DPI so grain physical size is identical on high-DPI displays
	const size = Math.max(0.5, resolveVal(op.size, 1.5)) * dpiScale;
	const animated = op.animated ?? true;
	const speed = resolveVal(op.speed, 50);

	// Drive the grain animation off the discrete output-frame counter rather
	// than continuous elapsed time. The shader hashes this into a per-frame
	// jitter, so higher `speed` means the grain re-randomizes more often,
	// not that it scrolls faster in a fixed direction.
	const grainFrameIndex = frame * (speed / 50.0);

	filmGrainUniformData[0] = strength;
	filmGrainUniformData[1] = size;
	filmGrainUniformData[2] = (op.monochrome ?? true) ? 1.0 : 0.0;
	filmGrainUniformData[3] = animated ? 1.0 : 0.0;
	filmGrainUniformData[4] = grainFrameIndex;
	filmGrainUniformData[5] = resolveVal(op.shadows, 0.2);
	filmGrainUniformData[6] = resolveVal(op.midtones, 1.0);
	filmGrainUniformData[7] = resolveVal(op.highlights, 0.2);
	filmGrainUniformData[8] = hasStaticSignal ? 1.0 : 0.0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(filmGrainUniformData);

	// 4. Output texture
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// 5. Run single-pass Film Grain shader
	const filmPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	filmPass.setPipeline(pipeline);
	filmPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	filmPass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout,
			tmpTex,
			sampler,
		),
	);
	filmPass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: signalView },
				{ binding: 1, resource: sampler },
			],
		}),
	);
	filmPass.draw(4);
	filmPass.end();

	// 6. Draw results to final targetView using opacity blend
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(
		finalPass,
		outTex,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: resolveVal(op.opacity, 1.0) },
	);

	args.pass = finalPass;
};
