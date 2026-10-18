import { defineRenderer } from "@framefields/node-sdk/renderer";
import { OpArtWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: OpArtWebGPURenderer,
});
export { OpArtWebGPURenderer };
