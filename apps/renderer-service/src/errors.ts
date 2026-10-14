/**
 * Stable error codes for render jobs (PLAN.md §10). `retryable` tells RunPod
 * or the caller whether running the same job again can succeed.
 */

export type JobPhase =
	| "boot"
	| "validate"
	| "resolve"
	| "fetch"
	| "lfs"
	| "install"
	| "load"
	| "render"
	| "verify"
	| "upload"
	| "any";

interface CodeInfo {
	phase: JobPhase;
	retryable: boolean;
}

const CODES = {
	CONFIG_INVALID: { phase: "boot", retryable: false },
	GPU_UNAVAILABLE: { phase: "boot", retryable: false },
	TOOL_MISSING: { phase: "boot", retryable: false },

	JOB_INVALID: { phase: "validate", retryable: false },
	REPO_NOT_ALLOWED: { phase: "validate", retryable: false },
	BUCKET_NOT_ALLOWED: { phase: "validate", retryable: false },
	PATH_ESCAPE: { phase: "validate", retryable: false },
	BUSY: { phase: "validate", retryable: true },

	GIT_AUTH_FAILED: { phase: "resolve", retryable: false },
	REPO_NOT_FOUND: { phase: "resolve", retryable: false },
	REF_NOT_FOUND: { phase: "resolve", retryable: false },
	REF_AMBIGUOUS: { phase: "resolve", retryable: false },
	COMMIT_MISMATCH: { phase: "resolve", retryable: false },
	GIT_TLS_FAILED: { phase: "resolve", retryable: false },

	GIT_NETWORK: { phase: "fetch", retryable: true },
	GIT_CACHE_CORRUPT: { phase: "fetch", retryable: true },

	LFS_AUTH_FAILED: { phase: "lfs", retryable: false },
	LFS_QUOTA_EXCEEDED: { phase: "lfs", retryable: false },
	LFS_UNAVAILABLE: { phase: "lfs", retryable: false },
	LFS_OBJECT_MISSING: { phase: "lfs", retryable: false },
	LFS_POINTER_UNRESOLVED: { phase: "lfs", retryable: false },
	UNSUPPORTED_GIT_FILTER: { phase: "lfs", retryable: false },

	DISK_FULL: { phase: "any", retryable: true },

	LOCKFILE_MISSING: { phase: "install", retryable: false },
	INSTALL_FAILED: { phase: "install", retryable: false },
	INSTALL_TIMEOUT: { phase: "install", retryable: true },
	ENGINE_NOT_FOUND: { phase: "install", retryable: false },
	ENGINE_SWITCH: { phase: "render", retryable: true },

	ENTRY_NOT_FOUND: { phase: "load", retryable: false },
	ENTRY_COMPILE_FAILED: { phase: "load", retryable: false },
	EXPORT_NOT_FOUND: { phase: "load", retryable: false },
	EXPORT_INVALID: { phase: "load", retryable: false },
	EXPORT_SIDE_EFFECT: { phase: "load", retryable: false },
	COMPOSITION_BUILD_FAILED: { phase: "load", retryable: false },

	ASSET_NOT_FOUND: { phase: "render", retryable: false },
	RENDER_FAILED: { phase: "render", retryable: false },
	RENDER_STALLED: { phase: "render", retryable: true },
	RENDER_TIMEOUT: { phase: "render", retryable: false },
	RENDER_OOM: { phase: "render", retryable: true },
	GPU_DEVICE_LOST: { phase: "render", retryable: true },
	RENDER_CRASHED: { phase: "render", retryable: true },

	OUTPUT_MISSING: { phase: "verify", retryable: false },
	OUTPUT_INVALID: { phase: "verify", retryable: false },
	OUTPUT_TOO_LARGE: { phase: "verify", retryable: false },
	QA_FAILED: { phase: "verify", retryable: false },

	UPLOAD_FAILED: { phase: "upload", retryable: true },
	UPLOAD_URL_EXPIRED: { phase: "upload", retryable: false },
	UPLOAD_AUTH_FAILED: { phase: "upload", retryable: false },

	CANCELLED: { phase: "any", retryable: false },
	SHUTDOWN: { phase: "any", retryable: true },
	INTERNAL: { phase: "any", retryable: false },
} as const satisfies Record<string, CodeInfo>;

export type ErrorCode = keyof typeof CODES;

export interface RenderErrorJSON {
	code: ErrorCode;
	message: string;
	phase: JobPhase;
	retryable: boolean;
	hint?: string;
	details?: Record<string, unknown>;
}

export class RenderError extends Error {
	readonly code: ErrorCode;
	readonly phase: JobPhase;
	readonly retryable: boolean;
	readonly hint?: string;
	readonly details?: Record<string, unknown>;

	constructor(
		code: ErrorCode,
		message: string,
		options: {
			phase?: JobPhase;
			hint?: string;
			details?: Record<string, unknown>;
			cause?: unknown;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = "RenderError";
		this.code = code;
		this.phase = options.phase ?? CODES[code].phase;
		this.retryable = CODES[code].retryable;
		this.hint = options.hint;
		this.details = options.details;
	}

	toJSON(): RenderErrorJSON {
		return {
			code: this.code,
			message: this.message,
			phase: this.phase,
			retryable: this.retryable,
			...(this.hint && { hint: this.hint }),
			...(this.details && { details: this.details }),
		};
	}
}

/** Wraps anything thrown into a RenderError, keeping RenderErrors as they are. */
export function toRenderError(err: unknown, phase: JobPhase): RenderError {
	if (err instanceof RenderError) return err;
	const message = err instanceof Error ? err.message : String(err);
	if (/ENOSPC/.test(message)) {
		return new RenderError("DISK_FULL", message, { phase, cause: err });
	}
	return new RenderError("INTERNAL", message, { phase, cause: err });
}
