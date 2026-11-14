/**
 * Interactive environments: an agent acts, the scene's live physics steps,
 * and the next frame renders as its observation. An `InteractiveEnv` is an
 * `Env` that can also `start` a live scene; an `EnvSession` runs episodes
 * of it (`reset(seed)`, `step(action)`), Gymnasium-style.
 *
 * The scene's worlds go live on the session's `host` (`world.live(host)`,
 * `robot.live(host)`): before a step renders, the session advances them to
 * its frame, once, however many views draw it. The scene's compositions
 * are built once per episode; each step renders one more frame of them.
 */
import { HeadlessMediaRenderer } from "../index.js";
import type { Env, EnvView } from "./env.js";

/** What an agent sends each step. */
export type ActionSpace =
	| {
			type: "box";
			/** The action's shape, e.g. [2] for a 2D push. */
			shape: number[];
			low: number;
			high: number;
	  }
	| { type: "discrete"; n: number };

/** The `LiveHost` a scene's worlds go live on: the session steps it. */
export interface StepHost {
	onPrepareFrame(
		callback: (ctx: { frame: number }) => Promise<void> | void,
	): void;
}

/** One episode's live scene. */
export interface LiveScene<A> {
	views: EnvView[];
	/**
	 * Applies `action` to simulation frame `frame` (impulses, interventions,
	 * actuator targets), before the world steps it. Called once per frame
	 * a step covers, with the step's action.
	 */
	act(frame: number, action: A): void;
	/** The reward for reaching `frame`. */
	reward(frame: number): number;
	/** The task is over at `frame` (solved, or failed for good). */
	terminated?(frame: number): boolean;
	/** Anything else to report at `frame` (plain JSON). */
	info?(frame: number): Record<string, unknown>;
}

/**
 * An env an agent acts in. It needs no `build` (the offline views
 * `generateDataset` renders); give it one to make datasets of it too.
 */
export interface InteractiveEnv<P = unknown, A = unknown>
	extends Omit<Env<P>, "build"> {
	build?: Env<P>["build"];
	actionSpace: ActionSpace;
	/** Simulation frames each step covers (the action repeats). Default 1. */
	frameSkip?: number;
	/** Builds the scene of `params`, its worlds live on `host`. */
	start(params: P, host: StepHost): Promise<LiveScene<A>>;
}

/** A rendered view of the scene at a step. */
export interface ViewObservation {
	name: string;
	width: number;
	height: number;
	/** width × height × 4 bytes, the frame as `renderFrame({ format: "rgba" })`. */
	rgba: Uint8Array;
	/** With `truth`: depth along the camera's axis (scene px; Infinity empty). */
	depth?: Float32Array;
	/** With `truth`: object id per pixel (0 none). */
	object?: Uint32Array;
}

export interface Observation {
	frame: number;
	views: ViewObservation[];
}

export interface StepResult {
	observation: Observation;
	reward: number;
	/** The task ended (`terminated` said so). */
	terminated: boolean;
	/** The episode ran out of frames. */
	truncated: boolean;
	info: Record<string, unknown>;
}

export interface EnvSessionOptions {
	/** Shared by sessions in one process (one GPU device). */
	renderer?: HeadlessMediaRenderer;
	/** Depth and object ids with every observation (`renderTruth`). Default off. */
	truth?: boolean;
	/** Views to render, by name. Default every view. */
	views?: string[];
}

/** A host whose prepare callbacks the session runs before each step renders. */
class Host implements StepHost {
	private readonly callbacks: Array<
		(ctx: { frame: number }) => Promise<void> | void
	> = [];

	onPrepareFrame(
		callback: (ctx: { frame: number }) => Promise<void> | void,
	): void {
		this.callbacks.push(callback);
	}

	async prepare(frame: number): Promise<void> {
		for (const callback of this.callbacks) await callback({ frame });
	}
}

/** Episodes of an interactive env: `reset(seed)`, then `step(action)` until done. */
export class EnvSession<P = unknown, A = unknown> {
	private scene?: LiveScene<A>;
	private host?: Host;
	private frame = 0;
	private readonly renderer: HeadlessMediaRenderer;

	constructor(
		readonly env: InteractiveEnv<P, A>,
		private readonly options: EnvSessionOptions = {},
	) {
		this.renderer = options.renderer ?? new HeadlessMediaRenderer();
	}

	/** The current episode's frame. */
	get currentFrame(): number {
		return this.frame;
	}

	/** Starts an episode of `seed`'s scene and observes its first frame. */
	async reset(
		seed: number,
	): Promise<{ observation: Observation; info: Record<string, unknown> }> {
		const params = this.env.params(seed);
		this.host = new Host();
		this.scene = await this.env.start(params, this.host);
		this.frame = 0;
		const observation = await this.observe(0);
		return {
			observation,
			info: { seed, params, ...(this.scene.info?.(0) ?? {}) },
		};
	}

	/** Applies `action` for the next `frameSkip` frames and observes the last. */
	async step(action: A): Promise<StepResult> {
		const scene = this.scene;
		if (!scene) throw new Error("EnvSession: reset() before step().");
		const last = this.env.frames - 1;
		if (this.frame >= last)
			throw new Error(
				`EnvSession: the episode ended at frame ${last}; reset() to start another.`,
			);
		const to = Math.min(last, this.frame + (this.env.frameSkip ?? 1));
		for (let f = this.frame + 1; f <= to; f++) scene.act(f, action);
		this.frame = to;
		const observation = await this.observe(to);
		const terminated = scene.terminated?.(to) ?? false;
		return {
			observation,
			reward: scene.reward(to),
			terminated,
			truncated: !terminated && to >= last,
			info: scene.info?.(to) ?? {},
		};
	}

	private async observe(frame: number): Promise<Observation> {
		const scene = this.scene as LiveScene<A>;
		await this.host?.prepare(frame);
		const wanted = this.options.views;
		const views = wanted
			? scene.views.filter((v) => wanted.includes(v.name))
			: scene.views;
		const out: ViewObservation[] = [];
		for (const view of views) {
			const c = view.composition;
			if (this.options.truth) {
				const truth = await c.renderTruth({ frame, renderer: this.renderer });
				const s = truth.scenes[0];
				out.push({
					name: view.name,
					width: truth.width,
					height: truth.height,
					rgba: new Uint8Array(truth.rgba),
					depth: s.depth,
					object: s.object,
				});
			} else {
				const rgba = await c.renderFrame({
					frame,
					format: "rgba",
					renderer: this.renderer,
				});
				out.push({
					name: view.name,
					width: c.width,
					height: c.height,
					rgba: new Uint8Array(rgba),
				});
			}
		}
		return { frame, views: out };
	}
}
