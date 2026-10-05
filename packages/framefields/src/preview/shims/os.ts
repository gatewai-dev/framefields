/// <reference lib="dom" />
// `node:os` for the browser preview bundle.
export const homedir = (): string => "/";
export const tmpdir = (): string => "/tmp";
export const platform = (): string => "browser";
export const arch = (): string => "wasm";
export const cpus = (): unknown[] =>
	Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({}));
export const totalmem = (): number => 0;
export const freemem = (): number => 0;
export const EOL = "\n";
export default {
	homedir,
	tmpdir,
	platform,
	arch,
	cpus,
	totalmem,
	freemem,
	EOL,
};
