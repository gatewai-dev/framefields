import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import { registerSecret } from "../redact.js";
import { hostProfile } from "./hosts.js";
import { isHostAllowed, type RepoRef } from "./repo-url.js";

export interface JobCredentials {
	username?: string;
	token?: string;
	sshKey?: string;
}

/**
 * Environment + `-c` flags for every git / git-lfs call of one job. Secrets
 * live only in this env (passed to the git subprocess), never in URLs,
 * `.git/config`, files in the workspace, or the worker's process.env.
 */
export interface GitSession {
	env: NodeJS.ProcessEnv;
	configArgs: string[];
	dispose(): Promise<void>;
}

/** Shell credential helper: answers `get` from FF_CRED_<HOST>_USER/_PASS. */
const HELPER = `#!/bin/sh
[ "$1" = get ] || exit 0
host=""
while IFS= read -r line; do
  [ -z "$line" ] && break
  case "$line" in host=*) host="\${line#host=}";; esac
done
[ -n "$host" ] || exit 0
key=$(printf '%s' "$host" | tr -c 'A-Za-z0-9' '_' | tr 'a-z' 'A-Z')
eval "user=\\\${FF_CRED_\${key}_USER:-}"
eval "pass=\\\${FF_CRED_\${key}_PASS:-}"
[ -n "$pass" ] || exit 0
printf 'username=%s\\npassword=%s\\n' "$user" "$pass"
`;

export function credEnvKey(host: string): string {
	return host.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

/** Bundled known_hosts, generated at image build (PLAN.md §6.5). */
const BUNDLED_KNOWN_HOSTS = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../deploy/known_hosts",
);

/**
 * Builds the per-host credential map: the configured token for the job's
 * repo host, FF_GIT_CREDENTIALS entries for allowlisted hosts, and per-job
 * credentials when enabled. Nothing is answered for other hosts (LFS CDNs).
 */
export function credentialMap(
	repo: RepoRef,
	config: RendererConfig,
	job?: JobCredentials,
): Map<string, { username: string; password: string }> {
	const map = new Map<string, { username: string; password: string }>();
	const put = (host: string, token: string, username?: string) => {
		if (!isHostAllowed(host.split(":")[0], config.source.allowlist)) return;
		const user =
			username ?? hostProfile(host.split(":")[0], config).defaultUsername;
		if (!user) {
			throw new RenderError(
				"GIT_AUTH_FAILED",
				`No username for ${host}: set GIT_USERNAME or {"username", "token"} in FF_GIT_CREDENTIALS.`,
				{ phase: "resolve" },
			);
		}
		map.set(host.toLowerCase(), { username: user, password: token });
	};

	for (const [host, cred] of Object.entries(config.git.credentials)) {
		if (typeof cred === "string") put(host, cred);
		else put(host, cred.token, cred.username);
	}
	const repoHost = repo.port ? `${repo.host}:${repo.port}` : repo.host;
	if (config.git.token && !map.has(repoHost)) {
		put(repoHost, config.git.token, config.git.username);
	}
	if (job?.token) {
		registerSecret(job.token);
		put(repoHost, job.token, job.username);
	}
	return map;
}

export async function openGitSession(
	repo: RepoRef,
	config: RendererConfig,
	job?: JobCredentials,
): Promise<GitSession> {
	const dir = await fs.mkdtemp(path.join(secretTmpRoot(), "ff-git-"));
	await fs.chmod(dir, 0o700);

	const helper = path.join(dir, "credential-helper");
	await fs.writeFile(helper, HELPER, { mode: 0o700 });

	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: dir,
		LANG: "C",
		LC_ALL: "C",
		TZ: "UTC",
		// Isolate from the host's git config (credential stores, insteadOf, hooks).
		// The file is $HOME/.gitconfig too: git-lfs's file:// agent drops
		// GIT_CONFIG_GLOBAL (and -c) but still reads the home config.
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: path.join(dir, ".gitconfig"),
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/bin/false",
		SSH_ASKPASS: "/bin/false",
		GIT_LFS_SKIP_SMUDGE: "1",
		GCM_INTERACTIVE: "never",
	};
	// A local repo (FF_ALLOW_LOCAL_REPOS) usually belongs to another user;
	// git, and git-lfs's agent running git inside it, must treat it as safe.
	const safe =
		repo.protocol === "file"
			? `[safe]\n\tdirectory = ${new URL(repo.url).pathname}\n`
			: "";
	await fs.writeFile(env.GIT_CONFIG_GLOBAL as string, safe, { mode: 0o600 });

	for (const [host, cred] of credentialMap(repo, config, job)) {
		env[`FF_CRED_${credEnvKey(host)}_USER`] = cred.username;
		env[`FF_CRED_${credEnvKey(host)}_PASS`] = cred.password;
	}

	const configArgs = [
		"-c",
		"credential.helper=",
		"-c",
		`credential.helper=${helper}`,
		"-c",
		"credential.useHttpPath=false",
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.symlinks=true",
		"-c",
		"core.longpaths=true",
		"-c",
		`protocol.file.allow=${config.source.allowLocal ? "always" : "never"}`,
		"-c",
		"protocol.ext.allow=never",
		"-c",
		"submodule.recurse=false",
		"-c",
		"fetch.recurseSubmodules=false",
		"-c",
		"advice.detachedHead=false",
		"-c",
		"gc.auto=0",
		"-c",
		"maintenance.auto=false",
		"-c",
		"filter.lfs.process=git-lfs filter-process --skip",
		"-c",
		"filter.lfs.smudge=git-lfs smudge --skip -- %f",
		"-c",
		"filter.lfs.clean=git-lfs clean -- %f",
		"-c",
		"filter.lfs.required=false",
	];

	if (config.git.caBundle) {
		const ca = path.join(dir, "ca.pem");
		await fs.writeFile(ca, config.git.caBundle, { mode: 0o600 });
		configArgs.push("-c", `http.sslCAInfo=${ca}`);
	}

	if (repo.protocol === "ssh") {
		const sshKey = job?.sshKey ?? config.git.sshKey;
		const knownHosts = path.join(dir, "known_hosts");
		const bundled = existsSync(BUNDLED_KNOWN_HOSTS)
			? await fs.readFile(BUNDLED_KNOWN_HOSTS, "utf8")
			: "";
		await fs.writeFile(
			knownHosts,
			`${bundled}\n${config.git.sshKnownHosts ?? ""}\n`,
			{
				mode: 0o600,
			},
		);
		const ssh = [
			"ssh",
			"-o",
			"BatchMode=yes",
			"-o",
			`UserKnownHostsFile=${knownHosts}`,
			"-o",
			`StrictHostKeyChecking=${config.git.sshAcceptNew ? "accept-new" : "yes"}`,
			"-o",
			"ConnectTimeout=30",
		];
		if (sshKey) {
			const keyFile = path.join(dir, "id_key");
			await fs.writeFile(keyFile, decodeKey(sshKey), { mode: 0o600 });
			ssh.push("-o", "IdentitiesOnly=yes", "-i", keyFile);
		}
		env.GIT_SSH_COMMAND = ssh.map(shellQuote).join(" ");
	}

	return {
		env,
		configArgs,
		dispose: () => fs.rm(dir, { recursive: true, force: true }),
	};
}

/** tmpfs where available, so keys never hit a persistent disk. */
function secretTmpRoot(): string {
	return existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir();
}

function decodeKey(value: string): string {
	const text = value.includes("PRIVATE KEY")
		? value
		: Buffer.from(value, "base64").toString("utf8");
	return text.endsWith("\n") ? text : `${text}\n`;
}

function shellQuote(arg: string): string {
	return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

export const _internal = { HELPER };
