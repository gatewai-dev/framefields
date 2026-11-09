/**
 * Builds a web bundle: a static folder that renders one composition on the
 * viewer's device with no Node server behind it, e.g. inside an iOS app's
 * WKWebView. It holds the browser engine (`engine/`), the composition's code
 * (`project.mjs`), the files the composition reads (`files/`), a manifest
 * mapping the paths the composition reads to those files, and a page that
 * exports the film (`index.html`).
 *
 * The composition is built once here, in Node, to learn what it reads: every
 * local path in its tree that exists, its registered fonts, the font files of
 * the families it names, and whatever `include` adds (files read at run time
 * that the tree doesn't name). Paths are rewritten relative to the project
 * root, so the bundle names no folder of the machine that built it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameCount, type VirtualMediaData } from "@framefields/core";
import { SlugFontCache } from "@framefields/webgpu-renderers";
import { FontManager } from "../fonts/index.js";
import {
	bundleWebProject,
	engineDir,
	isInsideRoot,
	virtualPath,
} from "../preview/bundle.js";
import { loadTarget, repoRoot } from "../preview/project.js";
import { webBundlePage } from "./page.js";
import type { WebBundleFile, WebBundleManifest } from "./types.js";

export interface WebBundleOptions {
	/** Module that exports the composition (or a function returning it). */
	entry: string | URL;
	/** The export to render. Default `"default"`. */
	export?: string;
	/** Folder to write; replaced if it holds an earlier bundle, refused if it holds anything else. */
	outDir: string;
	/**
	 * The project folder: it becomes `/` for the composition's paths. Default:
	 * the nearest `.git`, else the nearest `package.json`, as the preview finds it.
	 */
	root?: string;
	/**
	 * Files or folders the composition reads while it builds or renders that
	 * its tree doesn't name (JSON it parses, a model it loads by name).
	 * Relative to the working directory.
	 */
	include?: string[];
	/** Shown on the bundle's page. Default: the entry's file name. */
	title?: string;
}

export interface WebBundleResult {
	outDir: string;
	manifest: WebBundleManifest;
	/** Bytes written, engine included. */
	bytes: number;
	/** Files kept outside the project root, and fonts that were not found. */
	warnings: string[];
}

export async function buildWebBundle(
	options: WebBundleOptions,
): Promise<WebBundleResult> {
	const entry =
		options.entry instanceof URL || String(options.entry).startsWith("file:")
			? fileURLToPath(options.entry)
			: path.resolve(String(options.entry));
	const exportName = options.export ?? "default";
	const root = path.resolve(options.root ?? repoRoot(path.dirname(entry)));
	const outDir = path.resolve(options.outDir);
	const warnings: string[] = [];
	prepareOutDir(outDir);

	// Built here once: its build-time code may write the files it reads.
	const target = await loadTarget(entry, exportName);
	const vm = target.toVirtualMediaAsync
		? await target.toVirtualMediaAsync()
		: target.toVirtualMedia?.();
	if (!vm) throw new Error(`"${exportName}" in ${entry} is not a composition.`);
	const fps = vm.metadata?.fps ?? target.fps ?? 30;
	const durationMs =
		vm.metadata?.durationMs && vm.metadata.durationMs > 0
			? vm.metadata.durationMs
			: ((await target.computeDuration?.()) ?? target.durationMs ?? 5000);

	const cwd = process.cwd();
	const files = new Map<string, string>(); // bundle path -> file on disk
	const add = (file: string, at?: string) => {
		const where = at ?? virtualPath(root, file);
		if (files.has(where)) return;
		files.set(where, file);
		if (!at && !isInsideRoot(root, file))
			warnings.push(`${file} is outside ${root}; it keeps its absolute path`);
	};
	for (const file of localFiles(vm)) add(file);
	for (const font of FontManager.getRegisteredFontPaths()) {
		const file = path.resolve(cwd, font);
		if (isFile(file)) add(file);
	}
	const emoji = SlugFontCache.emojiFontPath;
	if (emoji && isFile(emoji)) add(path.resolve(emoji));
	for (const family of unregisteredFamilies(vm)) {
		const file = findFamilyFont(cwd, family);
		// Loaded from `assets/fonts/<Family>.ttf` under the working directory.
		const at = path.posix.join(
			virtualPath(root, cwd),
			"assets/fonts",
			`${family}.ttf`,
		);
		if (file) add(file, at);
		else warnings.push(`no font file for "${family}" in assets/fonts`);
	}
	for (const extra of options.include ?? []) {
		for (const file of walk(path.resolve(cwd, extra))) add(file);
	}

	const engine = await engineDir();
	fs.cpSync(engine, path.join(outDir, "engine"), { recursive: true });
	const project = await bundleWebProject({
		entry,
		exportName,
		root,
		engineDir: "engine",
	});
	fs.writeFileSync(path.join(outDir, "project.mjs"), project.code);

	const manifestFiles: Record<string, WebBundleFile> = {};
	const id = createHash("sha256").update(project.code);
	for (const name of listFiles(path.join(outDir, "engine")).sort())
		id.update(name).update(fs.readFileSync(name));
	for (const at of [...files.keys()].sort()) {
		const file = files.get(at) as string;
		const url = `files${at}`;
		const dest = path.join(outDir, ...url.split("/"));
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(file, dest);
		const bytes = fs.readFileSync(dest);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		manifestFiles[at] = { url: encodeURI(url), size: bytes.length, sha256 };
		id.update(at).update(sha256);
	}

	const manifest: WebBundleManifest = {
		format: 1,
		id: id.digest("hex").slice(0, 24),
		title: options.title ?? path.basename(entry).replace(/\.[^.]+$/, ""),
		export: exportName,
		width: Math.round(vm.metadata?.width ?? target.width ?? 1920),
		height: Math.round(vm.metadata?.height ?? target.height ?? 1080),
		fps,
		frameCount: frameCount(durationMs, fps),
		durationMs,
		cwd: virtualPath(root, cwd),
		files: manifestFiles,
	};
	fs.writeFileSync(
		path.join(outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	fs.writeFileSync(path.join(outDir, "index.html"), webBundlePage(manifest));

	const bytes = listFiles(outDir).reduce((n, f) => n + fs.statSync(f).size, 0);
	return { outDir, manifest, bytes, warnings };
}

/** An empty folder to write into: an earlier bundle is replaced, other content refused. */
function prepareOutDir(outDir: string): void {
	if (fs.existsSync(outDir)) {
		const entries = fs.readdirSync(outDir);
		const earlier = entries.includes("manifest.json");
		if (entries.length > 0 && !earlier)
			throw new Error(
				`${outDir} is not empty and holds no web bundle; pick an empty or new folder.`,
			);
		fs.rmSync(outDir, { recursive: true, force: true });
	}
	fs.mkdirSync(outDir, { recursive: true });
}

/** Every existing local file a string in the tree names (absolute paths and `file://` URLs). */
function localFiles(vm: VirtualMediaData): Set<string> {
	const found = new Set<string>();
	const seen = new Set<unknown>();
	const visit = (value: unknown): void => {
		if (typeof value === "string") {
			const file = value.startsWith("file://")
				? safeFileUrl(value)
				: path.isAbsolute(value) && !value.startsWith("//")
					? value
					: undefined;
			if (file && isFile(file)) found.add(path.resolve(file));
			return;
		}
		if (!value || typeof value !== "object" || seen.has(value)) return;
		seen.add(value);
		for (const v of Array.isArray(value) ? value : Object.values(value))
			visit(v);
	};
	visit(vm);
	return found;
}

/** Font families text in the tree names that no font was registered for. */
function unregisteredFamilies(vm: VirtualMediaData): Set<string> {
	const families = new Set<string>();
	(function walkTree(node: VirtualMediaData) {
		const op = node.operation as Record<string, unknown> | undefined;
		if (op) {
			const isText =
				op.op === "text" ||
				op.kind === "text" ||
				op.op === "caption" ||
				op.kind === "caption" ||
				typeof op.text === "string";
			const family = (op.fontFamily as string) || (isText ? "Inter" : "");
			if (family && !FontManager.has(family)) families.add(family);
		}
		for (const child of node.children ?? []) walkTree(child);
	})(vm);
	return families;
}

/** `assets/fonts/<Family>.ttf|otf` in the working directory or a parent, as the Node loader looks. */
function findFamilyFont(cwd: string, family: string): string | undefined {
	const clean = family.replace(/['"]/g, "").trim();
	const names = [clean, clean.replace(/ /g, ""), clean.replace(/ /g, "_")];
	let dir = cwd;
	for (let i = 0; i < 5; i++) {
		for (const name of names)
			for (const ext of [".ttf", ".otf"]) {
				const file = path.join(dir, "assets", "fonts", `${name}${ext}`);
				if (isFile(file)) return fs.realpathSync(file);
			}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

function walk(target: string): string[] {
	if (!fs.existsSync(target))
		throw new Error(`include: ${target} does not exist.`);
	return fs.statSync(target).isDirectory() ? listFiles(target) : [target];
}

function listFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => path.join(e.parentPath, e.name));
}

function isFile(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function safeFileUrl(url: string): string | undefined {
	try {
		return fileURLToPath(url);
	} catch {
		return undefined;
	}
}
