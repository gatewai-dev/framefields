import type { RendererConfig } from "../config/index.js";
import type { RepoRef } from "../git/repo-url.js";
import type { JobInput } from "./schema.js";
import type { JobProgress } from "./store.js";

/** What every pipeline step gets from the runner. */
export interface StepContext {
	jobId: string;
	config: RendererConfig;
	signal: AbortSignal;
	progress(p: JobProgress): void;
	warn(code: string, message: string): void;
	/** Per-job scratch dir on local disk (outputs, logs). */
	jobDir: string;
}

export interface CheckoutResult {
	/** Absolute path of the repo checkout. */
	root: string;
	/** Absolute path of `source.workdir` inside it. */
	workdir: string;
	sha: string;
	cache: Record<string, string>;
	/** Returns the workspace slot to the pool. */
	release(): Promise<void>;
}

export interface InstallResult {
	skipped: boolean;
	packageManager?: string;
	cache: Record<string, string>;
	/** Range the project declares for framefields, if any. */
	declaredEngine?: string;
}

export interface RenderedFile {
	name: string;
	path: string;
	ext: string;
	contentType: string;
	durationMs?: number;
	/** Frames the engine said it would render, for verification. */
	expectedFrames?: number;
	qa?: unknown;
}

export interface DeliveredFile {
	name: string;
	bytes: number;
	sha256: string;
	contentType: string;
	key?: string;
	url?: string;
	path?: string;
	base64?: string;
	/** The inline payload was dropped after FF_INLINE_TTL_SEC. */
	base64Expired?: boolean;
	durationMs?: number;
	frames?: number;
	/** QA report, when render.qa was set. */
	qa?: unknown;
}

export interface Pipeline {
	checkout(
		job: { input: JobInput; repo: RepoRef; ref: string },
		ctx: StepContext,
	): Promise<CheckoutResult>;
	install(checkout: CheckoutResult, ctx: StepContext): Promise<InstallResult>;
	render(
		checkout: CheckoutResult,
		input: JobInput,
		ctx: StepContext,
	): Promise<{ files: RenderedFile[]; engine: Record<string, unknown> }>;
	/**
	 * Outputs an earlier attempt already delivered for this commit
	 * (idempotency). When found, install/render/deliver are skipped.
	 */
	findExisting?(
		input: JobInput,
		sha: string,
		ctx: StepContext,
	): Promise<DeliveredFile[] | undefined>;
	deliver(
		files: RenderedFile[],
		job: { input: JobInput; sha: string; ref: string },
		ctx: StepContext,
	): Promise<DeliveredFile[]>;
}
