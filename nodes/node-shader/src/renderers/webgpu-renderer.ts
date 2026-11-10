/// <reference types="webgpu" />
/**
 * Shader: a layer drawn by a WGSL fragment function the composition supplies.
 * The node owns the vertex stage and the uniform block; the author writes
 * `fn shade(uv: vec2<f32>) -> vec4<f32>` and names the numbers it needs.
 */
import {
	resolveFrameNumber,
	type WebGPUNodeRenderer,
} from "@framefields/node-sdk";
import {
	createFullscreenPipeline,
	FULLSCREEN_QUAD_WGSL,
	fragmentBindGroupLayout,
	PREMULTIPLIED_BLEND,
	perDevice,
	signalTiming,
} from "@framefields/node-sdk/gpu";
import {
	SHADER_BUILTIN_UNIFORMS,
	SHADER_UNIFORM_NAME,
} from "../shared/config.js";

const OP = "Shader";
/** `time`, `frame` and `resolution` come before the named uniforms. */
const BUILTIN_FLOATS = 4;

interface ShaderOp {
	op?: string;
	fragment?: string;
	uniforms?: Record<string, unknown>;
	effect?: { resolveUniforms?: (ctx: unknown) => Record<string, unknown> };
}

/** The uniform block and entry points wrapped around the author's `shade`. */
function preamble(names: string[]): string {
	const fields = names.map((name) => `\t${name} : f32,`).join("\n");
	return `struct ShaderUniforms {
	time : f32,
	frame : f32,
	resolution : vec2<f32>,
${fields}
};
@group(0) @binding(0) var<uniform> u : ShaderUniforms;
${FULLSCREEN_QUAD_WGSL}
@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> { return shade(in.uv); }
`;
}

function checkNames(names: string[]): void {
	for (const name of names) {
		if (!SHADER_UNIFORM_NAME.test(name))
			throw new Error(
				`Shader: uniform "${name}" is not a WGSL identifier (letters, digits and _; starting with a letter).`,
			);
		if ((SHADER_BUILTIN_UNIFORMS as readonly string[]).includes(name))
			throw new Error(
				`Shader: uniform "${name}" is built in; pick another name.`,
			);
	}
}

/** Compiles the module, or throws with the author's own line numbers. */
async function compile(
	device: GPUDevice,
	fragment: string,
	names: string[],
): Promise<GPUShaderModule> {
	const head = preamble(names);
	const module = device.createShaderModule({
		code: `${head}${fragment}`,
		label: `${OP}.wgsl`,
	});
	const info = await module.getCompilationInfo();
	const errors = info.messages.filter((m) => m.type === "error");
	if (errors.length > 0) {
		const offset = head.split("\n").length - 1;
		const lines = errors.map(
			(m) => `  line ${m.lineNum - offset}:${m.linePos} ${m.message}`,
		);
		throw new Error(
			`Shader: the fragment did not compile.\n${lines.join("\n")}`,
		);
	}
	return module;
}

const resources = perDevice((device: GPUDevice) => ({
	layout: fragmentBindGroupLayout(device, ["uniform"], `${OP}_layout`),
	/** One pipeline per fragment source, uniform list and target format. */
	pipelines: new Map<string, Promise<GPURenderPipeline>>(),
}));

function pipelineFor(
	device: GPUDevice,
	format: GPUTextureFormat,
	fragment: string,
	names: string[],
): Promise<GPURenderPipeline> {
	const r = resources(device);
	const key = `${format}\n${names.join(",")}\n${fragment}`;
	let pipeline = r.pipelines.get(key);
	if (!pipeline) {
		pipeline = compile(device, fragment, names).then((module) =>
			createFullscreenPipeline(device, {
				label: OP,
				module,
				layouts: [r.layout],
				format,
				blend: PREMULTIPLIED_BLEND,
			}),
		);
		r.pipelines.set(key, pipeline);
	}
	return pipeline;
}

export const ShaderWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, pass, targetWidth, targetHeight, props } = args;
	const op = props.virtualMedia?.operation as ShaderOp | undefined;
	if (op?.op !== OP) return;
	if (!op.fragment?.includes("fn shade"))
		throw new Error(
			"Shader: `fragment` must define `fn shade(uv: vec2<f32>) -> vec4<f32>`.",
		);

	const fps = props.fps || 30;
	const frame = props.frame ?? 0;
	// Signals follow the composition's clock; `u.time` is the layer's own.
	const signalFrame = Math.round(props.compositionFrame ?? frame);
	const raw = op.effect?.resolveUniforms
		? op.effect.resolveUniforms({
				frame: signalFrame,
				fps,
				time: signalFrame / fps,
			})
		: op;
	const uniforms = (raw.uniforms ?? {}) as Record<string, unknown>;
	const names = Object.keys(uniforms);
	checkNames(names);

	// The block is a multiple of 16 bytes, so it fits any alignment WGSL asks for.
	const floats = Math.ceil((BUILTIN_FLOATS + names.length) / 4) * 4;
	const data = new Float32Array(floats);
	data[0] = signalTiming(props, frame, fps).elapsedSeconds;
	data[1] = frame;
	data[2] = targetWidth;
	data[3] = targetHeight;
	names.forEach((name, i) => {
		data[BUILTIN_FLOATS + i] = resolveFrameNumber(
			uniforms[name],
			0,
			signalFrame,
			fps,
		);
	});

	const pipeline = await pipelineFor(
		ctx.device,
		ctx.renderer.format,
		op.fragment,
		names,
	);
	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: resources(ctx.device).layout,
			entries: [
				{
					binding: 0,
					resource: { buffer: ctx.renderer.getTemporaryBuffer(data) },
				},
			],
		}),
	);
	pass.draw(4);
};
