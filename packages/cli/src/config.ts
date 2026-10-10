/**
 * Per-user files under `~/.config/framefields` (or `$XDG_CONFIG_HOME`, or
 * `$FF_CONFIG_DIR`): `config.json` for `ff config`, `hosts.json` for
 * credentials (mode 0600).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliError, usageError } from "./errors.js";

export type Env = Record<string, string | undefined>;

export const DEFAULT_HOST = "https://framefields.dev";

export function configDir(env: Env): string {
	if (env.FF_CONFIG_DIR) return env.FF_CONFIG_DIR;
	const base =
		env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), ".config");
	return path.join(base, "framefields");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
	let raw: string;
	try {
		raw = await fs.readFile(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw err;
	}
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		throw new CliError(`${file} is not valid JSON: ${(err as Error).message}`);
	}
}

async function writeJson(file: string, value: unknown, mode?: number) {
	await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
	await fs.rename(tmp, file);
	if (mode !== undefined) await fs.chmod(file, mode);
}

// ── ff config ──

export const CONFIG_KEYS = {
	host: "Framefields Cloud host used when no --host, FF_HOST or linked host is set",
	editor: "Editor for composing issue and pull request bodies",
	browser: "Browser command for --web and auth login",
	prompt: "Interactive prompts: enabled or disabled",
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;
export type UserConfig = Partial<Record<ConfigKey, string>>;

export function assertConfigKey(key: string): asserts key is ConfigKey {
	if (!(key in CONFIG_KEYS)) {
		throw usageError(
			`unknown config key '${key}'`,
			`keys: ${Object.keys(CONFIG_KEYS).join(", ")}`,
		);
	}
}

export const readConfig = (env: Env) =>
	readJson<UserConfig>(path.join(configDir(env), "config.json"), {});

export async function writeConfig(env: Env, config: UserConfig) {
	await writeJson(path.join(configDir(env), "config.json"), config);
}

// ── Hosts and credentials ──

/** `framefields.dev` → `https://framefields.dev`; keeps explicit schemes and ports. */
export function hostUrl(host: string): string {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host)
		? host
		: `https://${host}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw usageError(
			`invalid host '${host}'`,
			"pass a URL such as https://framefields.dev",
		);
	}
	return `${url.protocol}//${url.host}`;
}

/** The key a host's credentials are stored under: its hostname (and port). */
export const hostKey = (host: string) => new URL(hostUrl(host)).host;

export interface HostCredentials {
	apiKey: string;
	organization?: string;
	organizationName?: string;
}

export type Hosts = Record<string, HostCredentials>;

const hostsFile = (env: Env) => path.join(configDir(env), "hosts.json");

export const readHosts = (env: Env) => readJson<Hosts>(hostsFile(env), {});

export async function writeHosts(env: Env, hosts: Hosts) {
	await writeJson(hostsFile(env), hosts, 0o600);
}

/** The API key for a host: `FF_TOKEN` first, then hosts.json. */
export async function tokenFor(
	env: Env,
	host: string,
): Promise<{ token: string; source: "env" | "file" } | undefined> {
	if (env.FF_TOKEN) return { token: env.FF_TOKEN, source: "env" };
	const entry = (await readHosts(env))[hostKey(host)];
	return entry?.apiKey ? { token: entry.apiKey, source: "file" } : undefined;
}
