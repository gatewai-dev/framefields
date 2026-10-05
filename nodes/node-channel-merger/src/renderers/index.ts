import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ChannelMergerWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ChannelMergerWebGPURenderer,
});

export { ChannelMergerWebGPURenderer };
