/**
 * `@framefields/compositions/program` — the v2 composition document.
 *
 * Pure module: schema, E-code validation, the doc → render-tree constructor
 * and the deterministic layout pass. Zero React/WebGPU/browser deps — safe
 * for node, CLI, and browser alike.
 */

export * from "../utils/layout/resolve-layout.js";
export * from "./animation.js";
export * from "./character-schema.js";
export * from "./evaluator.js";
export * from "./lint.js";
export * from "./mattes.js";
export * from "./media-signal.js";
export * from "./path-morph.js";
export * from "./procedural-schema.js";
export * from "./schema.js";
export * from "./sequence.js";
export * from "./stagger.js";
export * from "./to-virtual-media.js";
export * from "./track-sampler.js";
export * from "./validate.js";
