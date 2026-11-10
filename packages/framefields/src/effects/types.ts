import type { EffectConfigValue, FrameContext } from "@framefields/core";

/** A prop that accepts a plain value, a reactive signal, or a frame signal. */
export type EffectProp<T> = EffectConfigValue<T>;

/**
 * A shader layer's named uniforms: each a number, a signal, or a function of
 * the frame context, sampled every frame.
 */
export type ShaderUniforms = Record<
	string,
	EffectProp<number> | ((ctx: FrameContext) => number)
>;
