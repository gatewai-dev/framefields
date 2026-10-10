/**
 * The cloud half end to end against a fake Framefields Cloud whose
 * repositories are real bare git repos: create → push with assets → clone
 * elsewhere → assets restored and verified, then issues, pull requests and
 * renders.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeCloud, startFakeCloud } from "./fake-cloud.js";
import {
	cleanupTmp,
	ff,
	gitEnv,
	type RunOptions,
	tmpdir,
	writeFiles,
} from "./helpers.js";

let cloud: FakeCloud;
let home: string;
let work: string;
let env: Record<string, string>;

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeAll(async () => {
	home = tmpdir("ff-home-");
	gitEnv(home);
	cloud = await startFakeCloud(tmpdir("ff-cloud-"), { partSize: 8 });
	env = { FF_CONFIG_DIR: path.join(home, "config"), FF_HOST: cloud.url };
	work = tmpdir("ff-work-");
});
afterAll(async () => {
	await cloud.close();
	cleanupTmp();
});

const run = (args: string[], options: Partial<RunOptions> = {}) =>
	ff(args, { cwd: work, ...options, env: { ...env, ...options.env } });

describe("auth", () => {
	it("is not logged in at first (exit 3)", async () => {
		const r = await run(["repo", "list"]);
		expect(r.code).toBe(3);
		expect(r.stderr).toContain("hint: ff auth login (or set FF_TOKEN)");
		expect((await run(["auth", "status"])).code).toBe(3);
	});

	it("refuses to prompt without a terminal", async () => {
		const r = await run(["auth", "login"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("echo $FF_KEY | ff auth login --with-token");
	});

	it("rejects a bad key with exit 3", async () => {
		const r = await run(["auth", "login", "--with-token"], {
			stdin: "ff_wrong\n",
		});
		expect(r.code).toBe(3);
	});

	it("logs in with a key from stdin, stored 0600", async () => {
		const r = await run(["auth", "login", "--with-token", "--json"], {
			stdin: `${cloud.apiKey}\n`,
		});
		expect(r.code).toBe(0);
		expect(r.json()).toMatchObject({ organization: { id: "org_test" } });
		const file = path.join(env.FF_CONFIG_DIR as string, "hosts.json");
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		const hosts = JSON.parse(fs.readFileSync(file, "utf8"));
		expect(Object.values(hosts)).toEqual([
			{
				apiKey: cloud.apiKey,
				organization: "org_test",
				organizationName: "Test Org",
			},
		]);
		const status = await run(["auth", "status"]);
		expect(status.code).toBe(0);
		expect(status.stdout).toContain("Test Org (org_test)");
		expect(status.stdout).not.toContain(cloud.apiKey);
	});

	it("FF_TOKEN overrides the stored key", async () => {
		const r = await run(["auth", "status", "--json"], {
			env: { FF_TOKEN: "ff_other" },
		});
		expect(r.code).toBe(3);
	});

	it("maps a missing scope to exit 3 with the scope's name", async () => {
		cloud.scopes = ["repo:read"];
		try {
			const r = await run(["repo", "create", "nope"]);
			expect(r.code).toBe(3);
			expect(r.stderr).toContain("Missing required scope: repo:write");
			expect(r.stderr).toContain("'repo:write' scope");
		} finally {
			cloud.scopes = [
				"repo:read",
				"repo:write",
				"render:create",
				"assets:sync",
			];
		}
	});
});

describe("repositories and sync", () => {
	let project: string;
	const plate = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"); // 36 bytes → 5 parts of 8

	it("creates a repository, links the directory and pushes with assets", async () => {
		expect((await run(["init", "film", "-q"])).code).toBe(0);
		project = path.join(work, "film");
		writeFiles(project, {
			"assets/plate.bin": plate,
			"assets/fonts/Inter.ttf": "font bytes",
			"assets/.DS_Store": "junk",
			"assets/empty.txt": "",
		});
		git(project, "add", "-A");
		git(project, "commit", "-qm", "first");

		const created = await run(["repo", "create", "--push", "--json"], {
			cwd: project,
		});
		expect(created.code, created.stderr).toBe(0);
		const repo = created.json<{
			id: string;
			name: string;
			pushed: { lockfileCommitted: boolean };
		}>();
		expect(repo.name).toBe("film");
		expect(repo.pushed.lockfileCommitted).toBe(true);
		expect(git(project, "config", "framefields.repo")).toBe(repo.id);
		expect(git(project, "log", "-1", "--format=%s")).toBe(
			"assets: sync external assets",
		);

		const lock = JSON.parse(
			fs.readFileSync(path.join(project, "framefields.assets.json"), "utf8"),
		);
		expect(Object.keys(lock.assets).sort()).toEqual([
			"assets/fonts/Inter.ttf",
			"assets/plate.bin",
		]);
		expect(cloud.blobs.get(lock.assets["assets/plate.bin"].sha256)).toEqual(
			plate,
		);
		expect(cloud.requests.filter((r) => r.includes("/parts/")).length).toBe(
			5 + 2,
		);
		const refs = cloud.assetRefs.get(`${repo.id} refs/heads/main`);
		expect(refs?.commitSha).toBe(git(project, "rev-parse", "HEAD"));
		expect(git(project, "ls-remote", "origin", "main").split("\t")[0]).toBe(
			git(project, "rev-parse", "HEAD"),
		);
	});

	it("push is idempotent", async () => {
		const before = cloud.requests.length;
		const r = await run(["push", "--json"], { cwd: project });
		expect(r.code, r.stderr).toBe(0);
		expect(r.json()).toMatchObject({
			lockfileCommitted: false,
			assets: { uploaded: [], lockfileChanged: false },
		});
		expect(
			cloud.requests.slice(before).filter((x) => x.includes("/parts/")),
		).toEqual([]);
	});

	it("asset sync resumes an interrupted upload", async () => {
		const big = Buffer.from("x".repeat(40));
		writeFiles(project, { "assets/big.bin": big });
		// Upload two parts by hand, as if the last run died midway.
		const { createHash } = await import("node:crypto");
		const sha256 = createHash("sha256").update(big).digest("hex");
		const repoId = git(project, "config", "framefields.repo");
		const diff = (await (
			await fetch(`${cloud.url}/v1/repos/${repoId}/assets/diff`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${cloud.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					assets: [{ sha256, size: 40, mimeType: "application/octet-stream" }],
				}),
			})
		).json()) as { missing: { partUrl: string }[] };
		for (const n of [1, 2]) {
			await fetch(`${cloud.url}${diff.missing[0]?.partUrl}${n}`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${cloud.apiKey}` },
				body: big.subarray((n - 1) * 8, n * 8),
			});
		}
		const before = cloud.requests.length;
		const dry = await run(["asset", "sync", "--dry-run", "--json"], {
			cwd: project,
		});
		expect(dry.json()).toMatchObject({
			dryRun: true,
			uploaded: ["assets/big.bin"],
		});
		const r = await run(["asset", "sync", "--json"], { cwd: project });
		expect(r.code, r.stderr).toBe(0);
		expect(r.json()).toMatchObject({
			uploaded: ["assets/big.bin"],
			lockfileChanged: true,
		});
		const parts = cloud.requests
			.slice(before)
			.filter((x) => x.includes("/parts/"));
		expect(parts.map((x) => x.split("/").pop())).toEqual(["3", "4", "5"]);
		expect(cloud.blobs.get(sha256)).toEqual(big);
	});

	it("asset status reports local vs lockfile vs cloud", async () => {
		writeFiles(project, {
			"assets/fonts/Inter.ttf": "changed font",
			"assets/new.bin": "new",
		});
		fs.rmSync(path.join(project, "assets/big.bin"));
		const r = await run(["asset", "status", "--json"], { cwd: project });
		expect(r.json()).toMatchObject({
			new: ["assets/new.bin"],
			modified: ["assets/fonts/Inter.ttf"],
			missing: ["assets/big.bin"],
			notUploaded: [],
		});
		git(project, "checkout", "--", ".");
		git(project, "clean", "-fdq", "--", "assets");
		writeFiles(project, { "assets/fonts/Inter.ttf": "font bytes" });
	});

	it("clones elsewhere and restores the assets, verified", async () => {
		const elsewhere = tmpdir("ff-clone-");
		const r = await run(["clone", "film", "copy", "--json"], {
			cwd: elsewhere,
		});
		expect(r.code, r.stderr).toBe(0);
		const dir = path.join(elsewhere, "copy");
		expect(fs.readFileSync(path.join(dir, "assets/plate.bin"))).toEqual(plate);
		expect(
			fs.readFileSync(path.join(dir, "assets/fonts/Inter.ttf"), "utf8"),
		).toBe("font bytes");
		expect(git(dir, "config", "framefields.repo")).toBe(
			git(project, "config", "framefields.repo"),
		);
		expect(
			(await run(["asset", "status", "--json"], { cwd: dir })).json(),
		).toMatchObject({ new: [], modified: [], missing: [] });

		// A corrupted blob is refused, and nothing is written.
		const lock = JSON.parse(
			fs.readFileSync(path.join(dir, "framefields.assets.json"), "utf8"),
		);
		const sha = lock.assets["assets/plate.bin"].sha256;
		const good = cloud.blobs.get(sha) as Buffer;
		cloud.blobs.set(sha, Buffer.from("tampered"));
		fs.rmSync(path.join(dir, "assets/plate.bin"));
		const pulled = await run(["asset", "pull"], { cwd: dir });
		expect(pulled.code).toBe(1);
		expect(pulled.stderr).toContain("checksum mismatch");
		expect(fs.existsSync(path.join(dir, "assets/plate.bin"))).toBe(false);
		cloud.blobs.set(sha, good);
		expect((await run(["asset", "pull"], { cwd: dir })).code).toBe(0);
		expect(fs.readFileSync(path.join(dir, "assets/plate.bin"))).toEqual(plate);
	});

	it("repo list, view and fork", async () => {
		const list = await run(["repo", "list"], { cwd: project });
		expect(list.stdout).toMatch(/^NAME {2}ID/);
		expect(list.stdout).toContain("film");
		const view = await run(["repo", "view", "--json"], { cwd: project });
		expect(view.json()).toMatchObject({
			name: "film",
			compositions: { defaultId: "film" },
		});
		const fork = await run(
			["repo", "fork", "film", "--name", "film-2", "--json"],
			{ cwd: project },
		);
		expect(fork.json()).toMatchObject({ name: "film-2" });
		expect(
			(await run(["repo", "delete", "film-2"], { cwd: project })).code,
		).toBe(2);
		expect(
			(await run(["repo", "delete", "film-2", "--yes"], { cwd: project })).code,
		).toBe(0);
	});

	it("links by origin when git config has no repo", async () => {
		const elsewhere = tmpdir("ff-relink-");
		const remote = [...cloud.repos.values()].find((r) => r.name === "film")
			?.remoteUrl as string;
		git(elsewhere, "clone", "-q", remote, "plain");
		const dir = path.join(elsewhere, "plain");
		const r = await run(["repo", "view", "--json"], { cwd: dir });
		expect(r.code, r.stderr).toBe(0);
		expect(r.stderr).toContain("by its origin remote");
		expect(git(dir, "config", "framefields.repo")).toMatch(/^repo_/);
	});

	describe("issues and pull requests", () => {
		it("issue create, list, view, comment, edit, close", async () => {
			const created = await run(
				[
					"issue",
					"create",
					"--title",
					"Grain too strong",
					"--body",
					"In the intro",
					"--label",
					"look",
				],
				{ cwd: project },
			);
			expect(created.code, created.stderr).toBe(0);
			expect(created.stdout).toMatch(/\/issues\/1\n$/);
			const list = await run(["issue", "list"], { cwd: project });
			expect(list.stdout).toContain("#1  Grain too strong  look");
			expect(
				(
					await run(["issue", "comment", "1", "--body-file", "-"], {
						cwd: project,
						stdin: "Agreed",
					})
				).code,
			).toBe(0);
			expect(
				(
					await run(
						[
							"issue",
							"edit",
							"#1",
							"--add-label",
							"p1",
							"--remove-label",
							"look",
						],
						{ cwd: project },
					)
				).code,
			).toBe(0);
			expect(
				(
					await run(["issue", "close", "1", "--comment", "Fixed"], {
						cwd: project,
					})
				).code,
			).toBe(0);
			const view = await run(["issue", "view", "1", "--comments", "--json"], {
				cwd: project,
			});
			expect(view.json()).toMatchObject({
				state: "closed",
				labels: ["p1"],
				commentCount: 2,
			});
			expect(
				(await run(["issue", "view", "1", "--comments"], { cwd: project }))
					.stdout,
			).toContain("Agreed");
			expect(
				(await run(["issue", "list", "--json"], { cwd: project })).json(),
			).toEqual([]);
		});

		it("pr create pushes the branch, pr merge merges with git and records it", async () => {
			git(project, "switch", "-qc", "softer-grain");
			writeFiles(project, {
				"src/film.ts": `${fs.readFileSync(path.join(project, "src/film.ts"), "utf8")}\n// softer\n`,
				"assets/grain.bin": "grain!",
			});
			git(project, "commit", "-qam", "softer grain");
			const created = await run(
				[
					"pr",
					"create",
					"--title",
					"Softer grain",
					"--body",
					"",
					"--draft",
					"--json",
				],
				{ cwd: project },
			);
			expect(created.code, created.stderr).toBe(0);
			const pr = created.json<{
				number: number;
				headRef: string;
				baseRef: string;
			}>();
			expect(pr).toMatchObject({
				number: 2,
				headRef: "softer-grain",
				baseRef: "main",
			});
			expect(git(project, "ls-remote", "origin", "softer-grain")).not.toBe("");

			const draft = await run(["pr", "merge", "2"], { cwd: project });
			expect(draft.code).toBe(1);
			expect(draft.stderr).toContain("hint: ff pr ready 2");
			expect((await run(["pr", "ready", "2"], { cwd: project })).code).toBe(0);

			const merged = await run(
				["pr", "merge", "2", "--delete-branch", "--json"],
				{ cwd: project },
			);
			expect(merged.code, merged.stderr).toBe(0);
			expect(git(project, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
			expect(git(project, "log", "-1", "--format=%s", "origin/main")).toBe(
				"Merge pull request #2 from softer-grain",
			);
			expect(git(project, "ls-remote", "origin", "softer-grain")).toBe("");
			expect(cloud.issues.find((i) => i.number === 2)?.state).toBe("merged");
			const lock = JSON.parse(
				git(project, "show", "origin/main:framefields.assets.json"),
			);
			expect(Object.keys(lock.assets)).toContain("assets/grain.bin");
			expect(
				(
					await run(["pr", "list", "--state", "closed", "--json"], {
						cwd: project,
					})
				).json(),
			).toHaveLength(1);
		});

		it("pr checkout fetches the head branch", async () => {
			git(project, "switch", "-qc", "titles");
			writeFiles(project, { "notes.md": "titles" });
			git(project, "add", "notes.md");
			git(project, "commit", "-qm", "titles");
			expect(
				(
					await run(["pr", "create", "-t", "Titles", "-b", "x"], {
						cwd: project,
					})
				).code,
			).toBe(0);
			git(project, "switch", "-q", "main");
			git(project, "branch", "-qD", "titles");
			const r = await run(["pr", "checkout", "3"], { cwd: project });
			expect(r.code, r.stderr).toBe(0);
			expect(git(project, "rev-parse", "--abbrev-ref", "HEAD")).toBe("titles");
			git(project, "switch", "-q", "main");
		});
	});

	describe("renders", () => {
		it("refuses an unpushed HEAD with the ff push hint", async () => {
			writeFiles(project, { "local.md": "x" });
			git(project, "add", "local.md");
			git(project, "commit", "-qm", "local only");
			const r = await run(["render"], { cwd: project });
			expect(r.code).toBe(1);
			expect(r.stderr).toMatch(
				/HEAD \([0-9a-f]{7}\) is not pushed to origin\n {2}hint: ff push\n/,
			);
			expect((await run(["push"], { cwd: project })).code).toBe(0);
		});

		it("dispatches by composition id and prints the job", async () => {
			const r = await run(["render", "film", "--quality", "high", "--json"], {
				cwd: project,
			});
			expect(r.code, r.stderr).toBe(0);
			const job = r.json<{
				jobId: string;
				composition: string;
				commitSha: string;
			}>();
			expect(job).toMatchObject({
				composition: "film",
				commitSha: git(project, "rev-parse", "HEAD"),
			});
			expect(cloud.renders.get(job.jobId)?.renderParams).toEqual({
				quality: "high",
			});
			expect((await run(["render", "step-9"], { cwd: project })).code).toBe(2);
		});

		it("sends file#export as an explicit entry/export", async () => {
			const r = await run(["render", "src/film.ts#buildFilm", "--json"], {
				cwd: project,
			});
			const job = cloud.renders.get(r.json<{ jobId: string }>().jobId);
			expect(job).toMatchObject({
				entryPath: "src/film.ts",
				exportName: "buildFilm",
			});
		});

		it("--download waits and saves the deliverable", async () => {
			const r = await run(["render", "--download", "--json"], { cwd: project });
			expect(r.code, r.stderr).toBe(0);
			const result = r.json<{ status: string; files: string[] }>();
			expect(result.status).toBe("completed");
			expect(
				fs.readFileSync(path.join(project, result.files[0] as string), "utf8"),
			).toMatch(/^fake video/);
			const list = await run(
				["render", "list", "--status", "completed", "--json"],
				{ cwd: project },
			);
			expect(list.json<unknown[]>().length).toBe(1);
		}, 20000);

		it("render cancel explains the missing endpoint", async () => {
			const [jobId] = [...cloud.renders.keys()];
			const r = await run(["render", "cancel", jobId as string], {
				cwd: project,
			});
			expect(r.code).toBe(1);
			expect(r.stderr).toContain("does not support cancelling renders yet");
		});
	});

	it("ff api makes raw authenticated requests", async () => {
		const r = await run(["api", "/v1/organization"], { cwd: project });
		expect(JSON.parse(r.stdout)).toMatchObject({
			organization: { id: "org_test" },
		});
		const created = await run(
			["api", "/v1/repos", "-f", "name=via-api", "-F", "nothing=null"],
			{ cwd: project },
		);
		expect(created.code, created.stderr).toBe(0);
		expect(JSON.parse(created.stdout)).toMatchObject({ name: "via-api" });
		const missing = await run(["api", "/v1/nope"], { cwd: project });
		expect(missing.code).toBe(1);
	});

	it("git credential helper answers with a bearer token when git can take one", async () => {
		const repo = [...cloud.repos.values()].find((r) => r.name === "film");
		const remote = new URL(
			(repo?.remoteUrl as string).replace("file://", "https://git.example"),
		);
		const stdin = `protocol=https\nhost=${remote.host}\npath=${remote.pathname.slice(1)}\ncapability[]=authtype\n\n`;
		// The fake's remotes are file:// URLs; point the lookup at an https twin.
		(repo as { remoteUrl: string }).remoteUrl = remote.toString();
		try {
			const bearer = await run(["auth", "git-credential", "get"], {
				cwd: project,
				stdin,
			});
			expect(bearer.stdout).toMatch(
				/^capability\[\]=authtype\nauthtype=Bearer\ncredential=art_write_\d+\nephemeral=true\n$/,
			);
			const basic = await run(["auth", "git-credential", "get"], {
				cwd: project,
				stdin: stdin.replace("capability[]=authtype\n", ""),
			});
			expect(basic.stdout).toMatch(
				/^username=x-token\npassword=art_write_\d+\n$/,
			);
			const other = await run(["auth", "git-credential", "get"], {
				cwd: project,
				stdin: "protocol=https\nhost=github.com\npath=x/y.git\n",
			});
			expect(other.stdout).toBe("");
		} finally {
			(repo as { remoteUrl: string }).remoteUrl = `file://${remote.pathname}`;
		}
	});

	it("auth logout removes the key", async () => {
		expect((await run(["auth", "logout"])).stdout).toContain("logged out");
		expect((await run(["repo", "list"])).code).toBe(3);
	});
});
