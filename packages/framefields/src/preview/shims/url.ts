// `node:url` for the browser preview bundle.
export const fileURLToPath = (url: string | URL): string =>
	decodeURIComponent(new URL(String(url)).pathname);
export const pathToFileURL = (p: string): URL =>
	new URL(`file://${encodeURI(p)}`);
const URLCtor = globalThis.URL;
export { URLCtor as URL };
export default { fileURLToPath, pathToFileURL, URL: URLCtor };
