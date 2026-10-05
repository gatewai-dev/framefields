import { defineRenderer } from "@framefields/node-sdk/renderer";
import { CanvasGeneratorWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CanvasGeneratorWebGPURenderer,
});
export { CanvasGeneratorWebGPURenderer };
