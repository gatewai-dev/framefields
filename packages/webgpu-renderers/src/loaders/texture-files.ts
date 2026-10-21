import fs from "node:fs";
import path from "node:path";

const MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".bmp": "image/bmp",
	".tga": "image/x-tga",
};

export interface TextureFile {
	bytes: Uint8Array;
	mime: string;
}

/** MIME type of an image file name, by extension (PNG when unknown). */
export function textureMime(name: string): string {
	return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "image/png";
}

/**
 * Reads a texture a model file refers to. Exporters often write absolute
 * paths from the author's machine (`C:\Users\…\wood.png`), so after the
 * path as written (relative to `basePath`), the file name is also tried in
 * `basePath`, its `textures/` folder and any `*.fbm` folder next to it.
 */
export function readTextureFile(
	ref: string,
	basePath: string | undefined,
): TextureFile | undefined {
	if (!ref || typeof fs === "undefined" || !fs.existsSync) return undefined;
	let cleaned = ref.trim().replace(/^file:\/\//, "");
	try {
		cleaned = decodeURIComponent(cleaned);
	} catch (_) {}
	const normalized = cleaned.replace(/\\/g, "/");
	const fileName = normalized.split("/").pop() ?? normalized;

	const candidates: string[] = [];
	if (path.isAbsolute(normalized)) candidates.push(normalized);
	if (basePath) {
		candidates.push(path.resolve(basePath, normalized));
		candidates.push(path.join(basePath, fileName));
		candidates.push(path.join(basePath, "textures", fileName));
		try {
			for (const entry of fs.readdirSync(basePath)) {
				if (entry.toLowerCase().endsWith(".fbm"))
					candidates.push(path.join(basePath, entry, fileName));
			}
		} catch (_) {}
	}

	for (const file of candidates) {
		try {
			if (fs.existsSync(file) && fs.statSync(file).isFile()) {
				return {
					bytes: new Uint8Array(fs.readFileSync(file)),
					mime: textureMime(file),
				};
			}
		} catch (_) {}
	}
	return undefined;
}

/** Warns that a model's texture could not be found (the mesh renders untextured). */
export function warnMissingTexture(
	loader: string,
	material: string,
	ref: string,
): void {
	console.warn(
		`[${loader}] Texture "${ref}" for material "${material}" was not found; the material renders without it.`,
	);
}
