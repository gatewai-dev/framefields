import { defineRenderer } from "@framefields/node-sdk/renderer";
import { PainterlyWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: PainterlyWebGPURenderer,
});
export { PainterlyWebGPURenderer };
