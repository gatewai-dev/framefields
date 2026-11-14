/**
 * LeRobot datasets (format v3.0, what `LeRobotDataset` and the Hugging Face
 * Hub read): episodes of a robot's state, actions and camera videos.
 *
 *   meta/info.json                         schema, fps, path templates
 *   meta/stats.json                        per-feature min/max/mean/std
 *   meta/tasks.parquet                     task text → task_index
 *   meta/episodes/chunk-000/file-000.parquet  per episode: length, tasks,
 *                                          where its rows and video sit, stats
 *   data/chunk-XXX/file-YYY.parquet        one row per frame
 *   videos/<key>/chunk-XXX/file-YYY.mp4    one file per camera per episode
 *
 * Each episode gets its own data and video files (v3.0 allows many per
 * file; one each keeps every episode at timestamp 0 of its video). Cameras
 * are compositions, so a camera sees whatever the scene renders, with the
 * engine's lighting and materials. `mujocoEpisode` makes an episode of a
 * MuJoCo run: joint positions, the actuator commands as actions,
 * velocities and sensor readings.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Composition, HeadlessMediaRenderer } from "../index.js";
import type { MujocoWorld } from "../physics/mujoco.js";
import { encodeParquet, type ParquetColumn } from "./parquet.js";

/** A float32 vector per frame, and the name of each of its entries. */
export interface LeRobotVector {
	names: string[];
	at(frame: number): ArrayLike<number>;
}

export interface LeRobotEpisode {
	/** What the robot is doing, in words (LeRobot's task). */
	task: string;
	/** Frames in the episode, from frame 0 of each camera's composition. */
	frames: number;
	/** Camera name → the composition seen through it (`observation.images.<name>`). */
	cameras: Record<string, Composition>;
	/** `observation.state`. */
	state: LeRobotVector;
	/** `action`: the command at each frame. */
	action: LeRobotVector;
	/** More float32 vectors, by feature key (`observation.velocity`, …). */
	features?: Record<string, LeRobotVector>;
	/** `next.reward` per frame. */
	reward?: (frame: number) => number;
	/** `next.done` per frame. */
	done?: (frame: number) => boolean;
}

export interface LeRobotWriterOptions {
	/** The dataset's folder. */
	dir: string;
	fps: number;
	/** LeRobot's `robot_type` (e.g. "so101"). */
	robotType?: string;
	/** Video codec. Default h264. */
	codec?: "h264" | "vp9";
	renderer?: HeadlessMediaRenderer;
	/** Frames sampled per episode for image statistics. Default 20. */
	imageStatSamples?: number;
}

const CHUNK_SIZE = 1000;
const DEFAULT_FEATURES = [
	"timestamp",
	"frame_index",
	"episode_index",
	"index",
	"task_index",
] as const;

/** min / max / mean / std per entry (or per image channel), and how many samples. */
interface Stats {
	min: number[];
	max: number[];
	mean: number[];
	std: number[];
	count: number;
	/** Image features: [3, 1, 1] per channel. */
	image?: boolean;
}

function statsOf(rows: ArrayLike<number>[], dims: number): Stats {
	const min = new Array<number>(dims).fill(Number.POSITIVE_INFINITY);
	const max = new Array<number>(dims).fill(Number.NEGATIVE_INFINITY);
	const sum = new Array<number>(dims).fill(0);
	const sq = new Array<number>(dims).fill(0);
	for (const r of rows)
		for (let k = 0; k < dims; k++) {
			const v = r[k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
			sum[k] += v;
			sq[k] += v * v;
		}
	const n = rows.length || 1;
	const mean = sum.map((s) => s / n);
	const std = sq.map((s, k) =>
		Math.sqrt(Math.max(0, s / n - mean[k] * mean[k])),
	);
	return { min, max, mean, std, count: rows.length };
}

/** Pooled statistics of several episodes'. */
function pool(parts: Stats[]): Stats {
	const count = parts.reduce((n, p) => n + p.count, 0) || 1;
	const dims = parts[0].mean.length;
	const mean = Array.from(
		{ length: dims },
		(_, k) => parts.reduce((s, p) => s + p.mean[k] * p.count, 0) / count,
	);
	const std = Array.from({ length: dims }, (_, k) =>
		Math.sqrt(
			parts.reduce(
				(s, p) => s + p.count * (p.std[k] ** 2 + (p.mean[k] - mean[k]) ** 2),
				0,
			) / count,
		),
	);
	return {
		min: Array.from({ length: dims }, (_, k) =>
			Math.min(...parts.map((p) => p.min[k])),
		),
		max: Array.from({ length: dims }, (_, k) =>
			Math.max(...parts.map((p) => p.max[k])),
		),
		mean,
		std,
		count,
		...(parts[0].image && { image: true }),
	};
}

/** A stat as LeRobot stores it: a vector, or [[[c]], …] per image channel. */
const shaped = (values: number[], image?: boolean) =>
	image ? values.map((v) => [[v]]) : values;

interface FeatureInfo {
	dtype: string;
	shape: number[];
	names: string[] | null;
	info?: Record<string, unknown>;
}

interface EpisodeRecord {
	index: number;
	length: number;
	task: string;
	from: number;
	stats: Record<string, Stats>;
}

const chunkFile = (i: number) => ({
	chunk: Math.floor(i / CHUNK_SIZE),
	file: i % CHUNK_SIZE,
});
const pad3 = (n: number) => String(n).padStart(3, "0");

/** Writes episodes into a LeRobot v3.0 dataset; `close()` writes its metadata. */
export class LeRobotWriter {
	private features?: Record<string, FeatureInfo>;
	private vectorKeys: string[] = [];
	private cameraKeys: string[] = [];
	private hasReward = false;
	private hasDone = false;
	private readonly episodes: EpisodeRecord[] = [];
	private readonly tasks: string[] = [];
	private totalFrames = 0;
	private readonly renderer: HeadlessMediaRenderer;

	constructor(private readonly options: LeRobotWriterOptions) {
		this.renderer = options.renderer ?? new HeadlessMediaRenderer();
		mkdirSync(options.dir, { recursive: true });
	}

	/** Renders and writes one episode. */
	async addEpisode(
		episode: LeRobotEpisode,
	): Promise<{ index: number; frames: number }> {
		const vectors: Record<string, LeRobotVector> = {
			"observation.state": episode.state,
			action: episode.action,
			...(episode.features ?? {}),
		};
		const cameras = Object.entries(episode.cameras).map(
			([name, comp]) => [`observation.images.${name}`, comp] as const,
		);
		this.checkSchema(vectors, cameras, episode);
		const index = this.episodes.length;
		const frames = episode.frames;
		let task = this.tasks.indexOf(episode.task);
		if (task < 0) task = this.tasks.push(episode.task) - 1;
		const from = this.totalFrames;
		const { chunk, file } = chunkFile(index);
		const stats: Record<string, Stats> = {};

		// The frame table.
		const columns: ParquetColumn[] = [];
		for (const key of this.vectorKeys) {
			const v = vectors[key];
			const rows = Array.from({ length: frames }, (_, f) => {
				const row = v.at(f);
				if (row.length !== v.names.length)
					throw new Error(
						`LeRobot: ${key} at frame ${f} has ${row.length} values, ${v.names.length} names`,
					);
				return Array.from(row);
			});
			stats[key] = statsOf(rows, v.names.length);
			columns.push({ name: key, type: "float32", depth: 1, values: rows });
		}
		const frameIndex = Array.from({ length: frames }, (_, f) => f);
		if (this.hasReward) {
			const r = frameIndex.map((f) => episode.reward?.(f) ?? 0);
			stats["next.reward"] = statsOf(
				r.map((v) => [v]),
				1,
			);
			columns.push({ name: "next.reward", type: "float32", values: r });
		}
		if (this.hasDone) {
			const d = frameIndex.map((f) => episode.done?.(f) ?? f === frames - 1);
			stats["next.done"] = statsOf(
				d.map((v) => [v ? 1 : 0]),
				1,
			);
			columns.push({ name: "next.done", type: "bool", values: d });
		}
		const fps = this.options.fps;
		const defaults: Record<(typeof DEFAULT_FEATURES)[number], number[]> = {
			timestamp: frameIndex.map((f) => f / fps),
			frame_index: frameIndex,
			episode_index: frameIndex.map(() => index),
			index: frameIndex.map((f) => from + f),
			task_index: frameIndex.map(() => task),
		};
		for (const key of DEFAULT_FEATURES) {
			stats[key] = statsOf(
				defaults[key].map((v) => [v]),
				1,
			);
			columns.push({
				name: key,
				type: key === "timestamp" ? "float32" : "int64",
				values: defaults[key],
			});
		}
		const dataPath = path.join(
			this.options.dir,
			"data",
			`chunk-${pad3(chunk)}`,
			`file-${pad3(file)}.parquet`,
		);
		mkdirSync(path.dirname(dataPath), { recursive: true });
		writeFileSync(dataPath, encodeParquet(columns));

		// The videos, and image statistics from evenly spaced frames.
		const samples = Math.min(frames, this.options.imageStatSamples ?? 20);
		for (const [key, comp] of cameras) {
			const video = path.join(
				this.options.dir,
				"videos",
				key,
				`chunk-${pad3(chunk)}`,
				`file-${pad3(file)}.mp4`,
			);
			mkdirSync(path.dirname(video), { recursive: true });
			const result = await comp.renderVideo({
				outputPath: video,
				codec: this.options.codec ?? "h264",
				audio: false,
				frames: { start: 0, end: frames },
				renderer: this.renderer,
			});
			await result.cleanup();
			const channels: number[][] = [];
			for (let k = 0; k < samples; k++) {
				const f =
					samples === 1 ? 0 : Math.round((k * (frames - 1)) / (samples - 1));
				const rgba = await comp.renderFrame({
					frame: f,
					format: "rgba",
					renderer: this.renderer,
				});
				for (let p = 0; p < rgba.length; p += 4)
					channels.push([rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255]);
			}
			stats[key] = { ...statsOf(channels, 3), count: samples, image: true };
		}

		this.episodes.push({
			index,
			length: frames,
			task: episode.task,
			from,
			stats,
		});
		this.totalFrames += frames;
		return { index, frames };
	}

	/** Writes meta/: info.json, stats.json, tasks.parquet and the episodes table. */
	close(): { episodes: number; frames: number } {
		const features = this.features;
		if (!features) throw new Error("LeRobot: no episodes were added.");
		const { dir, fps } = this.options;
		const meta = path.join(dir, "meta");
		const write = (rel: string, data: string | Uint8Array) => {
			const file = path.join(meta, rel);
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, data);
		};
		write(
			"info.json",
			`${JSON.stringify(
				{
					codebase_version: "v3.0",
					robot_type: this.options.robotType ?? null,
					total_episodes: this.episodes.length,
					total_frames: this.totalFrames,
					total_tasks: this.tasks.length,
					chunks_size: CHUNK_SIZE,
					data_files_size_in_mb: 100,
					video_files_size_in_mb: 200,
					fps,
					splits: { train: `0:${this.episodes.length}` },
					data_path:
						"data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
					video_path:
						"videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4",
					features,
				},
				null,
				4,
			)}\n`,
		);
		const keys = Object.keys(this.episodes[0].stats);
		const stats = Object.fromEntries(
			keys.map((k) => {
				const s = pool(this.episodes.map((e) => e.stats[k]));
				return [
					k,
					{
						min: shaped(s.min, s.image),
						max: shaped(s.max, s.image),
						mean: shaped(s.mean, s.image),
						std: shaped(s.std, s.image),
						count: [s.count],
					},
				];
			}),
		);
		write("stats.json", `${JSON.stringify(stats, null, 4)}\n`);
		write(
			"tasks.parquet",
			encodeParquet(
				[
					{
						name: "task_index",
						type: "int64",
						values: this.tasks.map((_, i) => i),
					},
					{ name: "task", type: "string", values: this.tasks },
				],
				{ pandas: PANDAS_TASK_INDEX },
			),
		);
		write(
			"episodes/chunk-000/file-000.parquet",
			encodeParquet(this.episodeColumns()),
		);
		return { episodes: this.episodes.length, frames: this.totalFrames };
	}

	/** The per-episode table, as LeRobot's `meta/episodes` holds it. */
	private episodeColumns(): ParquetColumn[] {
		const eps = this.episodes;
		const fps = this.options.fps;
		const col = (
			name: string,
			type: ParquetColumn["type"],
			values: ParquetColumn["values"],
			depth = 0,
		): ParquetColumn => ({
			name,
			type,
			depth,
			values,
		});
		const columns: ParquetColumn[] = [
			col(
				"episode_index",
				"int64",
				eps.map((e) => e.index),
			),
			col(
				"tasks",
				"string",
				eps.map((e) => [e.task]),
				1,
			),
			col(
				"length",
				"int64",
				eps.map((e) => e.length),
			),
			col(
				"data/chunk_index",
				"int64",
				eps.map((e) => chunkFile(e.index).chunk),
			),
			col(
				"data/file_index",
				"int64",
				eps.map((e) => chunkFile(e.index).file),
			),
			col(
				"dataset_from_index",
				"int64",
				eps.map((e) => e.from),
			),
			col(
				"dataset_to_index",
				"int64",
				eps.map((e) => e.from + e.length),
			),
		];
		for (const key of this.cameraKeys) {
			columns.push(
				col(
					`videos/${key}/chunk_index`,
					"int64",
					eps.map((e) => chunkFile(e.index).chunk),
				),
				col(
					`videos/${key}/file_index`,
					"int64",
					eps.map((e) => chunkFile(e.index).file),
				),
				col(
					`videos/${key}/from_timestamp`,
					"float64",
					eps.map(() => 0),
				),
				col(
					`videos/${key}/to_timestamp`,
					"float64",
					eps.map((e) => e.length / fps),
				),
			);
		}
		for (const key of Object.keys(eps[0].stats)) {
			const image = eps[0].stats[key].image;
			const depth = image ? 3 : 1;
			for (const stat of ["min", "max", "mean", "std"] as const)
				columns.push(
					col(
						`stats/${key}/${stat}`,
						"float64",
						eps.map((e) => shaped(e.stats[key][stat], image)),
						depth,
					),
				);
			columns.push(
				col(
					`stats/${key}/count`,
					"int64",
					eps.map((e) => [e.stats[key].count]),
					1,
				),
			);
		}
		columns.push(
			col(
				"meta/episodes/chunk_index",
				"int64",
				eps.map(() => 0),
			),
			col(
				"meta/episodes/file_index",
				"int64",
				eps.map(() => 0),
			),
		);
		return columns;
	}

	/** The first episode fixes the features; later ones must match them. */
	private checkSchema(
		vectors: Record<string, LeRobotVector>,
		cameras: ReadonlyArray<readonly [string, Composition]>,
		episode: LeRobotEpisode,
	): void {
		const features: Record<string, FeatureInfo> = {};
		for (const [key, v] of Object.entries(vectors))
			features[key] = {
				dtype: "float32",
				shape: [v.names.length],
				names: v.names,
			};
		for (const [key, comp] of cameras)
			features[key] = {
				dtype: "video",
				shape: [comp.height, comp.width, 3],
				names: ["height", "width", "channels"],
				info: {
					"video.height": comp.height,
					"video.width": comp.width,
					"video.codec": this.options.codec ?? "h264",
					"video.pix_fmt": "yuv420p",
					"video.is_depth_map": false,
					"video.fps": this.options.fps,
					"video.channels": 3,
					has_audio: false,
				},
			};
		if (episode.reward)
			features["next.reward"] = { dtype: "float32", shape: [1], names: null };
		if (episode.done)
			features["next.done"] = { dtype: "bool", shape: [1], names: null };
		for (const key of DEFAULT_FEATURES)
			features[key] = {
				dtype: key === "timestamp" ? "float32" : "int64",
				shape: [1],
				names: null,
			};
		for (const [, comp] of cameras)
			if (comp.fps !== this.options.fps)
				throw new Error(
					`LeRobot: a camera renders at ${comp.fps} fps, the dataset is ${this.options.fps}`,
				);
		if (!this.features) {
			this.features = features;
			this.vectorKeys = Object.keys(vectors);
			this.cameraKeys = cameras.map(([k]) => k);
			this.hasReward = !!episode.reward;
			this.hasDone = !!episode.done;
			return;
		}
		const a = JSON.stringify(this.features);
		const b = JSON.stringify(features);
		if (a !== b)
			throw new Error(
				`LeRobot: episode ${this.episodes.length} has other features than episode 0 (${Object.keys(features).join(", ")})`,
			);
	}
}

/** pandas' metadata for a table indexed by its `task` column (LeRobot reads it so). */
const PANDAS_TASK_INDEX = JSON.stringify({
	index_columns: ["task"],
	column_indexes: [
		{
			name: null,
			field_name: null,
			pandas_type: "unicode",
			numpy_type: "object",
			metadata: { encoding: "UTF-8" },
		},
	],
	columns: [
		{
			name: "task_index",
			field_name: "task_index",
			pandas_type: "int64",
			numpy_type: "int64",
			metadata: null,
		},
		{
			name: "task",
			field_name: "task",
			pandas_type: "unicode",
			numpy_type: "object",
			metadata: null,
		},
	],
	creator: { library: "framefields", version: "1" },
	pandas_version: "2.2.3",
});

export interface MujocoEpisodeOptions {
	task: string;
	/** Camera name → the composition seen through it. */
	cameras: Record<string, Composition>;
	/** Joints in the state (and velocity). Default every hinge and slide joint. */
	joints?: string[];
	/** Add `observation.velocity` (the joints' qvel). Default on. */
	velocity?: boolean;
	/** Add `observation.sensors` (every sensor's values). Default on when the model has sensors. */
	sensors?: boolean;
}

/**
 * An episode of a MuJoCo run: `observation.state` the joints' positions,
 * `action` the actuator commands that step each frame to the next,
 * `observation.velocity` their velocities and `observation.sensors` the
 * sensor readings.
 */
export function mujocoEpisode(
	world: MujocoWorld,
	options: MujocoEpisodeOptions,
): LeRobotEpisode {
	const joints = options.joints
		? options.joints.map((name) => {
				const j = world.joints.find((x) => x.name === name);
				if (!j)
					throw new Error(
						`mujocoEpisode: no joint "${name}" (joints: ${world.joints.map((x) => x.name).join(", ")})`,
					);
				if (j.type === "free" || j.type === "ball")
					throw new Error(
						`mujocoEpisode: joint "${name}" is a ${j.type} joint; the state takes hinge and slide joints`,
					);
				return j;
			})
		: world.joints.filter((j) => j.type === "hinge" || j.type === "slide");
	const names = joints.map((j) => j.name);
	const pick = (data: Float64Array, adr: "qpos" | "qvel") =>
		joints.map((j) => data[j[adr]]);
	const sensorNames = world.sensors.flatMap((s) =>
		s.dim === 1
			? [s.name]
			: Array.from({ length: s.dim }, (_, k) => `${s.name}.${k}`),
	);
	return {
		task: options.task,
		frames: world.frames,
		cameras: options.cameras,
		state: { names, at: (f) => pick(world.qpos(f), "qpos") },
		action: { names: world.actuatorNames, at: (f) => world.action(f) },
		features: {
			...((options.velocity ?? true) && {
				"observation.velocity": {
					names,
					at: (f: number) => pick(world.qvel(f), "qvel"),
				},
			}),
			...((options.sensors ?? sensorNames.length > 0) && {
				"observation.sensors": {
					names: sensorNames,
					at: (f: number) => world.sensordata(f),
				},
			}),
		},
	};
}
