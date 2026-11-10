/// <reference lib="dom" />
/// <reference types="webgpu" />
/**
 * The on-device export, as it runs inside a web bundle (`engine/web.mjs`):
 * opens the bundle (its manifest, its files, its composition) and renders
 * MP4s from it with the page's WebGPU and WebCodecs. Part of the browser
 * engine (preview/bundle.ts), so the composition it renders and the engine
 * drawing it are one set of modules.
 */
import { BUILTIN_NODE_RENDERERS } from "framefields-preview:renderers";
import { setLocalFileSource, type VirtualMediaData } from "@framefields/core";
import type { AudioTarget } from "../../preview/audio-mixer.js";
import { registerRenderers } from "../../preview/register.js";
import { process } from "../../preview/shims/process.js";
import {
	type ExportSettings,
	exportJobId,
	OUTPUT_FILE,
	runExportJob,
} from "../export-job.js";
import { MemoryQueueState, RenderQueue } from "../queue.js";
import {
	type ExportStore,
	MemoryExportStore,
	OpfsExportStore,
	OpfsQueueState,
} from "../store.js";
import type {
	WebBundle,
	WebBundleManifest,
	WebExportOptions,
	WebExportResult,
} from "../types.js";
import { createBrowserBackend } from "./backend.js";

export type * from "../types.js";

type Exported = AudioTarget & { fps?: number };

let opened: { base: string; bundle: Promise<WebBundle> } | undefined;

/**
 * Opens the bundle at `base` (the folder holding `manifest.json`; by default
 * the one this engine sits in). A page has one bundle: its files are what
 * the composition's paths resolve to.
 */
export function openBundle(
	base: string | URL = new URL("../", import.meta.url),
): Promise<WebBundle> {
	const href = new URL(String(base), location.href).href;
	const root = href.endsWith("/") ? href : `${href}/`;
	if (opened && opened.base !== root)
		throw new Error(
			`This page already opened the bundle at ${opened.base}; open ${root} in its own page.`,
		);
	opened ??= { base: root, bundle: load(root) };
	opened.bundle.catch(() => {
		opened = undefined;
	});
	return opened.bundle;
}

async function load(base: string): Promise<WebBundle> {
	if (!("gpu" in navigator))
		throw new Error(
			"This browser has no WebGPU (Safari 26 / iOS 26 or later).",
		);
	const response = await fetch(new URL("manifest.json", base));
	if (!response.ok)
		throw new Error(
			`No web bundle at ${base} (manifest.json: ${response.status}).`,
		);
	const manifest = (await response.json()) as WebBundleManifest;
	if (manifest.format !== 1)
		throw new Error(`Unsupported web bundle format ${manifest.format}.`);

	// The composition's paths name the bundle's copies of its files.
	setLocalFileSource({
		cwd: manifest.cwd,
		url: (path) => {
			const file = manifest.files[path];
			return file ? new URL(file.url, base).href : undefined;
		},
		size: (path) => manifest.files[path]?.size,
	});
	process.chdir(manifest.cwd);
	await registerRenderers(BUILTIN_NODE_RENDERERS);

	const mod = (await import(
		/* @vite-ignore */ new URL("project.mjs", base).href
	)) as { composition?: unknown };
	if (mod.composition === undefined)
		throw new Error(`The bundle's project has no export "${manifest.export}".`);
	const exported = mod.composition;

	const queue = await RenderQueue.open(
		{
			jobId: (options) => exportJobId(settingsFor(manifest, options)),
			run: (render, control) =>
				exportOnce(manifest, exported, { ...render.options, ...control }),
			file: async (render) =>
				OpfsExportStore.available()
					? (await OpfsExportStore.open(render.jobId)).file(OUTPUT_FILE)
					: undefined,
			discard: async (render) => {
				if (OpfsExportStore.available())
					await OpfsExportStore.removeJob(render.jobId);
			},
		},
		OpfsExportStore.available()
			? new OpfsQueueState(`queue-${manifest.id}.json`)
			: new MemoryQueueState(),
	);
	return {
		manifest,
		queue,
		exportVideo: (options) => exportThroughQueue(queue, options),
		async clearExports() {
			await queue.clear();
			await OpfsExportStore.clearAll();
		},
	};
}

/**
 * The single-render call: a queue of one. It enqueues (or joins the same
 * render already in line) and waits; aborting `signal` takes it out of line
 * but keeps its chunks, so the same call later resumes.
 */
async function exportThroughQueue(
	queue: RenderQueue,
	options: WebExportOptions = {},
): Promise<WebExportResult> {
	const { signal, onProgress, ...rest } = options;
	signal?.throwIfAborted();
	const id = await queue.enqueue(rest);
	const unsubscribe = queue.subscribe((event) => {
		if (event.id === id && event.type === "progress" && event.render.progress)
			onProgress?.(event.render.progress);
	});
	const stop = () => void queue.cancel(id, { discard: false });
	signal?.addEventListener("abort", stop, { once: true });
	try {
		const render = await queue.whenSettled(id);
		if (render.status === "cancelled")
			throw signal?.reason ?? new DOMException("Cancelled", "AbortError");
		if (render.status === "failed")
			throw new Error(render.error ?? "The render failed.");
		const file = await queue.file(id);
		if (!file || !render.result)
			throw new Error("The finished file is missing from storage.");
		if (render.progress?.phase === "done") onProgress?.(render.progress);
		return {
			file,
			frames: render.result.frames,
			durationSec: render.result.durationSec,
			jobId: render.jobId,
			elapsedMs: render.result.elapsedMs,
			chunks: render.result.chunks,
		};
	} finally {
		unsubscribe();
		signal?.removeEventListener("abort", stop);
	}
}

/**
 * What a render's output depends on, from the manifest (the composition as
 * the bundle built it), so a render's id is known before it is drawn.
 */
function settingsFor(
	manifest: WebBundleManifest,
	options: WebExportOptions,
): ExportSettings {
	return {
		bundleId: manifest.id,
		totalFrames: manifest.frameCount,
		fps: manifest.fps,
		width: even(manifest.width),
		height: even(manifest.height),
		codec: options.codec ?? "h264",
		quality: options.quality ?? "very_high",
		keyFrameIntervalSec: options.keyFrameIntervalSec ?? 5,
		audio: options.audio !== false,
	};
}

/** Renders one export now: builds the composition and runs the chunked job. */
async function exportOnce(
	manifest: WebBundleManifest,
	exported: unknown,
	options: WebExportOptions,
): Promise<WebExportResult> {
	options.onProgress?.({
		phase: "prepare",
		frames: 0,
		totalFrames: manifest.frameCount,
		message: "Building the composition",
	});
	// A fresh composition per export, as each Node render builds its own.
	const target = (
		typeof exported === "function"
			? await (exported as () => unknown)()
			: exported
	) as Exported;
	const vm = (
		target.toVirtualMediaAsync
			? await target.toVirtualMediaAsync()
			: target.toVirtualMedia?.()
	) as VirtualMediaData | undefined;
	if (!vm) throw new Error(`"${manifest.export}" is not a composition.`);
	const settings = settingsFor(manifest, options);
	const built = {
		fps: vm.metadata?.fps ?? target.fps ?? manifest.fps,
		width: even(vm.metadata?.width ?? manifest.width),
		height: even(vm.metadata?.height ?? manifest.height),
	};
	if (
		built.fps !== settings.fps ||
		built.width !== settings.width ||
		built.height !== settings.height
	)
		throw new Error(
			`The composition builds at ${built.width}x${built.height} ${built.fps} fps here but ${settings.width}x${settings.height} ${settings.fps} fps in the bundle's manifest; rebuild the bundle.`,
		);
	const durationMs =
		vm.metadata?.durationMs && vm.metadata.durationMs > 0
			? vm.metadata.durationMs
			: manifest.durationMs;
	vm.metadata.durationMs = durationMs;
	const jobId = await exportJobId(settings);
	const store: ExportStore =
		options.storage !== "memory" && OpfsExportStore.available()
			? await OpfsExportStore.open(jobId)
			: new MemoryExportStore();
	const backend = await createBrowserBackend({
		target,
		vm,
		settings,
		durationMs,
	});
	try {
		return await runExportJob({ jobId, settings, store, backend, options });
	} finally {
		backend.dispose();
	}
}

function even(n: number): number {
	const v = Math.round(n);
	return v % 2 === 0 ? v : v + 1;
}
