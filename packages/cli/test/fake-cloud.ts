// biome-ignore-all lint/suspicious/noAssignInExpressions: route matching reads best as `if ((match = re.exec(path)))`
/**
 * An in-memory Framefields Cloud with the routes `ff` uses, shaped like the
 * real worker's responses. Repositories are bare git repos on disk, so push,
 * clone and merge run real git.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

interface Repo {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	visibility: "public" | "private";
	defaultBranch: string;
	remoteUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface Intent {
	id: string;
	sha256: string;
	size: number;
	mimeType: string;
	parts: Map<number, Buffer>;
}

interface IssueRow {
	id: string;
	repoId: string;
	number: number;
	kind: "issue" | "pull";
	title: string;
	body: string;
	state: "open" | "closed" | "merged";
	labels: string[];
	headRef: string | null;
	baseRef: string | null;
	isDraft: boolean;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	events: {
		id: string;
		kind: string;
		body: string | null;
		createdAt: string;
	}[];
}

export interface FakeCloud {
	url: string;
	apiKey: string;
	org: { id: string; name: string; slug: string; role: string };
	repos: Map<string, Repo>;
	blobs: Map<string, Buffer>;
	assetRefs: Map<string, { ref: string; commitSha: string; hashes: string[] }>;
	renders: Map<string, Record<string, unknown>>;
	issues: IssueRow[];
	requests: string[];
	/** Scopes of the API key; tests narrow it to provoke 403s. */
	scopes: string[];
	partSize: number;
	close(): Promise<void>;
}

export async function startFakeCloud(
	dir: string,
	options: { partSize?: number } = {},
): Promise<FakeCloud> {
	const apiKey = "ff_test_0123456789abcdef";
	let n = 0;
	const id = (prefix: string) =>
		`${prefix}_${(++n).toString(16).padStart(8, "0")}`;
	const now = () => new Date().toISOString();
	const intents = new Map<string, Intent>();

	const state: FakeCloud = {
		url: "",
		apiKey,
		org: { id: "org_test", name: "Test Org", slug: "test-org", role: "owner" },
		repos: new Map(),
		blobs: new Map(),
		assetRefs: new Map(),
		renders: new Map(),
		issues: [],
		requests: [],
		scopes: ["repo:read", "repo:write", "render:create", "assets:sync"],
		partSize: options.partSize ?? 8,
		close: async () => {},
	};

	const json = (res: http.ServerResponse, status: number, body: unknown) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const readBody = (req: http.IncomingMessage) =>
		new Promise<Buffer>((resolve) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => resolve(Buffer.concat(chunks)));
		});
	const need = (scope: string) =>
		state.scopes.includes(scope) || state.scopes.includes("admin");
	const serialize = (i: IssueRow) => {
		const { events, repoId: _r, ...rest } = i;
		return {
			...rest,
			author: { id: "u1", name: "Tester", image: null },
			commentCount: events.filter((e) => e.kind === "comment").length,
		};
	};

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://x");
		const p = url.pathname;
		const m = req.method ?? "GET";
		state.requests.push(`${m} ${p}`);
		if (req.headers.authorization !== `Bearer ${apiKey}`)
			return json(res, 401, { error: "Invalid API key" });
		const body = await readBody(req);
		const data = () => (body.length ? JSON.parse(body.toString("utf8")) : {});
		let match: RegExpExecArray | null;

		if (m === "GET" && p === "/v1/organization")
			return json(res, 200, { organization: state.org });

		// ── Repositories ──
		if (p.startsWith("/v1/repos") && !need("repo:read"))
			return json(res, 403, { error: "Missing required scope: repo:read" });
		if (m === "GET" && p === "/v1/repos")
			return json(res, 200, { repositories: [...state.repos.values()] });
		if (m === "POST" && p === "/v1/repos") {
			if (!need("repo:write"))
				return json(res, 403, { error: "Missing required scope: repo:write" });
			const { name, description, visibility = "private" } = data();
			if ([...state.repos.values()].some((r) => r.name === name))
				return json(res, 409, {
					error: `Repository '${name}' already exists in organization`,
				});
			const bare = path.join(dir, "remotes", `${name}.git`);
			fs.mkdirSync(bare, { recursive: true });
			execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", bare]);
			const repo: Repo = {
				id: id("repo"),
				organizationId: state.org.id,
				name,
				description: description ?? null,
				visibility,
				defaultBranch: "main",
				remoteUrl: `file://${bare}`,
				createdAt: now(),
				updatedAt: now(),
			};
			state.repos.set(repo.id, repo);
			return json(res, 201, { ...repo, token: "art_git_initial" });
		}
		if ((match = /^\/v1\/repos\/([^/]+)(\/.*)?$/.exec(p))) {
			const repo = state.repos.get(decodeURIComponent(match[1] as string));
			if (!repo) return json(res, 404, { error: "Repository not found" });
			const rest = match[2] ?? "";
			if (m === "GET" && rest === "") return json(res, 200, repo);
			if (m === "DELETE" && rest === "") {
				state.repos.delete(repo.id);
				return json(res, 200, { ok: true, deleted: repo.id });
			}
			if (m === "POST" && rest === "/fork") {
				const { name = `${repo.name}-fork` } = data();
				const bare = path.join(dir, "remotes", `${name}.git`);
				execFileSync("git", [
					"clone",
					"--quiet",
					"--bare",
					repo.remoteUrl.slice(7),
					bare,
				]);
				const fork: Repo = {
					...repo,
					id: id("repo"),
					name,
					remoteUrl: `file://${bare}`,
					createdAt: now(),
					updatedAt: now(),
				};
				state.repos.set(fork.id, fork);
				return json(res, 201, {
					...fork,
					token: "art_git_fork",
					forkedFrom: repo.id,
				});
			}
			if (m === "POST" && rest === "/tokens") {
				const { scope = "write" } = data();
				return json(res, 200, {
					token: `art_${scope}_${n++}`,
					expiresAt: now(),
					scope,
				});
			}
			if (m === "GET" && rest === "/compositions") {
				return json(res, 200, {
					ref: url.searchParams.get("ref") ?? repo.defaultBranch,
					source: "default",
					compositions: [
						{
							id: "film",
							entry: "src/film.ts",
							export: "buildFilm",
							title: "Film",
							description: null,
							group: null,
							default: true,
						},
					],
					defaultId: "film",
				});
			}
			if (m === "POST" && rest === "/assets/diff")
				return diff(res, data().assets);
			if (m === "PUT" && rest === "/asset-refs") {
				const { ref, commitSha, lockfile } = data();
				const hashes = Object.values(
					lockfile.assets as Record<string, { sha256: string }>,
				).map((a) => a.sha256);
				const unknown = hashes.filter((h) => !state.blobs.has(h));
				if (unknown.length)
					return json(res, 409, {
						error: `Blobs not uploaded: ${unknown.join(", ")}`,
					});
				state.assetRefs.set(`${repo.id} ${ref}`, { ref, commitSha, hashes });
				return json(res, 200, { ref, commitSha, assets: hashes.length });
			}
			if (m === "DELETE" && rest === "/asset-refs") {
				const ref = url.searchParams.get("ref") ?? "";
				state.assetRefs.delete(`${repo.id} ${ref}`);
				return json(res, 200, { released: ref });
			}
			if (
				(match = /^\/(issues|pulls)(?:\/(\d+))?(\/comments|\/merge)?$/.exec(
					rest,
				))
			) {
				const kind = match[1] === "pulls" ? "pull" : "issue";
				const num = match[2] ? Number(match[2]) : undefined;
				const action = match[3];
				if (m === "GET" && num === undefined) {
					const s = url.searchParams.get("state") ?? "open";
					const items = state.issues
						.filter((i) => i.repoId === repo.id && i.kind === kind)
						.filter(
							(i) =>
								s === "all" ||
								(s === "open" ? i.state === "open" : i.state !== "open"),
						)
						.sort((a, b) => b.number - a.number);
					return json(res, 200, {
						items: items.map(serialize),
						counts: { open: 0, closed: 0 },
					});
				}
				if (m === "POST" && num === undefined) {
					const d = data();
					const row: IssueRow = {
						id: id(kind === "pull" ? "pr" : "iss"),
						repoId: repo.id,
						number: state.issues.filter((i) => i.repoId === repo.id).length + 1,
						kind,
						title: d.title,
						body: d.body ?? "",
						state: "open",
						labels: d.labels ?? [],
						headRef: d.headRef ?? null,
						baseRef: d.baseRef ?? null,
						isDraft: !!d.draft,
						createdAt: now(),
						updatedAt: now(),
						closedAt: null,
						mergedAt: null,
						events: [],
					};
					state.issues.push(row);
					return json(res, 201, serialize(row));
				}
				const row = state.issues.find(
					(i) => i.repoId === repo.id && i.kind === kind && i.number === num,
				);
				if (!row)
					return json(res, 404, {
						error:
							kind === "pull" ? "Pull request not found" : "Issue not found",
					});
				if (m === "GET" && !action)
					return json(res, 200, { ...serialize(row), timeline: row.events });
				if (m === "PATCH" && !action) {
					const d = data();
					if (d.title !== undefined) row.title = d.title;
					if (d.body !== undefined) row.body = d.body;
					if (d.labels !== undefined) row.labels = d.labels;
					if (d.draft !== undefined) row.isDraft = d.draft;
					if (d.state && d.state !== row.state) {
						row.state = d.state;
						row.events.push({
							id: id("evt"),
							kind: d.state === "closed" ? "closed" : "reopened",
							body: null,
							createdAt: now(),
						});
					}
					return json(res, 200, { ok: true, number: row.number });
				}
				if (m === "POST" && action === "/comments") {
					row.events.push({
						id: id("evt"),
						kind: "comment",
						body: data().body,
						createdAt: now(),
					});
					return json(res, 201, { ok: true });
				}
				if (m === "POST" && action === "/merge") {
					if (row.state !== "open")
						return json(res, 409, {
							error: "Only open pull requests can be merged",
						});
					row.state = "merged";
					row.mergedAt = now();
					return json(res, 200, {
						ok: true,
						number: row.number,
						mergedAt: row.mergedAt,
					});
				}
			}
			return json(res, 404, { error: "not found" });
		}

		// ── Assets ──
		if (m === "POST" && p === "/v1/assets/diff")
			return diff(res, data().assets);
		if (
			m === "PUT" &&
			(match = /^\/v1\/assets\/uploads\/([^/]+)\/parts\/(\d+)$/.exec(p))
		) {
			const intent = intents.get(match[1] as string);
			if (!intent) return json(res, 404, { error: "Upload not found." });
			const part = Number(match[2]);
			const count = Math.max(1, Math.ceil(intent.size / state.partSize));
			const expected =
				part < count
					? state.partSize
					: intent.size - state.partSize * (count - 1);
			if (body.length !== expected)
				return json(res, 400, {
					error: `Part ${part} must be exactly ${expected} bytes.`,
				});
			intent.parts.set(part, body);
			return json(res, 200, { partNumber: part, etag: `etag${part}` });
		}
		if (
			m === "POST" &&
			(match = /^\/v1\/assets\/uploads\/([^/]+)\/confirm$/.exec(p))
		) {
			const intent = intents.get(match[1] as string);
			if (!intent) return json(res, 404, { error: "Upload not found." });
			const count = Math.max(1, Math.ceil(intent.size / state.partSize));
			if (intent.parts.size !== count)
				return json(res, 409, {
					error: `Upload incomplete: ${intent.parts.size} of ${count} parts received.`,
				});
			const bytes = Buffer.concat(
				[...intent.parts.entries()].sort(([a], [b]) => a - b).map(([, b]) => b),
			);
			if (createHash("sha256").update(bytes).digest("hex") !== intent.sha256)
				return json(res, 422, { error: "checksum mismatch" });
			state.blobs.set(intent.sha256, bytes);
			intents.delete(intent.id);
			return json(res, 200, { sha256: intent.sha256, sizeBytes: bytes.length });
		}
		if (m === "GET" && (match = /^\/v1\/assets\/([0-9a-f]{64})$/.exec(p))) {
			const blob = state.blobs.get(match[1] as string);
			if (!blob) return json(res, 404, { error: "not found" });
			res.writeHead(200, {
				"content-type": "application/octet-stream",
				"content-length": blob.length,
			});
			res.end(blob);
			return;
		}

		// ── Renders ──
		if (p.startsWith("/v1/renders") && !need("render:create"))
			return json(res, 403, { error: "Missing required scope: render:create" });
		if (m === "POST" && p === "/v1/renders") {
			const d = data();
			const repo = state.repos.get(d.repositoryId);
			if (!repo) return json(res, 404, { error: "Repository not found" });
			const job = {
				id: id("rnd"),
				repositoryId: repo.id,
				commitSha: d.commitSha,
				composition: d.composition ?? (d.entryPath ? null : "film"),
				entryPath: d.entryPath ?? "src/film.ts",
				exportName: d.exportName ?? "buildFilm",
				jobType: d.jobType ?? "video",
				status: "queued",
				renderParams: d.options ?? {},
				outputR2Key: null as string | null,
				qaReport: null,
				errorMessage: null,
				createdAt: now(),
				completedAt: null as string | null,
				downloadUrl: null as string | null,
				polls: 0,
			};
			state.renders.set(job.id, job);
			return json(res, 202, {
				jobId: job.id,
				status: "queued",
				repository: repo.name,
				commitSha: job.commitSha,
				composition: job.composition,
			});
		}
		if (m === "GET" && p === "/v1/renders") {
			const repoId = url.searchParams.get("repositoryId");
			return json(res, 200, {
				renderJobs: [...state.renders.values()].filter(
					(j) => !repoId || j.repositoryId === repoId,
				),
			});
		}
		if (m === "GET" && (match = /^\/v1\/renders\/(rnd_[^/]+)$/.exec(p))) {
			const job = state.renders.get(match[1] as string) as
				| (Record<string, unknown> & { polls: number })
				| undefined;
			if (!job) return json(res, 404, { error: "Render job not found" });
			// queued → running → completed over successive polls.
			job.polls++;
			if (job.polls === 2) job.status = "running";
			if (job.polls >= 3 && job.status === "running") {
				job.status = "completed";
				job.completedAt = now();
				job.outputR2Key = `renders/${job.id}.mp4`;
				job.downloadUrl = `/v1/renders/download/renders/${job.id}.mp4`;
			}
			return json(res, 200, job);
		}
		if (m === "GET" && (match = /^\/v1\/renders\/download\/(.+)$/.exec(p))) {
			res.writeHead(200, { "content-type": "video/mp4" });
			res.end(Buffer.from(`fake video ${match[1]}`));
			return;
		}
		return json(res, 404, { error: "not found" });

		function diff(
			response: http.ServerResponse,
			claims: { sha256: string; size: number; mimeType: string }[],
		) {
			if (!need("assets:sync") && !need("repo:write"))
				return json(response, 403, {
					error: "Missing required scope: assets:sync",
				});
			const present = claims
				.filter((c) => state.blobs.has(c.sha256))
				.map((c) => c.sha256);
			const missing = claims
				.filter((c) => !state.blobs.has(c.sha256))
				.map((c) => {
					let intent = [...intents.values()].find((i) => i.sha256 === c.sha256);
					if (!intent) {
						intent = {
							id: id("upl"),
							sha256: c.sha256,
							size: c.size,
							mimeType: c.mimeType,
							parts: new Map(),
						};
						intents.set(intent.id, intent);
					}
					return {
						sha256: c.sha256,
						intentId: intent.id,
						expiresAt: now(),
						confirmUrl: `/v1/assets/uploads/${intent.id}/confirm`,
						transport: "parts",
						partSize: state.partSize,
						partCount: Math.max(1, Math.ceil(c.size / state.partSize)),
						partUrl: `/v1/assets/uploads/${intent.id}/parts/`,
						uploadedParts: [...intent.parts.keys()].sort(),
					};
				});
			return json(response, 200, { present: [...new Set(present)], missing });
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	state.close = () => new Promise<void>((r) => server.close(() => r()));
	return state;
}
