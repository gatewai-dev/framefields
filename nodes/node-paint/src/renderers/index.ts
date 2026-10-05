import { defineRenderer } from "@framefields/node-sdk/renderer";
import { PaintWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: PaintWebGPURenderer,
});
