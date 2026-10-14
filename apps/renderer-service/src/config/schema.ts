import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import z from "zod";
import { parseRepoUrl } from "../git/repo-url.js";

/** Env booleans: only explicit true/false spellings are accepted. */
const bool = (fallback: boolean) =>
	z
		.enum(["true", "false", "1", "0", "yes", "no"])
		.optional()
		.transform((v) =>
			v === undefined ? fallback : ["true", "1", "yes"].includes(v),
		);

const int = (fallback: number) =>
	z.coerce.number().int().min(0).default(fallback);

const list = z
	.string()
	.optional()
	.transform((v) =>
		(v ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);

const json = <T extends z.ZodType>(schema: T) =>
	z
		.string()
		.optional()
		.transform((v, ctx) => {
			if (!v) return undefined;
			try {
				return JSON.parse(v) as unknown;
			} catch {
				ctx.addIssue({ code: "custom", message: "must be valid JSON" });
				return z.NEVER;
			}
		})
		.pipe(schema.optional());

const credential = z.union([
	z.string().min(1),
	z.object({ username: z.string().optional(), token: z.string().min(1) }),
]);

export const HOST_KINDS = [
	"github",
	"gitlab",
	"bitbucket",
	"gitea",
	"generic",
] as const;

export const envSchema = z.object({
	// Mode
	NODE_ENV: z
		.enum(["development", "production", "staging", "test"])
		.default("production"),
	FF_MODE: z.enum(["runpod-serverless", "http", "cli"]).optional(),
	RUNPOD_POD_ID: z.string().optional(),
	RENDERER_HOST: z.string().optional(),
	RENDERER_PORT: z.coerce.number().int().positive().optional(),
	PORT: z.coerce.number().int().positive().optional(),
	RENDERER_API_KEY: z.string().min(16, "use at least 16 characters").optional(),
	FF_HTTP_INSECURE: bool(false),

	// Source
	FF_DEFAULT_REPO: z.string().optional(),
	FF_DEFAULT_REF: z.string().default("main"),
	FF_REPO_ALLOWLIST: list,
	FF_ALLOW_LOCAL_REPOS: bool(false),
	FF_GIT_FETCH: z.enum(["mirror", "single"]).default("mirror"),
	FF_LFS_CONCURRENCY: int(8),
	FF_LFS_DEFAULT_INCLUDE: list,

	// Git auth & hosts
	GIT_TOKEN: z.string().optional(),
	GIT_USERNAME: z.string().optional(),
	FF_GIT_CREDENTIALS: json(z.record(z.string(), credential)),
	FF_GIT_HOSTS: json(z.record(z.string(), z.enum(HOST_KINDS))),
	FF_GIT_CA_BUNDLE: z.string().optional(),
	GIT_SSH_KEY: z.string().optional(),
	GIT_SSH_KNOWN_HOSTS: z.string().optional(),
	FF_SSH_ACCEPT_NEW: bool(false),
	FF_ALLOW_JOB_CREDENTIALS: bool(false),

	// Install
	FF_INSTALL_SCRIPTS: bool(true),
	FF_ALLOW_UNLOCKED_INSTALL: bool(false),
	FF_NPMRC: z.string().optional(),

	// Storage
	STORAGE_DRIVER: z.enum(["s3", "local", "none"]).optional(),
	STORAGE_ENDPOINT: z.string().optional(),
	STORAGE_REGION: z.string().default("auto"),
	STORAGE_ACCESS_KEY_ID: z.string().optional(),
	STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
	STORAGE_BUCKET: z.string().optional(),
	STORAGE_PUBLIC_BASE_URL: z.string().optional(),
	STORAGE_FORCE_PATH_STYLE: bool(false),
	FF_OUTPUT_BUCKETS: list,
	FF_OUTPUT_DIR: z.string().optional(),
	FF_INLINE_MAX_BYTES: int(5 * 1024 * 1024),
	FF_OUTPUT_MAX_BYTES: int(20 * 1024 * 1024 * 1024),

	// Paths & cache
	FF_CACHE_DIR: z.string().optional(),
	FF_WORK_DIR: z.string().optional(),
	FF_CACHE_MAX_GB: int(50),
	FF_WORK_MAX_GB: int(40),

	// Limits
	FF_QUEUE_MAX: int(8),
	FF_JOB_TIMEOUT_MAX_SEC: int(7200),
	FF_TIMEOUT_GIT_SEC: int(600),
	FF_TIMEOUT_LFS_SEC: int(1800),
	FF_TIMEOUT_INSTALL_SEC: int(900),
	FF_TIMEOUT_LOAD_SEC: int(120),
	FF_TIMEOUT_RENDER_SEC: int(7200),
	FF_STALL_TIMEOUT_SEC: int(300),
	FF_KILL_GRACE_SEC: int(20),
	FF_JOB_TTL_SEC: int(3600),
	FF_JOB_HISTORY_MAX: int(500),

	// Recycling
	FF_MAX_JOBS_PER_WORKER: int(25),
	FF_RECYCLE_HEAP_MB: int(4096),
	FF_RECYCLE_RSS_MB: int(0),
	FF_EVENT_LOOP_BLOCK_SEC: int(120),
	FF_STRAY_ERROR_LIMIT: int(3),
	FF_LEAKED_HANDLE_LIMIT: int(50),

	// Job env
	FF_JOB_ENV_ALLOW: list,
	FF_KEEP_FAILED_JOBS: bool(false),
	FF_QA_BLOCK_UPLOAD: bool(false),
});

export type RawEnv = z.infer<typeof envSchema>;

/** Env vars removed from process.env before repo code runs (PLAN.md §8.2). */
export const SECRET_ENV_KEYS = [
	"GIT_TOKEN",
	"GIT_SSH_KEY",
	"FF_GIT_CREDENTIALS",
	"FF_NPMRC",
	"STORAGE_ACCESS_KEY_ID",
	"STORAGE_SECRET_ACCESS_KEY",
	"RENDERER_API_KEY",
] as const;

/** Job env names repo code may never set, whatever FF_JOB_ENV_ALLOW says. */
export const RESERVED_JOB_ENV = [
	/^PATH$/,
	/^HOME$/,
	/^NODE_/,
	/^LD_/,
	/^DYLD_/,
	/^GIT_/,
	/^STORAGE_/,
	/^FF_/,
	/^RUNPOD_/,
	/^RENDERER_/,
	/^NVIDIA_/,
	/^VK_/,
	/^DISPLAY$/,
	/^npm_/i,
];

export interface Probe {
	exists(p: string): boolean;
	tmpdir(): string;
	homedir(): string;
}

const defaultProbe: Probe = {
	exists: existsSync,
	tmpdir: os.tmpdir,
	homedir: os.homedir,
};

export interface ConfigProblem {
	key: string;
	message: string;
}

/**
 * Validates the whole environment and derives the effective config. Returns
 * every problem at once instead of failing on the first.
 */
export function buildConfig(
	env: NodeJS.ProcessEnv,
	probe: Probe = defaultProbe,
) {
	const parsed = envSchema.safeParse(env);
	if (!parsed.success) {
		return {
			ok: false as const,
			problems: parsed.error.issues.map((i) => ({
				key: i.path.join(".") || "(env)",
				message: i.message,
			})),
		};
	}
	const e = parsed.data;
	const problems: ConfigProblem[] = [];

	const mode = e.FF_MODE ?? (e.RUNPOD_POD_ID ? "runpod-serverless" : "http");

	if (mode === "http" && !e.RENDERER_API_KEY && !e.FF_HTTP_INSECURE) {
		problems.push({
			key: "RENDERER_API_KEY",
			message: "required in http mode (or set FF_HTTP_INSECURE=true)",
		});
	}

	const allowlist = [...e.FF_REPO_ALLOWLIST];
	if (e.FF_DEFAULT_REPO) {
		try {
			const repo = parseRepoUrl(e.FF_DEFAULT_REPO, {
				allowLocal: e.FF_ALLOW_LOCAL_REPOS,
			});
			if (allowlist.length === 0) allowlist.push(repo.id);
		} catch (err) {
			problems.push({
				key: "FF_DEFAULT_REPO",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}
	if (allowlist.length === 0) {
		problems.push({
			key: "FF_REPO_ALLOWLIST",
			message: "required, e.g. github.com/acme/* (or set FF_DEFAULT_REPO)",
		});
	}

	const storageDriver =
		e.STORAGE_DRIVER ??
		(e.STORAGE_ENDPOINT ? "s3" : e.FF_OUTPUT_DIR ? "local" : "none");
	if (storageDriver === "s3") {
		for (const key of [
			"STORAGE_ENDPOINT",
			"STORAGE_ACCESS_KEY_ID",
			"STORAGE_SECRET_ACCESS_KEY",
			"STORAGE_BUCKET",
		] as const) {
			if (!e[key])
				problems.push({ key, message: "required when STORAGE_DRIVER=s3" });
		}
	}
	if (storageDriver === "local" && !e.FF_OUTPUT_DIR) {
		problems.push({
			key: "FF_OUTPUT_DIR",
			message: "required when STORAGE_DRIVER=local",
		});
	}

	if (problems.length > 0) return { ok: false as const, problems };

	// RunPod network volume, then the image's cache dir, then the user's.
	const cacheDir =
		e.FF_CACHE_DIR ??
		(probe.exists("/runpod-volume")
			? "/runpod-volume/framefields"
			: probe.exists("/var/cache/framefields")
				? "/var/cache/framefields"
				: path.join(probe.homedir(), ".cache", "framefields-renderer"));
	const workDir = e.FF_WORK_DIR ?? path.join(probe.tmpdir(), "framefields");
	const outputBuckets = e.FF_OUTPUT_BUCKETS.length
		? e.FF_OUTPUT_BUCKETS
		: e.STORAGE_BUCKET
			? [e.STORAGE_BUCKET]
			: [];

	const config = {
		nodeEnv: e.NODE_ENV,
		mode,
		http: {
			host:
				e.RENDERER_HOST ??
				(mode === "runpod-serverless" ? "127.0.0.1" : "0.0.0.0"),
			port: e.RENDERER_PORT ?? e.PORT ?? 8082,
			apiKey: e.RENDERER_API_KEY,
			insecure: e.FF_HTTP_INSECURE,
		},
		source: {
			defaultRepo: e.FF_DEFAULT_REPO,
			defaultRef: e.FF_DEFAULT_REF,
			allowlist,
			allowLocal: e.FF_ALLOW_LOCAL_REPOS,
			fetch: e.FF_GIT_FETCH,
			lfsConcurrency: e.FF_LFS_CONCURRENCY,
			lfsDefaultInclude: e.FF_LFS_DEFAULT_INCLUDE,
		},
		git: {
			token: e.GIT_TOKEN,
			username: e.GIT_USERNAME,
			credentials: e.FF_GIT_CREDENTIALS ?? {},
			hosts: e.FF_GIT_HOSTS ?? {},
			caBundle: e.FF_GIT_CA_BUNDLE,
			sshKey: e.GIT_SSH_KEY,
			sshKnownHosts: e.GIT_SSH_KNOWN_HOSTS,
			sshAcceptNew: e.FF_SSH_ACCEPT_NEW,
			allowJobCredentials: e.FF_ALLOW_JOB_CREDENTIALS,
		},
		install: {
			scripts: e.FF_INSTALL_SCRIPTS,
			allowUnlocked: e.FF_ALLOW_UNLOCKED_INSTALL,
			npmrc: e.FF_NPMRC,
		},
		storage: {
			driver: storageDriver,
			endpoint: e.STORAGE_ENDPOINT,
			region: e.STORAGE_REGION,
			accessKeyId: e.STORAGE_ACCESS_KEY_ID,
			secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY,
			bucket: e.STORAGE_BUCKET,
			publicBaseUrl: e.STORAGE_PUBLIC_BASE_URL,
			forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
			outputBuckets,
			outputDir: e.FF_OUTPUT_DIR,
			inlineMaxBytes: e.FF_INLINE_MAX_BYTES,
			outputMaxBytes: e.FF_OUTPUT_MAX_BYTES,
		},
		paths: {
			cacheDir,
			workDir,
			cacheMaxGb: e.FF_CACHE_MAX_GB,
			workMaxGb: e.FF_WORK_MAX_GB,
		},
		limits: {
			queueMax: e.FF_QUEUE_MAX,
			jobTimeoutMaxSec: e.FF_JOB_TIMEOUT_MAX_SEC,
			timeouts: {
				git: e.FF_TIMEOUT_GIT_SEC,
				lfs: e.FF_TIMEOUT_LFS_SEC,
				install: e.FF_TIMEOUT_INSTALL_SEC,
				load: e.FF_TIMEOUT_LOAD_SEC,
				render: e.FF_TIMEOUT_RENDER_SEC,
			},
			stallTimeoutSec: e.FF_STALL_TIMEOUT_SEC,
			killGraceSec: e.FF_KILL_GRACE_SEC,
			jobTtlSec: e.FF_JOB_TTL_SEC,
			jobHistoryMax: e.FF_JOB_HISTORY_MAX,
		},
		recycle: {
			maxJobs: e.FF_MAX_JOBS_PER_WORKER,
			heapMb: e.FF_RECYCLE_HEAP_MB,
			rssMb: e.FF_RECYCLE_RSS_MB,
			eventLoopBlockSec: e.FF_EVENT_LOOP_BLOCK_SEC,
			strayErrorLimit: e.FF_STRAY_ERROR_LIMIT,
			leakedHandleLimit: e.FF_LEAKED_HANDLE_LIMIT,
		},
		jobEnv: {
			allow: e.FF_JOB_ENV_ALLOW.length ? e.FF_JOB_ENV_ALLOW : ["*"],
		},
		keepFailedJobs: e.FF_KEEP_FAILED_JOBS,
		qaBlockUpload: e.FF_QA_BLOCK_UPLOAD,
	};

	return { ok: true as const, config: deepFreeze(config) };
}

export type RendererConfig = Extract<
	ReturnType<typeof buildConfig>,
	{ ok: true }
>["config"];

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) deepFreeze(v);
		Object.freeze(value);
	}
	return value;
}
