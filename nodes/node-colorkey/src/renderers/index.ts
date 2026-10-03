import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ColorKeyWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ColorKeyWebGPURenderer,
});
