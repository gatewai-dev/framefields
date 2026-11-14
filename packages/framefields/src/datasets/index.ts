/**
 * `framefields/datasets`: training and evaluation data from compositions.
 * An `Env` maps a seed to plain-JSON parameters and the parameters to
 * views (compositions); `generateDataset` renders every frame with its
 * ground truth into WebDataset shards (png, truth.npz, json) and a dataset
 * card, the same bytes on every machine. A seed range splits into parts
 * (`part: { index, count }`), one per worker, that `finishDataset` merges.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { type CardEnv, datasetCard } from "./card.js";
import { DatasetWriter } from "./dataset.js";
import { type Env, generate } from "./env.js";
import {
	manifestName,
	mergeParts,
	type Part,
	type PartManifest,
	partSeeds,
	partTag,
} from "./parts.js";

export interface GenerateDatasetOptions {
	/** Output folder (shards, a part's manifest, the card). */
	out: string;
	/** Every seed of the dataset (a part renders its share). */
	seeds: number[];
	/** Render one part of the seeds: its own shards and manifest, no card. */
	part?: Part;
	/** Frames to write; default every frame. */
	frames?: number[];
	/** Samples per shard. Default 500. */
	shard?: number;
	/** Visible fraction and whole extent per object. Default on. */
	amodal?: boolean;
	onSample?: (key: string) => void;
}

/**
 * Renders the env's seeds (or one part of them) into `out`. Without a part
 * it writes the dataset card too; a part writes its manifest instead, and
 * `finishDataset` writes the card once every part is in.
 */
export async function generateDataset<P>(
	env: Env<P>,
	options: GenerateDatasetOptions,
): Promise<{ seeds: number[]; samples: number; shards: string[] }> {
	const { part } = options;
	const seeds = part ? partSeeds(options.seeds, part) : options.seeds;
	const writer = new DatasetWriter({
		dir: options.out,
		samplesPerShard: options.shard ?? 500,
		...(part && { prefix: `shard-${partTag(part)}` }),
	});
	await generate(env, {
		seeds,
		frames: options.frames,
		writer,
		amodal: options.amodal ?? true,
		onSample: options.onSample,
	});
	const result = writer.close();
	const shards = result.shards.map((f) => path.basename(f));
	if (part) {
		const manifest: PartManifest = {
			env: env.name,
			part,
			seeds,
			samples: result.samples,
			shards,
		};
		writeFileSync(
			path.join(options.out, manifestName(part)),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);
	} else
		writeFileSync(
			path.join(options.out, "README.md"),
			datasetCard(env as CardEnv, seeds, result.samples),
		);
	return { seeds, samples: result.samples, shards };
}

/**
 * Merges the part manifests in `out` (every part exactly once, no seed
 * twice) and writes the dataset card.
 */
export function finishDataset(
	out: string,
	env: CardEnv,
): ReturnType<typeof mergeParts> {
	const merged = mergeParts(out);
	if (merged.env !== env.name)
		throw new Error(
			`the parts in ${out} are env ${merged.env}, not ${env.name}`,
		);
	writeFileSync(
		path.join(out, "README.md"),
		datasetCard(env, merged.seeds, merged.samples),
	);
	return merged;
}

export { type CardEnv, datasetCard } from "./card.js";
export {
	DatasetWriter,
	type DatasetWriterOptions,
	frameSample,
	type SampleMeta,
} from "./dataset.js";
export {
	type Env,
	type EnvView,
	type GenerateOptions,
	generate,
	sampleKey,
} from "./env.js";
export {
	type ActionSpace,
	EnvSession,
	type EnvSessionOptions,
	type InteractiveEnv,
	type LiveScene,
	type Observation,
	type StepHost,
	type StepResult,
	type ViewObservation,
} from "./interactive.js";
export {
	type LeRobotEpisode,
	type LeRobotVector,
	LeRobotWriter,
	type LeRobotWriterOptions,
	type MujocoEpisodeOptions,
	mujocoEpisode,
} from "./lerobot.js";
export {
	maskAndDepth,
	objectMask,
	type Pose,
	poseError,
	psnr,
	quatFromEuler,
	rotationError,
	ssim,
} from "./metrics.js";
export {
	encodeNpy,
	encodeNpz,
	type NpyDtype,
	narrowUint,
	toFloat16Bits,
} from "./npy.js";
export {
	encodeParquet,
	type ParquetColumn,
	type ParquetType,
	type ParquetValue,
} from "./parquet.js";
export {
	manifestName,
	mergeParts,
	type Part,
	type PartManifest,
	parsePart,
	partSeeds,
	partTag,
} from "./parts.js";
export { type Random, random } from "./random.js";
export { type EnvSpec, serveEnvs, type ViewLayout } from "./serve.js";
export { TarWriter, tarHeader } from "./tar.js";
