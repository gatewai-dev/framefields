import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ColorKeyWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ColorKeyWebGPURenderer,
});
