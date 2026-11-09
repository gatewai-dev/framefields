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
import {
	frameCount,
	setLocalFileSource,
	type VirtualMediaData,
} from "@framefields/core";
import type { AudioTarget } from "../../preview/audio-mixer.js";
import { registerRenderers } from "../../preview/register.js";
import { process } from "../../preview/shims/process.js";
import {
	type ExportSettings,
	exportJobId,
	runExportJob,
} from "../export-job.js";
import {
	type ExportStore,
	MemoryExportStore,
	OpfsExportStore,
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

	let running: Promise<WebExportResult> | undefined;
	return {
		manifest,
		exportVideo(options = {}) {
			if (running)
				throw new Error("An export is already running on this page.");
			running = exportVideo(manifest, exported, options).finally(() => {
				running = undefined;
			});
			return running;
		},
		clearExports: () => OpfsExportStore.clearAll(),
	};
}

async function exportVideo(
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

	const fps = vm.metadata?.fps ?? target.fps ?? manifest.fps;
	const durationMs =
		vm.metadata?.durationMs && vm.metadata.durationMs > 0
			? vm.metadata.durationMs
			: manifest.durationMs;
	vm.metadata.durationMs = durationMs;
	const settings: ExportSettings = {
		bundleId: manifest.id,
		totalFrames: frameCount(durationMs, fps),
		fps,
		width: even(vm.metadata?.width ?? manifest.width),
		height: even(vm.metadata?.height ?? manifest.height),
		codec: options.codec ?? "h264",
		quality: options.quality ?? "very_high",
		keyFrameIntervalSec: options.keyFrameIntervalSec ?? 5,
		audio: options.audio !== false,
	};
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
