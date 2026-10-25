/**
 * Fonts the CLI installs into a project: a catalog of pinned files (URL,
 * size, SHA-256, license), the installer `framefields add` and
 * `framefields fonts add` share, and the generated `fonts.ts` module that
 * registers whatever is installed.
 *
 * framefields ships no fonts in its package (a color emoji font alone is
 * ~10 MB); they're fetched when a project needs one, verified byte for byte,
 * and saved with their license next to them.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { readConfig, writeConfig } from "./config.js";

/** A downloadable file, pinned by size and hash. */
interface PinnedFile {
	url: string;
	sha256: string;
	bytes: number;
}

export interface FontSpec {
	/** What it's for, in a sentence: shown by `fonts list`. */
	label: string;
	/** File name it's saved under. */
	file: string;
	font: PinnedFile;
	license: PinnedFile & {
		/** SPDX id. */
		id: string;
		/** File name it's saved under, next to the font. */
		file: string;
	};
	/**
	 * How it registers: as the color emoji font, or as a text family under
	 * this name (the name themes use: `Inter`, `JetBrains Mono`).
	 */
	register: { emoji: true } | { family: string };
}

const NOTO_EMOJI =
	"https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.051";
/** google/fonts at one commit: Inter and JetBrains Mono. */
const GOOGLE_FONTS =
	"https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0";

/** Installable fonts by role. */
export const FONTS: Record<string, FontSpec> = {
	emoji: {
		label: "Noto Color Emoji 2.051: color emoji in any text (🎉 ❤️ 👍)",
		file: "NotoColorEmoji.ttf",
		font: {
			url: `${NOTO_EMOJI}/fonts/NotoColorEmoji.ttf`,
			sha256:
				"72a635cb3d2f3524c51620cdde406b217204e8a6a06c6a096ff8ed4b5fd6e27b",
			bytes: 10_673_480,
		},
		license: {
			id: "OFL-1.1",
			file: "NotoColorEmoji-OFL.txt",
			url: `${NOTO_EMOJI}/fonts/LICENSE`,
			sha256:
				"6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
			bytes: 4_301,
		},
		register: { emoji: true },
	},
	sans: googleFont({
		label: "Inter 4: the built-in themes' display and body face",
		file: "Inter.ttf",
		family: "Inter",
		path: "ofl/inter/Inter%5Bopsz,wght%5D.ttf",
		sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
		bytes: 876_576,
		license: {
			path: "ofl/inter/OFL.txt",
			sha256:
				"5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
			bytes: 4_377,
		},
	}),
	mono: googleFont({
		label: "JetBrains Mono 2: the built-in themes' code and terminal face",
		file: "JetBrainsMono.ttf",
		family: "JetBrains Mono",
		path: "ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
		sha256: "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
		bytes: 187_208,
		license: {
			path: "ofl/jetbrainsmono/OFL.txt",
			sha256:
				"b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d",
			bytes: 4_399,
		},
	}),
};

/** google/fonts, pinned to one commit. */
function googleFont(o: {
	label: string;
	file: string;
	family: string;
	path: string;
	sha256: string;
	bytes: number;
	license: { path: string; sha256: string; bytes: number };
}): FontSpec {
	const at = (path: string) => `${GOOGLE_FONTS}/${path}`;
	return {
		label: o.label,
		file: o.file,
		font: { url: at(o.path), sha256: o.sha256, bytes: o.bytes },
		license: {
			url: at(o.license.path),
			sha256: o.license.sha256,
			bytes: o.license.bytes,
			id: "OFL-1.1",
			file: o.file.replace(/\.ttf$/, "-OFL.txt"),
		},
		register: { family: o.family },
	};
}

/** Where fonts go when `framefields.json` names no place: the setup skill's layout. */
export const DEFAULT_FONTS_DIR = "assets/fonts";

export type Fetch = (url: string) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface FontInstallOptions {
	cwd: string;
	/** Folder for new font files, relative to `cwd`. Default `assets/fonts`. */
	dir?: string;
	/** Replace a different file already at the target path. */
	overwrite?: boolean;
	/** For tests; default the global `fetch`. */
	fetch?: Fetch;
	/** For tests; default {@link FONTS}. */
	catalog?: Record<string, FontSpec>;
	/** Called before a download starts (for progress messages). */
	onDownload?: (spec: FontSpec) => void;
}

export interface FontInstall {
	role: string;
	/** Relative to the project root. */
	path: string;
	/**
	 * `installed`: downloaded now. `present`: the pinned file was already
	 * there. `configured`: `framefields.json` already names a font for the role.
	 */
	status: "installed" | "present" | "configured";
}

const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

/** A project-relative path with forward slashes, as `framefields.json` keeps it. */
const projectPath = (cwd: string, path: string) =>
	relative(cwd, path).split(sep).join(posix.sep);

/** Install the font for `role` into the project and record it in `framefields.json`. */
export async function installFont(
	role: string,
	options: FontInstallOptions,
): Promise<FontInstall> {
	const catalog = options.catalog ?? FONTS;
	const spec = catalog[role];
	if (!spec)
		throw new Error(
			`Unknown font "${role}". Fonts framefields can install: ${Object.keys(catalog).join(", ")}.`,
		);
	const { cwd } = options;
	const { config } = readConfig(cwd);
	const configured = config.fonts?.[role];
	if (configured && existsSync(resolve(cwd, configured)))
		return { role, path: configured, status: "configured" };

	const target = resolve(cwd, options.dir ?? DEFAULT_FONTS_DIR, spec.file);
	const path = projectPath(cwd, target);
	let status: FontInstall["status"] = "present";
	const current = existsSync(target) ? readFileSync(target) : null;
	if (!current || sha256(current) !== spec.font.sha256) {
		if (current && !options.overwrite)
			throw new Error(
				`${path} exists but isn't the pinned ${spec.file}. Pass --overwrite to replace it, or point "fonts.${role}" in framefields.json at it to keep using yours.`,
			);
		options.onDownload?.(spec);
		const get = options.fetch ?? (fetch as unknown as Fetch);
		const [font, license] = await Promise.all([
			download(spec.font, get),
			download(spec.license, get),
		]);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, font);
		writeFileSync(join(dirname(target), spec.license.file), license);
		status = "installed";
	}
	writeConfig(cwd, {
		...config,
		fonts: { ...config.fonts, [role]: path },
	});
	return { role, path, status };
}

async function download(file: PinnedFile, get: Fetch): Promise<Uint8Array> {
	let res: Awaited<ReturnType<Fetch>>;
	try {
		res = await get(file.url);
	} catch (error) {
		throw new Error(
			`Couldn't download ${file.url} (${error instanceof Error ? error.message : String(error)}). Check the connection, or download it yourself and point framefields.json "fonts" at it.`,
		);
	}
	if (!res.ok) throw new Error(`${file.url}: ${res.status} ${res.statusText}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const hash = sha256(bytes);
	if (bytes.length !== file.bytes || hash !== file.sha256)
		throw new Error(
			`${file.url} isn't the pinned file (got ${bytes.length} bytes, sha256 ${hash}; expected ${file.bytes}, ${file.sha256}). Nothing was written.`,
		);
	return bytes;
}

/** First line of the generated module: files without it are the user's and left alone. */
export const FONTS_MODULE_MARKER =
	"// Generated by framefields from framefields.json.";

export interface FontsModule {
	/** Relative to the project root. */
	path: string;
	/** `skipped`: the file exists without the marker, so it's the user's. */
	status: "written" | "unchanged" | "skipped";
	/** The registration calls, one line each, for printing when `skipped`. */
	calls: string[];
}

/**
 * Write `<components>/fonts.ts`, which registers every font in
 * `framefields.json`. Call it once before building or rendering:
 * `await registerFonts()`.
 */
export function writeFontsModule(
	cwd: string,
	componentsDir: string,
	catalog: Record<string, FontSpec> = FONTS,
): FontsModule {
	const { config } = readConfig(cwd);
	const target = join(componentsDir, "fonts.ts");
	const path = projectPath(cwd, target);
	const fonts = Object.entries(config.fonts ?? {})
		.filter(([role]) => catalog[role])
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([role, file]) => {
			const from = relative(componentsDir, resolve(cwd, file as string))
				.split(sep)
				.join(posix.sep);
			const url = from.startsWith(".") ? from : `./${from}`;
			return { register: (catalog[role] as FontSpec).register, url };
		});
	const call = (r: FontSpec["register"], source: string) =>
		"family" in r
			? `register({ family: ${JSON.stringify(r.family)}, source: ${source} })`
			: `registerEmojiFont(${source})`;
	const calls = fonts.map(
		(f) => `await FontManager.${call(f.register, `asset("${f.url}")`)};`,
	);
	const content = `${FONTS_MODULE_MARKER}
// \`framefields add\` and \`framefields fonts add\` rewrite it when fonts
// change; register any other fonts in your own code.
import { FontManager } from "framefields";

/** A path next to this file as a URL: works in Node and in the browser preview. */
const asset = (path: string) => new URL(path, import.meta.url).href;

/**
 * Register the fonts this project installed with framefields. Call it
 * once, before building any text or rendering:
 *
 * \`\`\`ts
 * await registerFonts();
 * \`\`\`
 */
export async function registerFonts(): Promise<void> {
${fonts
	// Wrapped the way Biome / Prettier would at 80 columns.
	.map((f) =>
		"family" in f.register
			? `\tawait FontManager.register({\n\t\tfamily: ${JSON.stringify(f.register.family)},\n\t\tsource: asset("${f.url}"),\n\t});`
			: `\tawait FontManager.registerEmojiFont(\n\t\tasset("${f.url}"),\n\t);`,
	)
	.join("\n")}
}
`;
	if (existsSync(target)) {
		const current = readFileSync(target, "utf8");
		if (current === content) return { path, status: "unchanged", calls };
		if (!current.startsWith(FONTS_MODULE_MARKER))
			return { path, status: "skipped", calls };
	}
	mkdirSync(componentsDir, { recursive: true });
	writeFileSync(target, content);
	return { path, status: "written", calls };
}

/**
 * A hint when fonts land in a Git repo whose `.gitattributes` doesn't send
 * them to LFS (a 10 MB binary bloats every clone), or null.
 */
export function lfsHint(cwd: string, fontPath: string): string | null {
	if (!existsSync(join(cwd, ".git"))) return null;
	const attrs = join(cwd, ".gitattributes");
	const text = existsSync(attrs) ? readFileSync(attrs, "utf8") : "";
	if (/\.ttf\b[^\n]*filter=lfs/.test(text)) return null;
	const dir = posix.dirname(fontPath);
	return `Fonts are large binaries: track them with Git LFS, e.g. \`git lfs track "${dir}/**/*.ttf"\`.`;
}
