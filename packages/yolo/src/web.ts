/**
 * Browser entry (`@gitframes/yolo/web`, specs/yolov4plan.ts §Phase E).
 *
 * Re-exports the full engine plus the WebGPU session provider. Consumers pass a provider to
 * the runner explicitly (keeps the runner environment-agnostic and tree-shakeable):
 *
 *   const runner = YoloVisionRunner.create({ provider: createWebGPUProvider() });
 *
 * `onnxruntime-web` is an optional peer dependency, loaded lazily on the first session.
 */

export * from "./index.js";
export * from "./runtime/webgpu-provider.js";
