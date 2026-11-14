/**
 * An environment: a seed picks plain-JSON parameters, the parameters build
 * the scene (one composition per camera view), and every frame renders with
 * its ground truth. The same seed builds the same scene on every machine.
 */
import {
	type Composition,
	HeadlessMediaRenderer,
	truthLabels,
} from "../index.js";
import { type DatasetWriter, frameSample } from "./dataset.js";

/** One camera's composition of a scene, and its simulation state per frame. */
export interface EnvView {
	/** Letters, digits, `-` (it is part of sample keys). */
	name: string;
	composition: Composition;
	/** Simulation state at a frame: poses, velocities, contacts, joints. */
	physics?: (frame: number) => unknown;
}

export interface Env<P> {
	/** Letters, digits, `-` (it is part of sample keys). */
	name: string;
	description: string;
	fps: number;
	frames: number;
	width: number;
	height: number;
	/** The scene's parameters for a seed: plain JSON, enough to rebuild it. */
	params(seed: number): P;
	/** The scene for parameters, one composition per view. */
	build(params: P): Promise<EnvView[]>;
}

export interface GenerateOptions {
	seeds: number[];
	/** Frames to write; default every frame. */
	frames?: number[];
	writer: DatasetWriter;
	/**
	 * Draw each object alone too, for its visible share and whole extent
	 * (`visibleFraction`, `amodalBox2d`). One more pass per object. Default on.
	 */
	amodal?: boolean;
	/** Called after each written sample. */
	onSample?: (key: string) => void;
}

const SAFE = /^[A-Za-z0-9-]+$/;

/** The sample key of a rendered frame: `env_s000007_view_f0012`. */
export function sampleKey(
	env: string,
	seed: number,
	view: string,
	frame: number,
): string {
	if (!SAFE.test(env) || !SAFE.test(view))
		throw new Error(
			`env and view names are letters, digits and "-": ${env}, ${view}`,
		);
	return `${env}_s${String(seed).padStart(6, "0")}_${view}_f${String(frame).padStart(4, "0")}`;
}

/** Renders every seed's views and frames, with ground truth, into the writer. */
export async function generate<P>(
	env: Env<P>,
	options: GenerateOptions,
): Promise<void> {
	const renderer = new HeadlessMediaRenderer();
	const frames =
		options.frames ?? Array.from({ length: env.frames }, (_, f) => f);
	for (const seed of options.seeds) {
		const params = env.params(seed);
		for (const view of await env.build(params)) {
			for (const frame of frames) {
				const truth = await view.composition.renderTruth({
					frame,
					renderer,
					amodal: options.amodal ?? true,
				});
				const [scene] = truth.scenes;
				const key = sampleKey(env.name, seed, view.name, frame);
				options.writer.add(
					key,
					await frameSample(truth, scene, truthLabels(scene), {
						env: env.name,
						seed,
						view: view.name,
						frame,
						fps: env.fps,
						params,
						physics: view.physics?.(frame),
					}),
				);
				options.onSample?.(key);
			}
		}
	}
}
