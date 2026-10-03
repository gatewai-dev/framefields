import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ChannelSplitterWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ChannelSplitterWebGPURenderer,
});

export { ChannelSplitterWebGPURenderer };
