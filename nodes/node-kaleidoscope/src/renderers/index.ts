import { defineRenderer } from "@framefields/node-sdk/renderer";
import { KaleidoscopeWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: KaleidoscopeWebGPURenderer,
});
export { KaleidoscopeWebGPURenderer };
