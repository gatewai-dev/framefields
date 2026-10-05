import { defineRenderer } from "@framefields/node-sdk/renderer";
import { SelectiveColorWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: SelectiveColorWebGPURenderer,
});
