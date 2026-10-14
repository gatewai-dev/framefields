import { RenderError } from "../errors.js";

export interface RepoRef {
	/** The URL handed to git, credentials stripped. */
	url: string;
	protocol: "https" | "http" | "ssh" | "file";
	/** Lowercased hostname, "" for file:// */
	host: string;
	port?: number;
	/** owner/name without a trailing .git */
	path: string;
	/** host/owner/name, what the allowlist matches against */
	id: string;
}

const SCP_LIKE = /^(?:([^@/\s]+)@)?([^:/\s]+):(?!\/)(.+)$/;

/**
 * Parses https://, ssh:// and scp-like (git@host:owner/repo) URLs. Anything
 * else (ext::, local paths, …) is rejected; file:// only when allowed.
 */
export function parseRepoUrl(
	raw: string,
	options: { allowLocal?: boolean } = {},
): RepoRef {
	const input = raw.trim();
	if (/^ext::/i.test(input) || /[\0\n\r]/.test(input)) {
		throw invalid(raw, "unsupported transport");
	}

	if (/^file:\/\//i.test(input)) {
		if (!options.allowLocal) {
			throw new RenderError(
				"REPO_NOT_ALLOWED",
				"Local repositories are disabled (FF_ALLOW_LOCAL_REPOS).",
			);
		}
		const url = new URL(input);
		const path = stripGit(decodeURIComponent(url.pathname));
		return { url: input, protocol: "file", host: "", path, id: `file:${path}` };
	}

	if (/^(https?|ssh):\/\//i.test(input)) {
		let url: URL;
		try {
			url = new URL(input);
		} catch {
			throw invalid(raw, "malformed URL");
		}
		const protocol = url.protocol.slice(0, -1) as "https" | "http" | "ssh";
		const path = stripGit(url.pathname.replace(/^\/+/, ""));
		if (!path) throw invalid(raw, "missing repository path");
		const host = url.hostname.toLowerCase();
		const port = url.port ? Number(url.port) : undefined;
		// Credentials never travel in the URL; they come from the helper.
		const user = protocol === "ssh" ? url.username || "git" : "";
		const clean = `${protocol}://${user ? `${user}@` : ""}${url.host}/${url.pathname.replace(/^\/+/, "")}`;
		return { url: clean, protocol, host, port, path, id: `${host}/${path}` };
	}

	const scp = SCP_LIKE.exec(input);
	if (scp && !input.startsWith("/") && !input.startsWith(".")) {
		const [, user = "git", hostRaw, rest] = scp;
		const host = hostRaw.toLowerCase();
		const path = stripGit(rest.replace(/^\/+/, ""));
		if (!path) throw invalid(raw, "missing repository path");
		return {
			url: `${user}@${hostRaw}:${rest}`,
			protocol: "ssh",
			host,
			path,
			id: `${host}/${path}`,
		};
	}

	throw invalid(raw, "expected an https://, ssh:// or git@host:owner/repo URL");
}

function stripGit(path: string): string {
	return path.replace(/\/+$/, "").replace(/\.git$/, "");
}

function invalid(raw: string, why: string): RenderError {
	return new RenderError("JOB_INVALID", `Invalid repo URL "${raw}": ${why}.`);
}

/**
 * Matches `host/owner/name` against allowlist globs. `*` matches within one
 * path segment, `**` across segments. Matching is case-insensitive.
 */
export function isRepoAllowed(
	id: string,
	patterns: readonly string[],
): boolean {
	const subject = id.toLowerCase();
	return patterns.some((p) => globToRegExp(p.toLowerCase()).test(subject));
}

export function isHostAllowed(
	host: string,
	patterns: readonly string[],
): boolean {
	const h = host.toLowerCase();
	return patterns.some((p) => {
		const patternHost = p.toLowerCase().split("/")[0];
		return globToRegExp(patternHost).test(h);
	});
}

function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				re += ".*";
				i++;
			} else {
				re += "[^/]*";
			}
		} else {
			re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re.replace(/\/$/, "")}$`);
}
