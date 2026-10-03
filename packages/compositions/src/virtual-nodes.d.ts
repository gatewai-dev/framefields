declare module "virtual-gatewai-skia-renderers" {
	import type { FC } from "react";
	import type { NodeRenderProps } from "@gitframes/node-sdk";
	export const discoveredRenderers: Record<string, FC<NodeRenderProps>>;
	export const discoveredAudioProcessors: Record<
		string,
		(audioCtx: AudioContext, sourceNode: AudioNode, node: any) => AudioNode
	>;
}
