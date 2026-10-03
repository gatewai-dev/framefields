/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import type { CanvasGeneratorNodeConfig } from "../shared/config.js";

const CANVAS_SHADER = `
struct CanvasUniforms {
    fillType      : f32, // 0 = Solid, 1 = Linear, 2 = Radial
    angleRad      : f32,
    radius        : f32,
    _padding1     : f32,
    solid         : vec4<f32>,
    startColor    : vec4<f32>,
    endColor      : vec4<f32>,
    center        : vec2<f32>,
    _padding2     : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : CanvasUniforms;

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

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    if (u.fillType < 0.5) {
        // Solid Color
        return u.solid;
    } else if (u.fillType < 1.5) {
        // Linear Gradient
        let dir = vec2<f32>(cos(u.angleRad), sin(u.angleRad));
        // Project uv relative to center (0.5, 0.5) onto the direction
        let t = dot(in.uv - vec2<f32>(0.5, 0.5), dir) + 0.5;
        let clampedT = clamp(t, 0.0, 1.0);
        return mix(u.startColor, u.endColor, clampedT);
    } else {
        // Radial Gradient
        let dist = distance(in.uv, u.center);
        let t = clamp(dist / max(u.radius, 1e-4), 0.0, 1.0);
        return mix(u.startColor, u.endColor, t);
    }
}
`;

interface DeviceCanvasResources {
	uniformLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceCanvasResources>();
const canvasUniformData = new Float32Array(20);

function getDeviceLayouts(device: GPUDevice): DeviceCanvasResources {
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

	res = {
		uniformLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getCanvasResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `canvas_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const canvasModule = device.createShaderModule({
			label: `canvas_${format}.wgsl`,
			code: CANVAS_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `CanvasGeneratorPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [layouts.uniformLayout],
			}),
			vertex: { module: canvasModule, entryPoint: "vs" },
			fragment: {
				module: canvasModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		canvasPipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
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

export const CanvasGeneratorWebGPURenderer: WebGPUNodeRenderer = async (
	args,
) => {
	const { ctx, pass, props } = args;

	const op = props.virtualMedia?.operation as unknown as
		| (CanvasGeneratorNodeConfig & { op: string })
		| undefined;

	if (op?.op !== "CanvasGenerator" || !op) return;

	const { canvasPipeline: pipeline, uniformLayout: uLayout } =
		getCanvasResources(ctx.device, ctx.renderer.format);

	const fillTypeVal =
		op.fillType === "radial" ? 2.0 : op.fillType === "linear" ? 1.0 : 0.0;
	const angleRadVal = ((op.gradientAngle ?? 180) * Math.PI) / 180;
	const radialRadiusVal = op.radialRadius ?? 0.5;

	const solidCol = hexToRgba(op.solidColor ?? "#3b82f6");
	const startCol = hexToRgba(op.gradientStart ?? "#3b82f6");
	const endCol = hexToRgba(op.gradientEnd ?? "#1d4ed8");

	// Write uniform data (aligning with WGSL layout)
	canvasUniformData[0] = fillTypeVal;
	canvasUniformData[1] = angleRadVal;
	canvasUniformData[2] = radialRadiusVal;
	canvasUniformData[3] = 0.0; // padding

	canvasUniformData[4] = solidCol[0];
	canvasUniformData[5] = solidCol[1];
	canvasUniformData[6] = solidCol[2];
	canvasUniformData[7] = solidCol[3];

	canvasUniformData[8] = startCol[0];
	canvasUniformData[9] = startCol[1];
	canvasUniformData[10] = startCol[2];
	canvasUniformData[11] = startCol[3];

	canvasUniformData[12] = endCol[0];
	canvasUniformData[13] = endCol[1];
	canvasUniformData[14] = endCol[2];
	canvasUniformData[15] = endCol[3];

	canvasUniformData[16] = op.radialCenterX ?? 0.5;
	canvasUniformData[17] = op.radialCenterY ?? 0.5;
	canvasUniformData[18] = 0.0; // padding
	canvasUniformData[19] = 0.0; // padding

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(canvasUniformData);

	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	pass.draw(4);
};
