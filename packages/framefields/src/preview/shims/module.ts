// `node:module` in the browser. The preview server uses `createRequire` to
// find optional packages (onnxruntime-web, the node renderer list); in the
// browser those calls must stay harmless. `createRequire` returns a resolver
// that throws only when it is actually asked to resolve something, which the
// callers catch and treat as "not installed".
export function createRequire(): (id: string) => never {
	return (id: string) => {
		throw new Error(`Cannot require "${id}" in the browser preview.`);
	};
}

export function isBuiltin(): boolean {
	return false;
}
