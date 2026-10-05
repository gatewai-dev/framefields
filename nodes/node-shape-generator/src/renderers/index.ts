import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ShapeGeneratorWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ShapeGeneratorWebGPURenderer,
});
export { ShapeGeneratorWebGPURenderer };
