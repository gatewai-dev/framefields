/**
 * Serves interactive envs to another process (the Python client) as
 * JSON-RPC over newline-delimited JSON: one request per line in, one
 * response per line out. Observations do not travel in the JSON: `make`
 * sizes a file the client memory-maps (on Linux, put it in /dev/shm), and
 * every `reset` / `step` writes each env's views into its slot of that file
 * before answering, so the client reads them in place.
 *
 *   make  { env, count?, shm, truth?, views? } → { handle, spec, layout }
 *   reset { handle, seeds, indices? }          → { frames, infos }
 *   step  { handle, actions }                  → { frames, rewards, terminated, truncated, infos }
 *         (a `null` action leaves that env as it is)
 *   close { handle }                           → {}
 *   list  {}                                   → { envs: [spec] }
 *
 * A handle holds `count` sessions of one env sharing one GPU device;
 * `reset` and `step` act on all of them (or `indices`), in order.
 */
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { HeadlessMediaRenderer } from "../index.js";
import {
	type ActionSpace,
	EnvSession,
	type InteractiveEnv,
	type Observation,
} from "./interactive.js";

/** Where a view's arrays sit in an env's slot of the shared file, bytes. */
export interface ViewLayout {
	name: string;
	width: number;
	height: number;
	/** uint8 H×W×4. */
	rgba: number;
	/** float32 H×W (with `truth`). */
	depth?: number;
	/** uint32 H×W (with `truth`). */
	object?: number;
}

export interface EnvSpec {
	name: string;
	description: string;
	fps: number;
	frames: number;
	frameSkip: number;
	actionSpace: ActionSpace;
	views: Array<{ name: string; width: number; height: number }>;
}

interface Handle {
	sessions: EnvSession<unknown, unknown>[];
	fd: number;
	slotBytes: number;
	layout: ViewLayout[];
}

type Envs = Record<string, InteractiveEnv<unknown, unknown>>;

/** An env's views and their sizes, from the scene of seed 0. */
async function specOf(env: InteractiveEnv<unknown, unknown>): Promise<EnvSpec> {
	const host = { onPrepareFrame: () => {} };
	const scene = await env.start(env.params(0), host);
	return {
		name: env.name,
		description: env.description,
		fps: env.fps,
		frames: env.frames,
		frameSkip: env.frameSkip ?? 1,
		actionSpace: env.actionSpace,
		views: scene.views.map((v) => ({
			name: v.name,
			width: v.composition.width,
			height: v.composition.height,
		})),
	};
}

function layoutOf(
	views: EnvSpec["views"],
	truth: boolean,
): { layout: ViewLayout[]; slotBytes: number } {
	let o = 0;
	const layout = views.map((v) => {
		const px = v.width * v.height;
		const entry: ViewLayout = { ...v, rgba: o };
		o += px * 4;
		if (truth) {
			entry.depth = o;
			o += px * 4;
			entry.object = o;
			o += px * 4;
		}
		return entry;
	});
	// Slots start on 64-byte boundaries.
	return { layout, slotBytes: Math.ceil(o / 64) * 64 };
}

function write(handle: Handle, index: number, obs: Observation): void {
	const base = index * handle.slotBytes;
	for (const view of obs.views) {
		const at = handle.layout.find((l) => l.name === view.name);
		if (!at) continue;
		const put = (bytes: ArrayBufferView, offset: number) =>
			writeSync(
				handle.fd,
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
				0,
				bytes.byteLength,
				base + offset,
			);
		put(view.rgba, at.rgba);
		if (view.depth && at.depth !== undefined) put(view.depth, at.depth);
		if (view.object && at.object !== undefined) put(view.object, at.object);
	}
}

/** Answers requests from `input` on `output` until `input` ends. */
export async function serveEnvs(
	envs: Envs,
	streams: { input?: Readable; output?: Writable } = {},
): Promise<void> {
	const input = streams.input ?? process.stdin;
	const output = streams.output ?? process.stdout;
	const renderer = new HeadlessMediaRenderer();
	const handles = new Map<number, Handle>();
	let nextHandle = 1;
	const specs = new Map<string, EnvSpec>();
	const spec = async (name: string) => {
		const env = envs[name];
		if (!env)
			throw new Error(
				`no env "${name}" (envs: ${Object.keys(envs).join(", ")})`,
			);
		let s = specs.get(name);
		if (!s) {
			s = await specOf(env);
			specs.set(name, s);
		}
		return { env, spec: s };
	};
	const handleOf = (id: unknown): Handle => {
		const h = handles.get(Number(id));
		if (!h) throw new Error(`no handle ${String(id)}`);
		return h;
	};

	const methods: Record<
		string,
		(p: Record<string, unknown>) => Promise<unknown>
	> = {
		async list() {
			return {
				envs: await Promise.all(
					Object.keys(envs).map(async (n) => (await spec(n)).spec),
				),
			};
		},
		async make(p) {
			const { env, spec: s } = await spec(String(p.env));
			const count = Number(p.count ?? 1);
			if (!Number.isInteger(count) || count < 1 || count > 1024)
				throw new Error("count: 1 to 1024");
			if (typeof p.shm !== "string") throw new Error("shm: the file to map");
			const truth = p.truth === true;
			const wanted = Array.isArray(p.views) ? (p.views as string[]) : undefined;
			const views = wanted
				? s.views.filter((v) => wanted.includes(v.name))
				: s.views;
			const { layout, slotBytes } = layoutOf(views, truth);
			const fd = openSync(p.shm, "w+");
			ftruncateSync(fd, slotBytes * count);
			const sessions = Array.from(
				{ length: count },
				() =>
					new EnvSession(env, {
						renderer,
						truth,
						...(wanted && { views: wanted }),
					}),
			);
			const handle = nextHandle++;
			handles.set(handle, { sessions, fd, slotBytes, layout });
			return {
				handle,
				spec: { ...s, views },
				layout: { slotBytes, bytes: slotBytes * count, views: layout },
			};
		},
		async reset(p) {
			const h = handleOf(p.handle);
			const seeds = p.seeds as number[];
			const indices =
				(p.indices as number[] | undefined) ?? h.sessions.map((_, i) => i);
			if (!Array.isArray(seeds) || seeds.length !== indices.length)
				throw new Error(`seeds: one per env (${indices.length})`);
			const frames: number[] = [];
			const infos: unknown[] = [];
			for (const [k, i] of indices.entries()) {
				const session = h.sessions[i];
				if (!session)
					throw new Error(`no env ${i} in handle ${String(p.handle)}`);
				const r = await session.reset(seeds[k]);
				write(h, i, r.observation);
				frames.push(r.observation.frame);
				infos.push(r.info);
			}
			return { frames, infos };
		},
		async step(p) {
			const h = handleOf(p.handle);
			const actions = p.actions as unknown[];
			if (!Array.isArray(actions) || actions.length !== h.sessions.length)
				throw new Error(`actions: one per env (${h.sessions.length})`);
			const out = {
				frames: [] as number[],
				rewards: [] as number[],
				terminated: [] as boolean[],
				truncated: [] as boolean[],
				infos: [] as unknown[],
			};
			for (const [i, session] of h.sessions.entries()) {
				if (actions[i] === null) {
					// Not stepped (a vector client's autoreset): its slot keeps
					// the observation it has.
					out.frames.push(session.currentFrame);
					out.rewards.push(0);
					out.terminated.push(false);
					out.truncated.push(false);
					out.infos.push({});
					continue;
				}
				const r = await session.step(actions[i]);
				write(h, i, r.observation);
				out.frames.push(r.observation.frame);
				out.rewards.push(r.reward);
				out.terminated.push(r.terminated);
				out.truncated.push(r.truncated);
				out.infos.push(r.info);
			}
			return out;
		},
		async close(p) {
			const h = handleOf(p.handle);
			closeSync(h.fd);
			handles.delete(Number(p.handle));
			return {};
		},
	};

	const send = (message: unknown) =>
		output.write(`${JSON.stringify(message)}\n`);
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	// One request at a time, in order: sessions share the GPU device.
	for await (const line of lines) {
		if (!line.trim()) continue;
		let id: unknown = null;
		try {
			const request = JSON.parse(line) as {
				id?: unknown;
				method?: string;
				params?: Record<string, unknown>;
			};
			id = request.id ?? null;
			const method = methods[String(request.method)];
			if (!method)
				throw new Error(
					`no method "${String(request.method)}" (${Object.keys(methods).join(", ")})`,
				);
			send({ id, result: await method(request.params ?? {}) });
		} catch (err) {
			send({
				id,
				error: { message: err instanceof Error ? err.message : String(err) },
			});
		}
	}
	for (const h of handles.values()) closeSync(h.fd);
}
