/** Typed REST client for Framefields Cloud (SPEC §8). Field names match the API. */
import { CliError } from "../errors.js";

export interface Repository {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	visibility: "public" | "private";
	defaultBranch: string;
	remoteUrl: string;
	createdAt: string;
	updatedAt: string;
	/** Present on create and fork: a git token for the first push. */
	token?: string;
	forkedFrom?: string;
}

export interface Organization {
	id: string;
	name: string;
	slug: string;
	role: string;
	artifactsNamespace?: string;
	createdAt?: string;
}

export interface CloudComposition {
	id: string;
	entry: string;
	export: string;
	title: string;
	description: string | null;
	group: string | null;
	default: boolean;
}

export interface CompositionsResponse {
	ref: string;
	source: "manifest" | "default" | "invalid";
	compositions: CloudComposition[];
	defaultId: string | null;
	error?: string;
}

export interface AssetClaim {
	path?: string;
	sha256: string;
	size: number;
	mimeType: string;
}

export type UploadTicket = {
	sha256: string;
	intentId: string;
	expiresAt: string;
	confirmUrl: string;
} & (
	| {
			transport: "direct";
			method: "PUT";
			url: string;
			headers: Record<string, string>;
	  }
	| {
			transport: "parts";
			partSize: number;
			partCount: number;
			partUrl: string;
			uploadedParts: number[];
	  }
);

export interface AssetDiff {
	present: string[];
	missing: UploadTicket[];
}

export interface AssetLockfile {
	$schema?: string;
	version: number;
	projectId?: string;
	repository?: string;
	assets: Record<
		string,
		{
			sha256: string;
			size?: number;
			sizeBytes?: number;
			mimeType?: string;
			r2Key?: string;
			uploadedAt?: string;
			[key: string]: unknown;
		}
	>;
	[key: string]: unknown;
}

export type RenderStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface RenderJob {
	id: string;
	repositoryId: string;
	commitSha: string;
	composition: string | null;
	entryPath: string;
	exportName: string;
	jobType: "video" | "frame" | "sheet";
	status: RenderStatus;
	renderParams: Record<string, unknown>;
	outputR2Key: string | null;
	qaReport: unknown;
	errorMessage: string | null;
	createdAt: string;
	completedAt: string | null;
	downloadUrl: string | null;
	progress?: number;
}

export interface CreateRenderResponse {
	jobId: string;
	status: RenderStatus;
	repository: string;
	commitSha: string;
	composition: string | null;
}

export interface Author {
	id: string;
	name: string;
	image: string | null;
}

export interface Issue {
	id: string;
	number: number;
	kind: "issue" | "pull";
	title: string;
	body: string;
	state: "open" | "closed" | "merged";
	labels: string[];
	author: Author | null;
	headRef: string | null;
	baseRef: string | null;
	isDraft: boolean;
	commentCount: number;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	timeline?: {
		id: string;
		kind: "comment" | "closed" | "reopened" | "merged";
		body: string | null;
		author: Author | null;
		createdAt: string;
	}[];
}

export type IssueKind = "issues" | "pulls";

export interface RequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
	headers?: Record<string, string>;
	/** Skip the API key (pre-signed URLs). */
	anonymous?: boolean;
}

type Fetch = typeof fetch;
export type RequestBody = NonNullable<RequestInit["body"]>;

export class CloudClient {
	constructor(
		/** e.g. `https://framefields.dev` */
		readonly host: string,
		readonly token: string | undefined,
		private readonly fetchImpl: Fetch = fetch,
	) {}

	url(path: string, query?: RequestOptions["query"]): string {
		const url = new URL(
			/^https?:\/\//.test(path)
				? path
				: `${this.host}${path.startsWith("/") ? "" : "/"}${path}`,
		);
		for (const [k, v] of Object.entries(query ?? {})) {
			if (v !== undefined) url.searchParams.set(k, String(v));
		}
		return url.toString();
	}

	/** A raw request; the caller handles the status. Used by `ff api` and downloads. */
	async raw(
		method: string,
		path: string,
		options: RequestOptions & { rawBody?: RequestBody; duplex?: boolean } = {},
	): Promise<Response> {
		const headers: Record<string, string> = { ...options.headers };
		if (!options.anonymous && this.token)
			headers.Authorization = `Bearer ${this.token}`;
		let body: RequestBody | undefined = options.rawBody;
		if (options.body !== undefined) {
			headers["Content-Type"] ??= "application/json";
			body = JSON.stringify(options.body);
		}
		try {
			return await this.fetchImpl(this.url(path, options.query), {
				method,
				headers,
				body,
				...(options.duplex && { duplex: "half" }),
			} as RequestInit);
		} catch (err) {
			throw new CliError(
				`could not reach ${this.host}: ${(err as Error).cause ?? (err as Error).message}`,
				{
					hint: "check your connection, or pass --host",
					cause: err,
				},
			);
		}
	}

	async request<T>(
		method: string,
		path: string,
		options: RequestOptions = {},
	): Promise<T> {
		this.requireToken();
		const res = await this.raw(method, path, options);
		const text = await res.text();
		let data: unknown;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			data = text;
		}
		if (!res.ok) throw apiError(res.status, data, `${method} ${path}`);
		return data as T;
	}

	requireToken(): void {
		if (!this.token) {
			throw new CliError(`not logged in to ${new URL(this.host).host}`, {
				code: "auth",
				hint: "ff auth login (or set FF_TOKEN)",
			});
		}
	}

	// ── Organization ──
	organization = () =>
		this.request<{ organization: Organization }>(
			"GET",
			"/v1/organization",
		).then((r) => r.organization);

	// ── Repositories ──
	listRepos = () =>
		this.request<{ repositories: Repository[] }>("GET", "/v1/repos").then(
			(r) => r.repositories,
		);
	getRepo = (id: string) =>
		this.request<Repository>("GET", `/v1/repos/${enc(id)}`);
	createRepo = (body: {
		name: string;
		description?: string;
		visibility: "public" | "private";
	}) => this.request<Repository>("POST", "/v1/repos", { body });
	deleteRepo = (id: string) =>
		this.request<{ ok: true; deleted: string }>(
			"DELETE",
			`/v1/repos/${enc(id)}`,
		);
	forkRepo = (id: string, body: { name?: string }) =>
		this.request<Repository>("POST", `/v1/repos/${enc(id)}/fork`, { body });
	gitToken = (id: string, scope: "read" | "write", ttl = 3600) =>
		this.request<{ token: string; expiresAt: string; scope: string }>(
			"POST",
			`/v1/repos/${enc(id)}/tokens`,
			{
				body: { scope, ttl },
			},
		);
	compositions = (id: string, ref?: string) =>
		this.request<CompositionsResponse>(
			"GET",
			`/v1/repos/${enc(id)}/compositions`,
			{ query: { ref } },
		);

	// ── Assets ──
	assetsDiff = (repoId: string | undefined, assets: AssetClaim[]) =>
		this.request<AssetDiff>(
			"POST",
			repoId ? `/v1/repos/${enc(repoId)}/assets/diff` : "/v1/assets/diff",
			{
				body: { assets },
			},
		);
	confirmUpload = (confirmUrl: string) =>
		this.request<{ sha256: string; sizeBytes: number }>("POST", confirmUrl);
	putAssetRefs = (
		repoId: string,
		body: { ref: string; commitSha: string; lockfile: AssetLockfile },
	) =>
		this.request<Record<string, unknown>>(
			"PUT",
			`/v1/repos/${enc(repoId)}/asset-refs`,
			{ body },
		);
	deleteAssetRefs = (repoId: string, ref: string) =>
		this.request<Record<string, unknown>>(
			"DELETE",
			`/v1/repos/${enc(repoId)}/asset-refs`,
			{ query: { ref } },
		);

	// ── Renders ──
	createRender = (body: {
		repositoryId: string;
		commitSha: string;
		composition?: string;
		entryPath?: string;
		exportName?: string;
		jobType: "video" | "frame" | "sheet";
		options: Record<string, unknown>;
	}) => this.request<CreateRenderResponse>("POST", "/v1/renders", { body });
	getRender = (id: string) =>
		this.request<RenderJob>("GET", `/v1/renders/${enc(id)}`);
	listRenders = (repositoryId?: string) =>
		this.request<{ renderJobs: RenderJob[] }>("GET", "/v1/renders", {
			query: { repositoryId },
		}).then((r) => r.renderJobs);
	cancelRender = (id: string) =>
		this.request<unknown>("POST", `/v1/renders/${enc(id)}/cancel`);

	// ── Issues and pull requests ──
	listIssues = (
		repoId: string,
		kind: IssueKind,
		query: { state?: string; q?: string },
	) =>
		this.request<{ items: Issue[]; counts: { open: number; closed: number } }>(
			"GET",
			`/v1/repos/${enc(repoId)}/${kind}`,
			{
				query,
			},
		);
	getIssue = (repoId: string, kind: IssueKind, n: number) =>
		this.request<Issue>("GET", `/v1/repos/${enc(repoId)}/${kind}/${n}`);
	createIssue = (
		repoId: string,
		kind: IssueKind,
		body: Record<string, unknown>,
	) =>
		this.request<Issue>("POST", `/v1/repos/${enc(repoId)}/${kind}`, { body });
	updateIssue = (
		repoId: string,
		kind: IssueKind,
		n: number,
		body: Record<string, unknown>,
	) =>
		this.request<{ ok: true; number: number }>(
			"PATCH",
			`/v1/repos/${enc(repoId)}/${kind}/${n}`,
			{ body },
		);
	commentIssue = (repoId: string, kind: IssueKind, n: number, body: string) =>
		this.request<{ ok: true }>(
			"POST",
			`/v1/repos/${enc(repoId)}/${kind}/${n}/comments`,
			{ body: { body } },
		);
	mergePull = (repoId: string, n: number) =>
		this.request<{ ok: true; number: number; mergedAt: string }>(
			"POST",
			`/v1/repos/${enc(repoId)}/pulls/${n}/merge`,
		);
}

const enc = encodeURIComponent;

/** Maps an API error to the exit codes of SPEC §7. */
export function apiError(
	status: number,
	data: unknown,
	what: string,
): CliError {
	const message =
		(typeof data === "object" &&
			data &&
			"error" in data &&
			typeof data.error === "string" &&
			data.error) ||
		(typeof data === "string" && data.trim().slice(0, 200)) ||
		`HTTP ${status}`;
	if (status === 401) {
		return new CliError(`${message} (${what})`, {
			code: "auth",
			hint: "ff auth login (or set FF_TOKEN)",
		});
	}
	if (status === 403) {
		const scope = /scope:\s*(\S+)/.exec(message)?.[1];
		return new CliError(message, {
			code: "auth",
			hint: scope
				? `create an API key with the '${scope}' scope, then: ff auth login`
				: undefined,
		});
	}
	return new CliError(`${message} (${what}: HTTP ${status})`);
}
