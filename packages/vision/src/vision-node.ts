import type { VisionConfig, VisionNodeSpec } from "@framefields/core";
import type { VisionTask } from "./model/registry.js";
import {
	VisionRunner,
	type VisionRunnerOptions,
} from "./runner/vision-runner.js";
import {
	VisionBundle,
	type VisionBundleOptions,
} from "./signals/vision-bundle.js";
import type { VisionInputSource } from "./types.js";

/**
 * Bundle returned by `VisionNode.attach()`: the reactive signals surface plus the lazy lifecycle
 * helpers (all zero-I/O until `runner()` really needs a model).
 */
export interface VisionAttachedBundle extends VisionBundle {
	readonly node: VisionNodeSpec;
	/** Warm the enabled tasks' models/sessions ahead of first use. */
	ready(): Promise<VisionRunner>;
	/** Lazily-created runner (downloads happen on first real inference). */
	runner(): VisionRunner;
	/** Release this node's runner/sessions. */
	close(): void;
}

/** Tasks a config turns on; detection is the default when nothing is enabled explicitly. */
export function enabledTasks(config: VisionConfig): VisionTask[] {
	const tasks: VisionTask[] = [];
	if (config.enableDetection === true) tasks.push("detect");
	if (config.enableSegmentation === true) tasks.push("segment");
	if (config.enablePose === true) tasks.push("pose");
	if (config.enableMatte === true) tasks.push("matte");
	return tasks.length > 0 ? tasks : ["detect"];
}

/**
 * Vision node.
 *
 * LAZY BY CONSTRUCTION: creating a VisionNode performs ZERO I/O — no model downloads, no
 * sessions, no file probes. The first inference call (or an explicit `await vision.ready()`)
 * downloads the required models.
 */
export class VisionNode {
	public readonly id: string;
	public readonly kind = "vision" as const;
	public readonly source: VisionInputSource;
	public readonly config: VisionConfig;
	public readonly vision: VisionBundle;

	private _runner?: VisionRunner;

	/** Runner construction options (modelsDir, provider, store, …) — injectable for tests/agents. */
	private readonly _runnerOptions: VisionRunnerOptions;

	constructor(
		source: VisionInputSource,
		config: VisionConfig = {},
		bundleOptions: VisionBundleOptions = {},
		runnerOptions: VisionRunnerOptions = {},
	) {
		this.id = `vision-${Math.random().toString(36).slice(2, 9)}`;
		this.source = source;
		this.config = config;
		this._runnerOptions = runnerOptions;
		this.vision = new VisionBundle({
			...bundleOptions,
			config,
		});
	}

	/** Lazily-created runner; downloads happen on its first inference. */
	public runner(): VisionRunner {
		if (!this._runner) {
			const {
				variant,
				confidence,
				classes,
				modelsDir,
				baseUrl,
				maskThreshold,
				featherRadius,
			} = this.config;
			// Config values win over injected runner options, but only when set —
			// an explicit undefined must not clobber an injected modelsDir/provider.
			this._runner = VisionRunner.create({
				...this._runnerOptions,
				...(variant !== undefined ? { variant } : {}),
				...(confidence !== undefined ? { confidence } : {}),
				...(classes !== undefined ? { classes } : {}),
				...(modelsDir !== undefined ? { modelsDir } : {}),
				...(baseUrl !== undefined ? { baseUrl } : {}),
				...(maskThreshold !== undefined ? { maskThreshold } : {}),
				...(featherRadius !== undefined ? { featherRadius } : {}),
			});
		}
		return this._runner;
	}

	/** Explicit warm-up — downloads the models for the enabled tasks, ahead of first inference. */
	public async ready(): Promise<VisionRunner> {
		const runner = this.runner();
		await runner.preload(enabledTasks(this.config));
		return runner;
	}

	public close(): void {
		this._runner?.close();
		this._runner = undefined;
	}

	public static attach(
		source: VisionInputSource,
		config: VisionConfig = {},
		bundleOptions: VisionBundleOptions = {},
	): VisionAttachedBundle {
		const node = new VisionNode(source, config, bundleOptions);
		const vision = node.vision;

		// AST node for composition graph inclusion, plus the lazy lifecycle helpers.
		Object.defineProperties(vision, {
			node: { value: node.toNode(), enumerable: true },
			ready: { value: () => node.ready() },
			runner: { value: () => node.runner() },
			close: { value: () => node.close() },
		});

		return vision as VisionAttachedBundle;
	}

	public toNode(): VisionNodeSpec {
		return {
			id: this.id,
			kind: "vision",
			source: this.source,
			config: this.config,
		};
	}
}
