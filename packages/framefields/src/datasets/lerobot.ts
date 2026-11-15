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
 *   videos/<key>/chunk-XXX/file-YYY.mp4    per camera, episodes back to back
 *
 * As LeRobot's recorder does, episodes share a data file and a video file
 * per camera until it reaches `dataFileSizeMb` / `videoFileSizeMb`; the
 * episode table says where each one's rows and video stretch sit. Each
 * episode's video is encoded on its own and the encoded frames are copied
 * into the shared file (`stitchChunks`), nothing re-encoded. Cameras
 * are compositions, so a camera sees whatever the scene renders, with the
 * engine's lighting and materials. `mujocoEpisode` makes an episode of a
 * MuJoCo run: joint positions, the actuator commands as actions,
 * velocities and sensor readings.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	type Composition,
	HeadlessMediaRenderer,
	stitchChunks,
} from "../index.js";
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
	/** A data file takes episodes until it holds this many MB. Default 100. */
	dataFileSizeMb?: number;
	/** A video file takes episodes until it holds this many MB. Default 200. */
	videoFileSizeMb?: number;
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

/** A file's place: `chunk-XXX/file-YYY`. */
interface FileIndex {
	chunk: number;
	file: number;
}

interface VideoPlace extends FileIndex {
	from: number;
	to: number;
}

interface EpisodeRecord {
	index: number;
	length: number;
	task: string;
	from: number;
	data: FileIndex;
	videos: Record<string, VideoPlace>;
	stats: Record<string, Stats>;
}

const nextFile = (at: FileIndex): FileIndex =>
	at.file + 1 < CHUNK_SIZE
		? { chunk: at.chunk, file: at.file + 1 }
		: { chunk: at.chunk + 1, file: 0 };
const pad3 = (n: number) => String(n).padStart(3, "0");
const filePath = (at: FileIndex, ext: string) =>
	path.join(`chunk-${pad3(at.chunk)}`, `file-${pad3(at.file)}.${ext}`);
const MB = 1024 * 1024;

/** The data file being filled: its episodes' frame-table columns. */
interface OpenData {
	at: FileIndex;
	bytes: number;
	episodes: ParquetColumn[][];
}

/** A camera's video file being filled: its episodes' own encodes. */
interface OpenVideo {
	at: FileIndex;
	bytes: number;
	seconds: number;
	frames: number;
	episodes: string[];
}

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
	private data?: OpenData;
	private readonly videos = new Map<string, OpenVideo>();
	/** Each episode's own video encodes, until joined into the shared files. */
	private readonly scratch: string;

	constructor(private readonly options: LeRobotWriterOptions) {
		this.renderer = options.renderer ?? new HeadlessMediaRenderer();
		mkdirSync(options.dir, { recursive: true });
		this.scratch = path.join(options.dir, ".episodes");
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
		const data = this.addData(columns);

		// The videos, and image statistics from evenly spaced frames.
		const samples = Math.min(frames, this.options.imageStatSamples ?? 20);
		const videos: Record<string, VideoPlace> = {};
		for (const [key, comp] of cameras) {
			const video = path.join(this.scratch, key, `episode-${index}.mp4`);
			mkdirSync(path.dirname(video), { recursive: true });
			const result = await comp.renderVideo({
				outputPath: video,
				codec: this.options.codec ?? "h264",
				audio: false,
				frames: { start: 0, end: frames },
				renderer: this.renderer,
			});
			await result.cleanup();
			videos[key] = await this.addVideo(key, video, frames);
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
			data,
			videos,
			stats,
		});
		this.totalFrames += frames;
		return { index, frames };
	}

	/** Puts an episode's rows in the open data file, or in a new one when it is full. */
	private addData(columns: ParquetColumn[]): FileIndex {
		const bytes = encodeParquet(columns).length;
		const limit = (this.options.dataFileSizeMb ?? 100) * MB;
		if (this.data && this.data.bytes + bytes > limit) {
			const at = nextFile(this.data.at);
			this.flushData();
			this.data = { at, bytes: 0, episodes: [] };
		}
		this.data ??= { at: { chunk: 0, file: 0 }, bytes: 0, episodes: [] };
		this.data.bytes += bytes;
		this.data.episodes.push(columns);
		return this.data.at;
	}

	private flushData(): void {
		const open = this.data;
		if (!open) return;
		const columns = open.episodes[0].map((c, k) => ({
			...c,
			values: open.episodes.flatMap((ep) => ep[k].values),
		}));
		const file = path.join(
			this.options.dir,
			"data",
			filePath(open.at, "parquet"),
		);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, encodeParquet(columns));
		this.data = undefined;
	}

	/** Queues an episode's video for the camera's open file, or a new one when it is full. */
	private async addVideo(
		key: string,
		video: string,
		frames: number,
	): Promise<VideoPlace> {
		const bytes = statSync(video).size;
		const limit = (this.options.videoFileSizeMb ?? 200) * MB;
		let open = this.videos.get(key);
		if (open && open.bytes + bytes > limit) {
			const at = nextFile(open.at);
			await this.flushVideo(key);
			open = { at, bytes: 0, seconds: 0, frames: 0, episodes: [] };
		}
		open ??= {
			at: { chunk: 0, file: 0 },
			bytes: 0,
			seconds: 0,
			frames: 0,
			episodes: [],
		};
		this.videos.set(key, open);
		const from = open.seconds;
		open.bytes += bytes;
		open.frames += frames;
		open.seconds = open.frames / this.options.fps;
		open.episodes.push(video);
		return { ...open.at, from, to: open.seconds };
	}

	/** Joins a camera's queued episodes into its video file. */
	private async flushVideo(key: string): Promise<void> {
		const open = this.videos.get(key);
		if (!open) return;
		const outputPath = path.join(
			this.options.dir,
			"videos",
			key,
			filePath(open.at, "mp4"),
		);
		const { frames } = await stitchChunks({
			chunks: open.episodes,
			outputPath,
		});
		if (frames !== open.frames)
			throw new Error(
				`LeRobot: ${outputPath} holds ${frames} frames, its episodes ${open.frames}`,
			);
		for (const file of open.episodes) rmSync(file);
		this.videos.delete(key);
	}

	/**
	 * Writes the open data and video files, then meta/: info.json,
	 * stats.json, tasks.parquet and the episodes table.
	 */
	async close(): Promise<{ episodes: number; frames: number }> {
		const features = this.features;
		if (!features) throw new Error("LeRobot: no episodes were added.");
		this.flushData();
		for (const key of [...this.videos.keys()]) await this.flushVideo(key);
		rmSync(this.scratch, { recursive: true, force: true });
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
					data_files_size_in_mb: this.options.dataFileSizeMb ?? 100,
					video_files_size_in_mb: this.options.videoFileSizeMb ?? 200,
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
				eps.map((e) => e.data.chunk),
			),
			col(
				"data/file_index",
				"int64",
				eps.map((e) => e.data.file),
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
					eps.map((e) => e.videos[key].chunk),
				),
				col(
					`videos/${key}/file_index`,
					"int64",
					eps.map((e) => e.videos[key].file),
				),
				col(
					`videos/${key}/from_timestamp`,
					"float64",
					eps.map((e) => e.videos[key].from),
				),
				col(
					`videos/${key}/to_timestamp`,
					"float64",
					eps.map((e) => e.videos[key].to),
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
