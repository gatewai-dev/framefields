/**
 * Browser entry (`@framefields/vision/web`).
 *
 * Re-exports the full engine plus the WebGPU session provider. Consumers pass a provider to
 * the runner explicitly (keeps the runner environment-agnostic and tree-shakeable):
 *
 *   const runner = VisionRunner.create({ provider: createWebGPUProvider() });
 *
 * `onnxruntime-web` is an optional peer dependency, loaded lazily on the first session.
 */

export * from "./index.js";
export * from "./runtime/webgpu-provider.js";
