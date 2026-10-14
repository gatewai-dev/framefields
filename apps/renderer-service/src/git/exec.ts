import { spawn } from "node:child_process";
import { type ErrorCode, type JobPhase, RenderError } from "../errors.js";
import { redact } from "../redact.js";

export interface ExecOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	signal?: AbortSignal;
	input?: string;
	/** Cap on captured stdout, to avoid buffering huge listings. */
	maxStdoutBytes?: number;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export class CommandError extends Error {
	constructor(
		readonly command: string,
		readonly result: ExecResult & { timedOut: boolean; aborted: boolean },
	) {
		super(
			`${command} ${result.timedOut ? "timed out" : `exited with ${result.code}`}: ${tail(result.stderr || result.stdout)}`,
		);
		this.name = "CommandError";
	}
}

/**
 * Spawns a command without a shell. Kills it (whole process group) on
 * timeout or abort. Rejects with CommandError on a non-zero exit.
 */
export function exec(
	file: string,
	args: readonly string[],
	options: ExecOptions = {},
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(options.signal.reason);
			return;
		}
		const child = spawn(file, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const max = options.maxStdoutBytes ?? 64 * 1024 * 1024;
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let aborted = false;

		child.stdout.setEncoding("utf8").on("data", (d: string) => {
			if (stdout.length < max) stdout += d;
		});
		child.stderr.setEncoding("utf8").on("data", (d: string) => {
			stderr = (stderr + d).slice(-64 * 1024);
		});

		const kill = () => {
			try {
				if (child.pid && process.platform !== "win32")
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				// already gone
			}
		};
		const timer = options.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					kill();
				}, options.timeoutMs)
			: undefined;
		const onAbort = () => {
			aborted = true;
			kill();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", (err) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			if (aborted) {
				reject(options.signal?.reason);
				return;
			}
			const result = { stdout, stderr, code: code ?? -1 };
			if (code === 0 && !timedOut) resolve(result);
			else
				reject(
					new CommandError(`${file} ${args[0] ?? ""}`.trim(), {
						...result,
						timedOut,
						aborted,
					}),
				);
		});

		child.stdin.end(options.input ?? "");
	});
}

function tail(text: string, lines = 12): string {
	return redact(text.trim().split("\n").slice(-lines).join("\n"));
}

interface Rule {
	test: RegExp;
	code: ErrorCode;
	hint?: string;
}

/** Git and git-lfs messages → stable codes. Host-specific rules come first. */
const COMMON_RULES: Rule[] = [
	{ test: /No space left on device|ENOSPC/i, code: "DISK_FULL" },
	{
		test: /SSL certificate problem|unable to get local issuer certificate|certificate verify failed/i,
		code: "GIT_TLS_FAILED",
		hint: "For a self-signed server, set FF_GIT_CA_BUNDLE to its CA certificate (PEM).",
	},
	{
		test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
		code: "GIT_AUTH_FAILED",
		hint: "Add the server's key to GIT_SSH_KNOWN_HOSTS (or set FF_SSH_ACCEPT_NEW=true).",
	},
	{
		test: /SAML|single sign-on|SSO/i,
		code: "GIT_AUTH_FAILED",
		hint: "Authorize the token for the organization's SSO.",
	},
	{
		test: /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|HTTP Basic: Access denied|invalid credentials|\b401\b|Invalid username or (password|token)/i,
		code: "GIT_AUTH_FAILED",
		hint: "Check GIT_TOKEN / FF_GIT_CREDENTIALS (or GIT_SSH_KEY) and that it can read this repo.",
	},
	{
		test: /Repository not found|repository '.*' not found|does not appear to be a git repository|Project not found|The project you were looking for could not be found|\b404\b/i,
		code: "REPO_NOT_FOUND",
		hint: "Private repos also report 'not found' when the token lacks access.",
	},
	{
		test: /Could not resolve host|Connection (timed out|refused|reset)|Operation timed out|early EOF|RPC failed|unexpected disconnect|\b50[234]\b|SSL_ERROR_SYSCALL|TLS connection was non-properly terminated|Failed to connect/i,
		code: "GIT_NETWORK",
	},
];

const LFS_RULES: Rule[] = [
	{ test: /No space left on device|ENOSPC/i, code: "DISK_FULL" },
	{
		test: /over its data quota|exceeded its LFS (budget|bandwidth)|bandwidth limit|storage limit|LFS objects are not available|repository storage limit|quota/i,
		code: "LFS_QUOTA_EXCEEDED",
		hint: "The host's LFS quota is used up; buy more bandwidth/storage or move LFS to another server (.lfsconfig).",
	},
	{
		test: /LFS (is )?(not enabled|disabled)|LFS support is disabled|Git LFS is disabled/i,
		code: "LFS_UNAVAILABLE",
	},
	{
		test: /Object does not exist on the server|\[404\] Object|object .* not found|missing object/i,
		code: "LFS_OBJECT_MISSING",
		hint: "A pointer was committed without pushing its object; run `git lfs push --all` from a machine that has it.",
	},
	{
		test: /Authentication failed|\b401\b|\b403\b|credentials|Permission denied/i,
		code: "LFS_AUTH_FAILED",
	},
	{
		test: /Could not resolve host|timed out|Connection (refused|reset)|\b50[234]\b|EOF/i,
		code: "GIT_NETWORK",
	},
];

/**
 * Maps a failed git / git-lfs command to a RenderError. `extraRules` are host
 * specific and checked first.
 */
export function classifyGitError(
	err: unknown,
	phase: JobPhase,
	options: {
		lfs?: boolean;
		extraRules?: readonly Rule[];
		fallback?: ErrorCode;
	} = {},
): RenderError {
	if (err instanceof RenderError) return err;
	if (!(err instanceof CommandError)) {
		const message = err instanceof Error ? err.message : String(err);
		if (/ENOENT/.test(message)) {
			return new RenderError(
				"TOOL_MISSING",
				`A required tool is missing: ${message}`,
				{ phase },
			);
		}
		return new RenderError(options.fallback ?? "INTERNAL", redact(message), {
			phase,
			cause: err,
		});
	}
	if (err.result.timedOut) {
		return new RenderError("GIT_NETWORK", `${err.command} timed out.`, {
			phase,
			hint: "Raise FF_TIMEOUT_GIT_SEC / FF_TIMEOUT_LFS_SEC for very large repos.",
		});
	}
	const output = `${err.result.stderr}\n${err.result.stdout}`;
	const rules = [
		...(options.extraRules ?? []),
		...(options.lfs ? LFS_RULES : COMMON_RULES),
	];
	for (const rule of rules) {
		if (rule.test.test(output)) {
			return new RenderError(rule.code, err.message, {
				phase,
				hint: rule.hint,
				cause: err,
			});
		}
	}
	return new RenderError(options.fallback ?? "INTERNAL", err.message, {
		phase,
		cause: err,
	});
}

export type { Rule as ErrorRule };
