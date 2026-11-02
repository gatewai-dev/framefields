/**
 * Registers the built-in node renderers (their WebGPU renderers and audio
 * processors) in a page or worker, as the export engine registers them.
 */
import {
	audioRegistry,
	type NodeRendererPlugin,
	registerWebGPURenderer,
} from "@framefields/node-sdk";

export interface BuiltinRenderer {
	ops: readonly string[];
	load: () => Promise<{ default?: NodeRendererPlugin }>;
}

export async function registerRenderers(renderers: readonly BuiltinRenderer[]) {
	await Promise.all(
		renderers.map(async ({ ops, load }) => {
			try {
				const plugin = (await load()).default;
				for (const op of ops) {
					if (plugin?.WebGPURenderer)
						registerWebGPURenderer(op, plugin.WebGPURenderer);
					if (plugin?.audioProcessor)
						audioRegistry.register(op, plugin.audioProcessor);
				}
			} catch (err) {
				console.warn(
					"[framefields] renderer for",
					ops[0],
					"failed to load",
					err,
				);
			}
		}),
	);
}
