/// <reference lib="dom" />
/// <reference types="webgpu" />
// `node:fs` for the browser preview bundle. Reads go to the preview server,
// which serves files by their absolute path; synchronous reads use a
// synchronous request, so build-time code like `JSON.parse(readFileSync(…))`
// runs unchanged. Writes are skipped: the preview never changes the project.
type Enc =
	| BufferEncoding
	| { encoding?: BufferEncoding | null }
	| null
	| undefined;

const toUrl = (p: string | URL): string => {
	const s = String(p);
	return encodeURI(
		s.startsWith("file://") ? decodeURIComponent(new URL(s).pathname) : s,
	);
};
const encodingOf = (e: Enc) =>
	typeof e === "string" ? e : (e?.encoding ?? null);

function enoent(p: unknown): Error {
	return Object.assign(
		new Error(`ENOENT: no such file or directory, open '${p}'`),
		{
			code: "ENOENT",
		},
	);
}

function request(method: string, p: string | URL): XMLHttpRequest {
	const xhr = new XMLHttpRequest();
	xhr.open(method, toUrl(p), false);
	// Binary-safe text: each byte comes back as one char code.
	xhr.overrideMimeType("text/plain; charset=x-user-defined");
	xhr.send();
	return xhr;
}

export function readFileSync(p: string | URL, enc?: Enc): string | Uint8Array {
	const xhr = request("GET", p);
	if (xhr.status !== 200) throw enoent(p);
	const raw = xhr.responseText;
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
	return encodingOf(enc) ? new TextDecoder().decode(bytes) : bytes;
}

function stat(p: string | URL): { exists: boolean; size: number } {
	const s = String(p);
	const file = s.startsWith("file://")
		? decodeURIComponent(new URL(s).pathname)
		: s;
	const xhr = new XMLHttpRequest();
	xhr.open("GET", `/@gitframes/stat?path=${encodeURIComponent(file)}`, false);
	xhr.send();
	return xhr.status === 200
		? JSON.parse(xhr.responseText)
		: { exists: false, size: 0 };
}

export function existsSync(p: string | URL): boolean {
	try {
		return stat(p).exists;
	} catch {
		return false;
	}
}

export function statSync(p: string | URL) {
	const { exists, size } = stat(p);
	if (!exists) throw enoent(p);
	return { size, isFile: () => true, isDirectory: () => false, mtimeMs: 0 };
}

const skip = (): undefined => undefined;
const unsupported = (name: string) => () => {
	throw new Error(`fs.${name} is not available in the browser preview`);
};
export const writeFileSync = skip;
export const mkdirSync = skip;
export const rmSync = skip;
export const unlinkSync = skip;
export const renameSync = skip;
export const copyFileSync = skip;
export const appendFileSync = skip;
export const readdirSync = (): string[] => [];
export const accessSync = (p: string | URL): void => {
	if (!existsSync(p)) throw enoent(p);
};
export const createReadStream = unsupported("createReadStream");
export const createWriteStream = unsupported("createWriteStream");
export const watch = unsupported("watch");
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

const asyncSkip = async (): Promise<undefined> => undefined;
export const promises = {
	readFile: async (p: string | URL, enc?: Enc) => {
		const res = await fetch(toUrl(p));
		if (!res.ok) throw enoent(p);
		const bytes = new Uint8Array(await res.arrayBuffer());
		return encodingOf(enc) ? new TextDecoder().decode(bytes) : bytes;
	},
	stat: async (p: string | URL) => statSync(p),
	access: async (p: string | URL) => accessSync(p),
	readdir: async (): Promise<string[]> => [],
	writeFile: asyncSkip,
	appendFile: asyncSkip,
	mkdir: asyncSkip,
	rm: asyncSkip,
	unlink: asyncSkip,
	rename: asyncSkip,
	copyFile: asyncSkip,
	open: unsupported("promises.open"),
};

export default {
	readFileSync,
	existsSync,
	statSync,
	accessSync,
	readdirSync,
	writeFileSync,
	mkdirSync,
	rmSync,
	unlinkSync,
	renameSync,
	copyFileSync,
	appendFileSync,
	createReadStream,
	createWriteStream,
	watch,
	constants,
	promises,
};
