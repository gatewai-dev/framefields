/**
 * Builds the library as a static registry folder:
 *
 *   pnpm --filter @framefields/library library [name…] [--pin] [--no-previews | --fresh]
 *
 *   dist/index.json              every entry (what search and the cards read)
 *   dist/<name>.json             each item; dist/<name>@<version>.json pins one
 *   dist/files/<sha256>.<ext>    media and previews, by content (immutable)
 *
 * Code items are the component registry's templates, shaders and VFX (build
 * @framefields/components first); plain components stay out, since agents
 * find and add those themselves (`framefields list`). Media items come from
 * `catalog/`. Downloads are verified against their
 * pinned sha256 (`--pin` records it on first download), audio is analysed
 * with the engine, previews are rendered by it. Media and previews are cached
 * under `.cache/`, keyed by content, so a rebuild renders only what changed.
 * The key can't see the engine itself: after an engine change that alters
 * how previews look, `--fresh` renders every preview again.
 * The API repo's `scripts/publish-library.mjs` uploads `dist` to R2.
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Composition } from "framefields";
import { analyzeAudio } from "framefields/components";
import { FontManager } from "framefields/fonts";
import {
	KIND_LABELS,
	type LibraryAsset,
	type LibraryFacets,
	type LibraryPreview,
	type RegistryEntry,
	type RegistryItem,
} from "framefields/library";
import { ANALYSIS_FPS, reportAudio } from "./analyze.js";
import { type CatalogEntry, readCatalog } from "./catalog.js";
import { mediaModule } from "./module.js";
import {
	FPS,
	HDRI_HEIGHT,
	HDRI_WIDTH,
	hdriScene,
	type RenderedPreview,
	renderPreview,
} from "./previews.js";
import { SHOT_HEIGHT, SHOT_WIDTH, SHOTS } from "./shots.js";
import { encodeWav, synthesize } from "./synth.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = join(ROOT, "catalog");
const CACHE = join(ROOT, ".cache");
const OUT = join(ROOT, "dist");
const REGISTRY = join(ROOT, "../components/dist/registry");
const AUDIO_KINDS = new Set(["music", "sfx", "ambience"]);

const sha256 = (data: Buffer | string) =>
	createHash("sha256").update(data).digest("hex");

/** Content-addressed files: cached across builds, copied into `dist/files`. */
class Files {
	private readonly store = join(CACHE, "files");
	constructor(private readonly out: string) {
		mkdirSync(this.store, { recursive: true });
		mkdirSync(join(out, "files"), { recursive: true });
	}
	/** Stores `data`; returns its library path (`files/<sha>.<ext>`). */
	put(
		data: Buffer,
		ext: string,
	): { path: string; sha256: string; size: number } {
		const hash = sha256(data);
		const name = `${hash}.${ext}`;
		const cached = join(this.store, name);
		if (!existsSync(cached)) writeFileSync(cached, data);
		return this.link(name, hash, data.length);
	}
	/** A file already in the store, by name. */
	has(name: string): boolean {
		return existsSync(join(this.store, name));
	}
	link(name: string, hash: string, size: number) {
		const target = join(this.out, "files", name);
		if (!existsSync(target)) copyFileSync(join(this.store, name), target);
		return { path: `files/${name}`, sha256: hash, size };
	}
	read(name: string): Buffer {
		return readFileSync(join(this.store, name));
	}
}

interface PreviewRecord {
	poster: string;
	clip: string;
	aspect: number;
	color: string;
}

/** Renders a preview once per `key`; later builds reuse the stored files. */
/** Whether previews render: never, reusing cached ones, or all of them again. */
type PreviewMode = "off" | "cached" | "fresh";

async function cachedPreview(
	files: Files,
	key: string,
	mode: PreviewMode,
	render: () => Promise<RenderedPreview>,
): Promise<LibraryPreview> {
	const record = join(CACHE, "previews", `${key}.json`);
	if (mode === "cached" && existsSync(record)) {
		const r = JSON.parse(readFileSync(record, "utf8")) as PreviewRecord;
		const name = (p: string) => p.slice("files/".length);
		if (files.has(name(r.poster)) && files.has(name(r.clip))) {
			for (const p of [r.poster, r.clip]) {
				const data = files.read(name(p));
				files.link(name(p), sha256(data), data.length);
			}
			return r;
		}
	}
	const rendered = await render();
	const r: PreviewRecord = {
		poster: files.put(rendered.poster, "webp").path,
		clip: files.put(rendered.clip, "mp4").path,
		aspect: rendered.aspect,
		color: rendered.color,
	};
	mkdirSync(dirname(record), { recursive: true });
	writeFileSync(record, `${JSON.stringify(r)}\n`);
	return r;
}

/** Each source file's own hash: a preview re-renders when the code drawing it changes. */
const PREVIEW_CODE = sha256(
	["shots.ts", "previews.ts"]
		.map((f) => readFileSync(join(ROOT, "src", f), "utf8"))
		.join("\0"),
);

/**
 * The component registry's templates, shaders and VFX, licensed and
 * previewed. Their dependencies (plain components) install from the
 * registry bundled with framefields, which `add` reads before the library.
 */
async function codeItems(
	files: Files,
	previews: PreviewMode,
): Promise<RegistryItem[]> {
	if (!existsSync(join(REGISTRY, "index.json")))
		throw new Error(
			`${REGISTRY} is missing: run \`pnpm --filter @framefields/components build\` first.`,
		);
	const index = JSON.parse(
		readFileSync(join(REGISTRY, "index.json"), "utf8"),
	) as RegistryEntry[];
	const items: RegistryItem[] = [];
	for (const entry of index) {
		if ((entry.kind ?? "component") === "component") continue;
		const item = JSON.parse(
			readFileSync(join(REGISTRY, `${entry.name}.json`), "utf8"),
		) as RegistryItem;
		const shot = SHOTS[item.name];
		let preview: LibraryPreview | undefined;
		if (shot && previews !== "off") {
			const key = sha256(`${PREVIEW_CODE}\0${JSON.stringify(item.files)}`);
			preview = await cachedPreview(files, key, previews, () => {
				console.log(`  rendering ${item.name}`);
				const scene = () =>
					new Composition({
						width: SHOT_WIDTH,
						height: SHOT_HEIGHT,
						fps: FPS,
						durationFrames: shot.frames,
						backgroundColor: "#0d0e11",
					}).add(shot.build());
				// Shots are laid out in pixels: no supersampling.
				return renderPreview(
					scene,
					shot.poster,
					{ width: SHOT_WIDTH, height: SHOT_HEIGHT },
					1,
				);
			});
		}
		items.push({
			...item,
			kind: item.kind,
			license: { id: "Apache-2.0", commercial: true },
			...(preview && { preview }),
		});
	}
	return items;
}

/** The entry's bytes: the pinned download (verified), or its synth recipe. */
async function mediaBytes(
	entry: CatalogEntry,
	pin: boolean,
): Promise<{ data: Buffer; ext: string }> {
	if (entry.synth)
		return { data: encodeWav(synthesize(entry.synth)), ext: "wav" };
	const source = entry.source;
	if (!source) throw new Error(`${entry.file}: no source`);
	const cached =
		source.sha256 && join(CACHE, "media", `${source.sha256}.${source.ext}`);
	if (cached && existsSync(cached))
		return { data: readFileSync(cached), ext: source.ext };
	console.log(`  downloading ${source.url}`);
	const res = await fetch(source.url);
	if (!res.ok)
		throw new Error(
			`${entry.file}: ${source.url}: ${res.status} ${res.statusText}`,
		);
	const data = Buffer.from(await res.arrayBuffer());
	const hash = sha256(data);
	if (source.sha256 && source.sha256 !== hash)
		throw new Error(
			`${entry.file}: ${source.url} does not match its pinned sha256 (got ${hash})`,
		);
	if (!source.sha256) {
		if (!pin)
			throw new Error(
				`${entry.file}: no sha256 pinned. Check the download, then run with --pin to record ${hash}.`,
			);
		const raw = JSON.parse(readFileSync(entry.file, "utf8"));
		raw.source = { ...raw.source, sha256: hash, size: data.length };
		writeFileSync(entry.file, `${JSON.stringify(raw, null, "\t")}\n`);
		console.log(`  pinned ${entry.name}: ${hash}`);
	}
	mkdirSync(join(CACHE, "media"), { recursive: true });
	writeFileSync(join(CACHE, "media", `${hash}.${source.ext}`), data);
	return { data, ext: source.ext };
}

/** A Radiance `.hdr` header's size (`-Y 1024 +X 2048`). */
function hdrSize(data: Buffer): { width: number; height: number } | undefined {
	const head = data.subarray(0, 4096).toString("latin1");
	const m = /\n-Y (\d+) \+X (\d+)\n/.exec(head);
	return m ? { width: Number(m[2]), height: Number(m[1]) } : undefined;
}

/** How code uses an item of `kind`, for the card and `framefields list`. */
function exampleFor(kind: string, name: string): string {
	if (AUDIO_KINDS.has(kind)) return `Layer.audio(${name}.src)`;
	if (kind === "hdri") return `Layer.environment({ hdri: ${name}.src })`;
	if (kind === "footage" || kind === "background" || kind === "overlay")
		return `Layer.video(${name}.src)`;
	return `${name}.src`;
}

async function mediaItem(
	entry: CatalogEntry,
	files: Files,
	opts: { pin: boolean; previews: PreviewMode },
): Promise<RegistryItem> {
	const { data, ext } = await mediaBytes(entry, opts.pin);
	const stored = files.put(data, ext);
	const slug = entry.name.slice(entry.kind.length + 1);
	const assetPath = `${entry.kind}/${slug}.${ext}`;
	const asset: LibraryAsset = {
		path: assetPath,
		sha256: stored.sha256,
		size: stored.size,
		url: stored.path,
	};
	const facets: LibraryFacets = { ...(entry.loop && { loop: true }) };
	let analysis: RegistryItem["analysis"] = {};
	let preview: LibraryPreview = {};
	let start: number | undefined;
	if (AUDIO_KINDS.has(entry.kind)) {
		const file = join(CACHE, "files", stored.path.slice("files/".length));
		const levels = await analyzeAudio(file, { fps: ANALYSIS_FPS });
		const report = reportAudio(levels, entry.kind === "music");
		analysis = report.analysis;
		start = report.start;
		preview = {
			audio: stored.path,
			peaks: report.peaks,
			...(start && { start }),
		};
		facets.duration = analysis.duration;
		if (analysis.bpm !== undefined) facets.bpm = analysis.bpm;
	} else if (entry.kind === "hdri") {
		const size = hdrSize(data);
		if (size) {
			analysis = size;
			facets.width = size.width;
			facets.height = size.height;
		}
		if (opts.previews !== "off") {
			const key = sha256(`${PREVIEW_CODE}\0${stored.sha256}`);
			preview = await cachedPreview(files, key, opts.previews, () => {
				console.log(`  rendering ${entry.name}`);
				const src = join(
					CACHE,
					"files",
					stored.path.slice("files/".length),
				) as `${string}.hdr`;
				return renderPreview((size) => hdriScene(src, size), FPS, {
					width: HDRI_WIDTH,
					height: HDRI_HEIGHT,
				});
			});
		}
	}
	const module = mediaModule({
		kind: entry.kind,
		slug,
		title: entry.title,
		kindLabel: KIND_LABELS[entry.kind],
		license: entry.license,
		assetPath,
		analysis,
		start,
		loop: entry.loop,
	});
	return {
		name: entry.name,
		title: module.title,
		label: entry.title,
		summary: entry.summary,
		tags: entry.tags,
		example: exampleFor(entry.kind, module.title),
		registryDependencies: [],
		kind: entry.kind,
		version: entry.version,
		license: entry.license,
		preview,
		facets,
		parts: [],
		cues: [],
		files: [{ path: module.path, content: module.content }],
		assets: [asset],
		analysis,
	};
}

/** What `index.json` lists per item: everything but code, media and analysis. */
function entryOf(item: RegistryItem): RegistryEntry {
	const {
		props: _p,
		parts: _pa,
		cues: _c,
		fonts: _f,
		files: _fi,
		assets: _a,
		analysis: _an,
		...entry
	} = item;
	return entry;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const pin = args.includes("--pin");
	const previews: PreviewMode = args.includes("--no-previews")
		? "off"
		: args.includes("--fresh")
			? "fresh"
			: "cached";
	const only = new Set(args.filter((a) => !a.startsWith("--")));
	rmSync(OUT, { recursive: true, force: true });
	const files = new Files(OUT);
	// The theme's families, from the repo's local fonts (as the gallery does).
	const fonts = join(ROOT, "../../assets/fonts");
	await FontManager.register(join(fonts, "Inter.ttf"));
	await FontManager.register(join(fonts, "JetBrainsMono.ttf"));
	console.log("library: components");
	const code = await codeItems(files, previews);
	console.log("library: catalog");
	const media: RegistryItem[] = [];
	for (const entry of readCatalog(CATALOG)) {
		if (only.size > 0 && !only.has(entry.name)) continue;
		console.log(`  ${entry.name}`);
		media.push(await mediaItem(entry, files, { pin, previews }));
	}
	const items = [...code, ...media].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const item of items) {
		writeJson(join(OUT, `${item.name}.json`), item);
		if (item.version !== undefined)
			writeJson(join(OUT, `${item.name}@${item.version}.json`), item);
	}
	writeJson(join(OUT, "index.json"), items.map(entryOf));
	const pictured = items.filter(
		(i) => i.preview?.poster || i.preview?.audio,
	).length;
	console.log(
		`library: ${items.length} items (${code.length} code, ${media.length} media; ${pictured} with previews) in ${OUT}`,
	);
}

await main();
// The GPU device keeps the event loop alive once rendering is done.
process.exit(0);
