/**
 * `@framefields/compositions/program` — the v2 composition document.
 *
 * Pure module: schema, E-code validation, the doc → render-tree constructor
 * and the deterministic layout pass. Zero React/WebGPU/browser deps — safe
 * for node, CLI, and browser alike.
 */

export * from "../utils/layout/resolve-layout.js";
export * from "./animation.js";
export * from "./evaluator.js";
export * from "./schema.js";
export * from "./sequence.js";
export * from "./stagger.js";
export * from "./to-virtual-media.js";
export * from "./validate.js";
