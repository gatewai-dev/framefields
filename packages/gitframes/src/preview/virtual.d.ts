// Resolved when the browser engine is built (bundle.ts): the generated list of
// built-in node renderers from @gitframes/renderer.
declare module "gitframes-preview:renderers" {
	import type { BuiltinRenderer } from "./player.js";
	export const BUILTIN_NODE_RENDERERS: readonly BuiltinRenderer[];
}
