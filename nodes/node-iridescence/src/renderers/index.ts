import { defineRenderer } from "@framefields/node-sdk/renderer";
import { IridescenceWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: IridescenceWebGPURenderer,
});
export { IridescenceWebGPURenderer };
