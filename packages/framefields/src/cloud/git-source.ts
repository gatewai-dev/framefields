/**
 * Where a cloud render gets the project from: the git repo the working
 * directory is in, at the commit checked out now. Cloud workers fetch from
 * the remote, so that commit has to be pushed; uncommitted changes are not
 * rendered.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export interface CloudSource {
	repo: string;
	ref?: string;
	commit?: string;
	/** The project's folder inside the repo (monorepos), `.` at the root. */
	workdir?: string;
}

export interface ResolvedSource {
	source: CloudSource;
	/** The entry relative to `source.workdir`, as the worker loads it. */
	entry: string;
	/** Things that render differently than the user may expect (uncommitted changes). */
	warnings: string[];
}

/** Reads repo, branch, commit and folder from git, and checks the commit is pushed. */
export function resolveGitSource(cwd: string, entry: string): ResolvedSource {
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	let root: string;
	try {
		root = git("rev-parse", "--show-toplevel");
	} catch {
		throw new Error(
			`${cwd} is not in a git repository. Cloud renders fetch the project from git: commit it and push it to a remote first.`,
		);
	}
	// git reports the root with symlinks resolved (macOS /var → /private/var).
	const workdir =
		path
			.relative(realpathSync(root), realpathSync(cwd))
			.split(path.sep)
			.join("/") || ".";
	const relEntry = path
		.relative(cwd, path.resolve(cwd, entry))
		.split(path.sep)
		.join("/");
	if (relEntry.startsWith("../") || path.isAbsolute(relEntry))
		throw new Error(
			`${entry} is outside ${cwd}; run from the project folder that contains it.`,
		);

	const branch = git("rev-parse", "--abbrev-ref", "HEAD");
	const commit = git("rev-parse", "HEAD");
	const remoteName = upstreamRemote(git, branch) ?? "origin";
	let remoteUrl: string;
	try {
		remoteUrl = git("remote", "get-url", remoteName);
	} catch {
		throw new Error(
			`The repository has no "${remoteName}" remote. Push the project to a git host first.`,
		);
	}
	const pushed = git("branch", "-r", "--contains", commit);
	if (!pushed)
		throw new Error(
			`Commit ${commit.slice(0, 7)} is not on ${remoteName}. Push it first (\`git push\`): cloud workers fetch the project from the remote.`,
		);
	const dirty = git("status", "--porcelain", "--untracked-files=no", "--", ".");
	return {
		source: {
			repo: toHttps(remoteUrl),
			...(branch !== "HEAD" && { ref: branch }),
			commit,
			workdir,
		},
		entry: relEntry,
		warnings: dirty
			? [
					`Uncommitted changes are not rendered: the cloud renders commit ${commit.slice(0, 7)}.`,
				]
			: [],
	};
}

function upstreamRemote(
	git: (...args: string[]) => string,
	branch: string,
): string | undefined {
	if (branch === "HEAD") return undefined;
	try {
		return git("config", `branch.${branch}.remote`) || undefined;
	} catch {
		return undefined;
	}
}

/** `git@github.com:acme/films.git` → `https://github.com/acme/films.git`; credentials dropped. */
export function toHttps(url: string): string {
	const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(url);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	const parsed = URL.canParse(url) ? new URL(url) : undefined;
	if (parsed && (parsed.protocol === "ssh:" || parsed.protocol === "git:"))
		return `https://${parsed.hostname}${parsed.pathname}`;
	if (parsed?.protocol === "https:" || parsed?.protocol === "http:") {
		parsed.username = "";
		parsed.password = "";
		return parsed.toString();
	}
	return url;
}
