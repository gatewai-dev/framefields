/**
 * Thin wrappers over the user's git binary. Short-lived cloud tokens reach git
 * through `GIT_CONFIG_*` environment variables for one invocation, so they are
 * never written to disk or shown in the process list.
 */
import { spawn } from "node:child_process";
import { CliError } from "../errors.js";

export interface GitOptions {
	cwd: string;
	/** A bearer token for the cloud remote, for this invocation only. */
	token?: string;
	/** Streams git's stderr (progress) here as it runs. */
	onStderr?: (text: string) => void;
	input?: string;
}

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

export function git(args: string[], options: GitOptions): Promise<GitResult> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
	};
	if (options.token) {
		const n = Number(env.GIT_CONFIG_COUNT ?? 0);
		env.GIT_CONFIG_COUNT = String(n + 1);
		env[`GIT_CONFIG_KEY_${n}`] = "http.extraHeader";
		env[`GIT_CONFIG_VALUE_${n}`] = `Authorization: Bearer ${options.token}`;
	}
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			cwd: options.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (d: string) => {
			stdout += d;
		});
		child.stderr.setEncoding("utf8").on("data", (d: string) => {
			stderr += d;
			options.onStderr?.(d);
		});
		child.on("error", (err) => {
			reject(
				(err as NodeJS.ErrnoException).code === "ENOENT"
					? new CliError("git is not installed or not on PATH", {
							hint: "install git: https://git-scm.com/downloads",
						})
					: err,
			);
		});
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		child.stdin.end(options.input ?? "");
	});
}

/** Runs git and returns trimmed stdout; a non-zero exit becomes a CliError. */
export async function gitOk(
	args: string[],
	options: GitOptions,
): Promise<string> {
	const result = await git(args, options);
	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout)
			.trim()
			.split("\n")
			.slice(-3)
			.join("\n  ");
		throw new CliError(
			`git ${args[0]} failed${detail ? `:\n  ${detail}` : ""}`,
		);
	}
	return result.stdout.trim();
}

/** Trimmed stdout, or undefined when git exits non-zero (an unset config key, say). */
export async function gitMaybe(
	args: string[],
	cwd: string,
): Promise<string | undefined> {
	const result = await git(args, { cwd });
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export const isRepo = async (cwd: string) =>
	(await gitMaybe(["rev-parse", "--is-inside-work-tree"], cwd)) === "true";

export const topLevel = (cwd: string) =>
	gitMaybe(["rev-parse", "--show-toplevel"], cwd);

export const currentBranch = (cwd: string) =>
	gitMaybe(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);

export const remoteUrl = (cwd: string, remote = "origin") =>
	gitMaybe(["remote", "get-url", remote], cwd);

export const configGet = (cwd: string, key: string) =>
	gitMaybe(["config", "--get", key], cwd);

export async function configSet(
	cwd: string,
	key: string,
	value: string,
	scope: "local" | "global" = "local",
) {
	await gitOk(["config", `--${scope}`, key, value], { cwd });
}

/** Paths with uncommitted changes to tracked files (untracked files ignored). */
export async function dirtyFiles(cwd: string): Promise<string[]> {
	const out = await gitOk(["status", "--porcelain", "--untracked-files=no"], {
		cwd,
	});
	return out ? out.split("\n").map((l) => l.slice(3)) : [];
}

/** Normalises a remote URL for comparison: no credentials, no trailing `.git` or slash. */
export function normalizeRemote(url: string): string {
	try {
		const u = new URL(url);
		u.username = "";
		u.password = "";
		return `${u.host}${u.pathname}`
			.replace(/\.git$/, "")
			.replace(/\/+$/, "")
			.toLowerCase();
	} catch {
		return url
			.replace(/\.git$/, "")
			.replace(/\/+$/, "")
			.toLowerCase();
	}
}
