// Resolved when the browser engine is built (bundle.ts): the generated list of
// built-in node renderers from @framefields/renderer.
declare module "framefields-preview:renderers" {
	import type { BuiltinRenderer } from "./register.js";
	export const BUILTIN_NODE_RENDERERS: readonly BuiltinRenderer[];
}
