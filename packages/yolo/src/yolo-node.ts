import type { YoloConfig, YoloNode as YoloNodeAST } from "@gitframes/core";
import type { YoloTask } from "./model/registry.js";
import {
	type YoloRunnerOptions,
	YoloVisionRunner,
} from "./runner/yolo-runner.js";
import {
	YoloVisionBundle,
	type YoloVisionBundleOptions,
} from "./signals/yolo-signals-bundle.js";
import type { YoloInputSource } from "./types.js";

/**
 * Bundle returned by `YoloNode.attach()`: the reactive signals surface plus the lazy lifecycle
 * helpers (all zero-I/O until `runner()` really needs a model).
 */
export interface YoloAttachedBundle extends YoloVisionBundle {
	readonly node: YoloNodeAST;
	/** Warm the enabled tasks' models/sessions ahead of first use. */
	ready(): Promise<YoloVisionRunner>;
	/** Lazily-created runner (downloads happen on first real inference). */
	runner(): YoloVisionRunner;
	/** Release this node's runner/sessions. */
	close(): void;
}

/**
 * YOLO vision node.
 *
 * LAZY BY CONSTRUCTION: creating a YoloNode performs ZERO I/O — no model
 * downloads, no sessions, no file probes. The first inference call (or an
 * explicit `await vision.ready()`) downloads the required models.
 */
export class YoloNode {
	public readonly id: string;
	public readonly kind = "yolo" as const;
	public readonly source: YoloInputSource;
	public readonly config: YoloConfig;
	public readonly vision: YoloVisionBundle;

	private _runner?: YoloVisionRunner;

	/** Runner construction options (modelsDir, provider, …) — injectable for tests/agents. */
	private _runnerOptions: YoloRunnerOptions;

	constructor(
		source: YoloInputSource,
		config: YoloConfig = {},
		bundleOptions: YoloVisionBundleOptions = {},
		runnerOptions: YoloRunnerOptions = {},
	) {
		this.id = "yolo-" + Math.random().toString(36).slice(2, 9);
		this.source = source;
		this.config = config;
		this._runnerOptions = runnerOptions;
		this.vision = new YoloVisionBundle({
			...bundleOptions,
			config,
		});
	}

	/** Lazily-created runner; downloads happen here on first access. */
	public runner(): YoloVisionRunner {
		if (!this._runner) {
			const {
				variant,
				imgsz,
				confidence,
				iouThreshold,
				classes,
				enableWorld,
				prompts,
				customModel,
				modelsDir,
				baseUrl,
				maskThreshold,
				featherRadius,
			} = this.config;
			// config values win over injected runner options, but only when set —
			// an explicit undefined must not clobber an injected modelsDir/provider.
			this._runner = YoloVisionRunner.create({
				...this._runnerOptions,
				...(variant !== undefined ? { variant } : {}),
				...(imgsz !== undefined ? { imgsz } : {}),
				...(confidence !== undefined ? { confidence } : {}),
				...(iouThreshold !== undefined ? { iouThreshold } : {}),
				...(classes !== undefined ? { classes } : {}),
				...(enableWorld !== undefined ? { enableWorld } : {}),
				...(prompts !== undefined ? { prompts } : {}),
				...(customModel !== undefined ? { customModel } : {}),
				...(modelsDir !== undefined ? { modelsDir } : {}),
				...(baseUrl !== undefined ? { baseUrl } : {}),
				...(maskThreshold !== undefined ? { maskThreshold } : {}),
				...(featherRadius !== undefined ? { featherRadius } : {}),
			});
		}
		return this._runner;
	}

	/** Explicit warm-up — downloads the models for the enabled tasks, ahead of first inference. */
	public async ready(): Promise<YoloVisionRunner> {
		const runner = this.runner();
		const tasks: YoloTask[] = [];
		if (this.config.enableDetection === true) tasks.push("detect");
		if (this.config.enableSegmentation === true) tasks.push("segment");
		if (this.config.enablePose === true) tasks.push("pose");
		if (this.config.enableObb === true) tasks.push("obb");
		if (this.config.enableClassification === true) tasks.push("classify");
		if (this.config.enableWorld === true) tasks.push("world");
		// No task explicitly enabled → default det or world task
		const defaultTask = this.config.enableWorld === true ? "world" : "detect";
		await runner.preload(tasks.length > 0 ? tasks : [defaultTask]);
		return runner;
	}

	public close(): void {
		this._runner?.close();
		this._runner = undefined;
	}

	public static attach(
		source: YoloInputSource,
		config: YoloConfig = {},
		bundleOptions: YoloVisionBundleOptions = {},
	): YoloAttachedBundle {
		const nodeInstance = new YoloNode(source, config, bundleOptions);
		const vision = nodeInstance.vision;

		// Attach AST node property to the vision bundle for composition graph inclusion
		Object.defineProperty(vision, "node", {
			value: {
				id: nodeInstance.id,
				kind: "yolo",
				source: nodeInstance.source,
				config: nodeInstance.config,
			} as YoloNodeAST,
			enumerable: true,
			writable: false,
		});

		// Surface the lazy ready()/runner() helpers on the bundle for agent DX
		Object.defineProperty(vision, "ready", {
			value: () => nodeInstance.ready(),
			enumerable: false,
		});
		Object.defineProperty(vision, "runner", {
			value: () => nodeInstance.runner(),
			enumerable: false,
		});
		Object.defineProperty(vision, "close", {
			value: () => nodeInstance.close(),
			enumerable: false,
		});

		return vision as YoloAttachedBundle;
	}

	public toNode(): YoloNodeAST {
		return {
			id: this.id,
			kind: "yolo",
			source: this.source,
			config: this.config,
		};
	}
}
