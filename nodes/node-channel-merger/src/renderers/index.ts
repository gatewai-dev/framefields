import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ChannelMergerWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ChannelMergerWebGPURenderer,
});

export { ChannelMergerWebGPURenderer };
