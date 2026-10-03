import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { CanvasGeneratorWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CanvasGeneratorWebGPURenderer,
});
export { CanvasGeneratorWebGPURenderer };
