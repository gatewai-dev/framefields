import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

/** Names the shader's uniform block already defines. */
export const SHADER_BUILTIN_UNIFORMS = ["time", "frame", "resolution"] as const;

/** A uniform is one f32 field of the block, so its name must be a WGSL identifier. */
export const SHADER_UNIFORM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export const shaderConfig = configBuilder()
	.field("fragment", z.string().default(""), {
		bindable: false,
		label: "fragment",
		description:
			"WGSL that defines `fn shade(uv: vec2<f32>) -> vec4<f32>`: the layer's premultiplied color at `uv` (0,0 top-left to 1,1 bottom-right). It reads `u.time` (seconds since the layer started), `u.frame`, `u.resolution` (px) and one `u.<name>` per uniform.",
	})
	.field("uniforms", z.record(z.string(), z.number()).default({}), {
		bindable: false,
		signal: false,
		label: "uniforms",
		description:
			"Named f32 uniforms, each a number, a signal or a `(ctx) => number` function sampled every frame; `u.<name>` in the shader.",
		tsType: { name: "ShaderUniforms", from: "../types.js" },
	})
	.build();

export const ShaderNodeConfigSchema = shaderConfig.schema;
export type ShaderNodeConfig = z.infer<typeof ShaderNodeConfigSchema>;
