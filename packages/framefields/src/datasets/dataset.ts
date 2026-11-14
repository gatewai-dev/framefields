/**
 * Datasets as WebDataset shards: tar files whose members `key.ext` group
 * into samples. Hugging Face `datasets` and `webdataset` load them as they
 * are; `.npy` members decode to arrays, `.json` to dicts, `.png` to images.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { FrameTruth, Scene3DTruth, TruthLabels } from "../index.js";
import { encodeNpy, encodeNpz, narrowUint, toFloat16Bits } from "./npy.js";
import { TarWriter } from "./tar.js";

export interface DatasetWriterOptions {
	/** Folder the shards go in (created). */
	dir: string;
	/** Shard file prefix: `<prefix>-000000.tar`. Default "shard". */
	prefix?: string;
	/** Samples per shard. Default 500. */
	samplesPerShard?: number;
}

/** Writes samples into numbered shards, starting a new one when one is full. */
export class DatasetWriter {
	readonly shards: string[] = [];
	samples = 0;
	private tar: TarWriter | null = null;
	private inShard = 0;
	private readonly keys = new Set<string>();

	constructor(private readonly options: DatasetWriterOptions) {
		mkdirSync(options.dir, { recursive: true });
	}

	/**
	 * Adds one sample: each file is written as `key.ext`, in sorted order.
	 * Keys are unique and hold no dots (WebDataset splits on the first).
	 */
	add(key: string, files: Record<string, Uint8Array>): void {
		if (key.includes(".") || key.includes("/"))
			throw new Error(`DatasetWriter: a key has no "." or "/": ${key}`);
		if (this.keys.has(key))
			throw new Error(`DatasetWriter: key written twice: ${key}`);
		this.keys.add(key);
		const tar = this.shard();
		for (const ext of Object.keys(files).sort()) {
			tar.add(`${key}.${ext}`, files[ext]);
		}
		this.inShard++;
		this.samples++;
	}

	close(): { shards: string[]; samples: number } {
		this.tar?.close();
		this.tar = null;
		return { shards: this.shards, samples: this.samples };
	}

	private shard(): TarWriter {
		const per = this.options.samplesPerShard ?? 500;
		if (this.tar && this.inShard < per) return this.tar;
		this.tar?.close();
		const name = `${this.options.prefix ?? "shard"}-${String(this.shards.length).padStart(6, "0")}.tar`;
		const file = path.join(this.options.dir, name);
		this.tar = new TarWriter(file);
		this.shards.push(file);
		this.inShard = 0;
		return this.tar;
	}
}

/** What a sample's `.json` holds besides the labels. */
export interface SampleMeta {
	env: string;
	seed: number;
	view: string;
	frame: number;
	fps: number;
	/** The parameters the scene was built from (what the recreate task asks for). */
	params: unknown;
	/** Simulation state at this frame: poses, velocities, contacts, joints. */
	physics?: unknown;
}

const encodeJson = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));

/**
 * A rendered frame and its ground truth as sample files: `png` (the frame),
 * `truth.npz` (deflated: `depth` H×W float32, scene px, inf where empty;
 * `normal` H×W×3 float16, the engine's own precision; `motion` H×W×2
 * float32, px since the previous frame; `object` and `instance` H×W, the
 * smallest unsigned type that holds them) and `json` (meta, camera, objects).
 */
export async function frameSample(
	truth: FrameTruth,
	scene: Scene3DTruth,
	labels: TruthLabels,
	meta: SampleMeta,
): Promise<Record<string, Uint8Array>> {
	const { width: w, height: h } = scene;
	const png = await sharp(truth.rgba, {
		raw: { width: truth.width, height: truth.height, channels: 4 },
	})
		.png()
		.toBuffer();
	const arrays: Array<[string, Uint8Array]> = [
		["depth", encodeNpy(scene.depth, [h, w])],
		["motion", encodeNpy(scene.motion, [h, w, 2])],
		["object", encodeNpy(narrowUint(scene.object), [h, w])],
		["instance", encodeNpy(narrowUint(scene.instance), [h, w])],
	];
	if (scene.normal)
		arrays.push([
			"normal",
			encodeNpy(toFloat16Bits(scene.normal), [h, w, 3], "<f2"),
		]);
	return {
		png: new Uint8Array(png),
		"truth.npz": encodeNpz(arrays),
		json: encodeJson({ ...meta, ...labels }),
	};
}
