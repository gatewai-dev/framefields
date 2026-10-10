import fs from "node:fs";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import { CloudClient, type Repository } from "../cloud/client.js";
import { hostKey, readHosts, tokenFor, writeHosts } from "../config.js";
import type { Context } from "../context.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";

export const keyPrefix = (key: string) =>
	`${key.slice(0, Math.min(10, key.length - 4))}…`;

export function register(program: Command, wrap: Wrap) {
	const auth = program
		.command("auth")
		.description("Log in to Framefields Cloud and set up git");

	auth
		.command("login")
		.description(
			"Store an API key for the host (verified with GET /v1/organization)",
		)
		.option("--with-token", "read the API key from stdin")
		.addHelpText(
			"after",
			"\nIn CI or agent sandboxes, set FF_TOKEN (and FF_HOST) instead of logging in.\n\nExample:\n  echo $FF_KEY | ff auth login --with-token",
		)
		.action(
			wrap(async (ctx, opts: { withToken?: boolean }) => {
				const host = await ctx.host();
				let key: string;
				if (opts.withToken) {
					key = (await ctx.io.readStdin()).trim();
				} else if (await ctx.canPrompt()) {
					const url = `${host}/api-keys`;
					ctx.out.info(
						`Create an API key at ${url} (scopes: repo:read, repo:write, render:create, assets:sync), then paste it here.`,
					);
					ctx.io.openUrl(url);
					key = await ctx.io.prompt("API key", { secret: true });
				} else {
					throw usageError(
						"no terminal to paste a key into",
						"echo $FF_KEY | ff auth login --with-token",
					);
				}
				if (!key) throw usageError("no API key given");
				if (!key.startsWith("ff_"))
					throw usageError(
						"Framefields API keys start with ff_",
						`create one at ${host}/api-keys`,
					);
				const org = await new CloudClient(
					host,
					key,
					ctx.fetchImpl,
				).organization();
				const hosts = await readHosts(ctx.env);
				hosts[hostKey(host)] = {
					apiKey: key,
					organization: org.id,
					organizationName: org.name,
				};
				await writeHosts(ctx.env, hosts);
				ctx.out.result({ host: hostKey(host), organization: org }, () =>
					ctx.out.line(
						`logged in to ${hostKey(host)} · ${org.name} (${org.id})`,
					),
				);
				if (ctx.env.FF_TOKEN)
					ctx.out.warn(
						"FF_TOKEN is set and takes precedence over the stored key",
					);
			}),
		);

	auth
		.command("status")
		.description("Show the host, organization and API key in use")
		.action(
			wrap(async (ctx) => {
				const host = await ctx.host();
				const found = await tokenFor(ctx.env, host);
				if (!found) {
					throw new CliError(`not logged in to ${hostKey(host)}`, {
						code: "auth",
						hint: "ff auth login (or set FF_TOKEN)",
					});
				}
				const org = await new CloudClient(
					host,
					found.token,
					ctx.fetchImpl,
				).organization();
				const status = {
					host: hostKey(host),
					organization: org,
					key: keyPrefix(found.token),
					source: found.source === "env" ? "FF_TOKEN" : "hosts.json",
				};
				ctx.out.result(status, () =>
					ctx.out.view([
						["host", status.host],
						["organization", `${org.name} (${org.id})`],
						["role", org.role],
						["key", `${status.key} (from ${status.source})`],
					]),
				);
			}),
		);

	auth
		.command("logout")
		.description("Remove the stored API key for the host")
		.action(
			wrap(async (ctx) => {
				const host = hostKey(await ctx.host());
				const hosts = await readHosts(ctx.env);
				const had = host in hosts;
				delete hosts[host];
				await writeHosts(ctx.env, hosts);
				ctx.out.result({ host, removed: had }, () =>
					ctx.out.line(
						had ? `logged out of ${host}` : `no stored key for ${host}`,
					),
				);
				if (ctx.env.FF_TOKEN)
					ctx.out.warn("FF_TOKEN is still set in the environment");
			}),
		);

	auth
		.command("setup-git")
		.description(
			"Install ff as git's credential helper for the cloud's git host",
		)
		.option(
			"--hostname <host>",
			"git host to configure (default: the hosts of your repositories' remotes)",
		)
		.action(
			wrap(async (ctx, opts: { hostname?: string }) => {
				let hosts: string[];
				if (opts.hostname)
					hosts = [
						opts.hostname.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
					];
				else {
					const repos = await (await ctx.client()).listRepos();
					hosts = [...new Set(repos.map((r) => new URL(r.remoteUrl).host))];
					if (hosts.length === 0)
						throw usageError(
							"no repositories yet, so no git host to configure",
							"ff auth setup-git --hostname <git host>",
						);
				}
				const helper = `!${selfCommand()} auth git-credential`;
				for (const h of hosts) {
					const section = `credential.https://${h}`;
					// An empty helper first resets helpers inherited for this host.
					await git.gitOk(
						["config", "--global", "--replace-all", `${section}.helper`, ""],
						{ cwd: ctx.cwd },
					);
					await git.gitOk(
						["config", "--global", "--add", `${section}.helper`, helper],
						{ cwd: ctx.cwd },
					);
					await git.gitOk(
						["config", "--global", `${section}.useHttpPath`, "true"],
						{ cwd: ctx.cwd },
					);
				}
				ctx.out.result({ hosts, helper }, () => {
					for (const h of hosts)
						ctx.out.line(`git now asks ff for credentials for https://${h}`);
				});
			}),
		);

	// Called by git, not people: https://git-scm.com/docs/gitcredentials
	auth
		.command("git-credential", { hidden: true })
		.argument("<operation>", "get, store or erase")
		.action(
			wrap(async (ctx, operation: string) => {
				if (operation !== "get") return;
				const input = parseCredentialInput(await ctx.io.readStdin());
				const answer = await gitCredential(ctx, input);
				if (answer) ctx.io.stdout(answer);
			}),
		);
}

export function parseCredentialInput(text: string): Record<string, string[]> {
	const fields: Record<string, string[]> = {};
	for (const line of text.split("\n")) {
		const i = line.indexOf("=");
		if (i <= 0) continue;
		const key = line.slice(0, i);
		fields[key] = [...(fields[key] ?? []), line.slice(i + 1)];
	}
	return fields;
}

/**
 * Mints a short-lived git token for the repository git is talking to, matched
 * by URL among the organization's repositories. Answers with a bearer token
 * when git supports it (2.46+), else as a password.
 */
export async function gitCredential(
	ctx: Context,
	input: Record<string, string[]>,
): Promise<string | undefined> {
	const protocol = input.protocol?.[0];
	const host = input.host?.[0];
	if (protocol !== "https" || !host) return undefined;
	const wanted = git.normalizeRemote(
		`https://${host}/${input.path?.[0] ?? ""}`,
	);
	const client = await ctx.client();
	if (!client.token) return undefined;
	let repo: Repository | undefined;
	const linked = await git.configGet(ctx.cwd, "framefields.repo");
	const repos = await client.listRepos();
	repo = repos.find((r) => git.normalizeRemote(r.remoteUrl) === wanted);
	if (!repo && linked && !input.path) repo = repos.find((r) => r.id === linked);
	if (!repo) return undefined;
	let token: string;
	try {
		token = (await client.gitToken(repo.id, "write")).token;
	} catch (err) {
		if (!(err instanceof CliError) || err.code !== "auth") throw err;
		token = (await client.gitToken(repo.id, "read")).token;
	}
	const bearer = (input["capability[]"] ?? []).includes("authtype");
	return bearer
		? `capability[]=authtype\nauthtype=Bearer\ncredential=${token}\nephemeral=true\n`
		: `username=x-token\npassword=${token}\n`;
}

/** How git should invoke this CLI: the same node and script. */
function selfCommand(): string {
	const script = process.argv[1] ? fs.realpathSync(process.argv[1]) : "ff";
	const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
	return `${quote(process.execPath)} ${quote(script)}`;
}
