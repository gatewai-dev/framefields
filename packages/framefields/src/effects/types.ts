import type { EffectConfigValue } from "@framefields/core";

/** A prop that accepts a plain value, a reactive signal, or a frame signal. */
export type EffectProp<T> = EffectConfigValue<T>;
