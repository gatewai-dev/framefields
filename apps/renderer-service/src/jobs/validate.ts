import type { RendererConfig } from "../config/index.js";
import { RESERVED_JOB_ENV } from "../config/schema.js";
import { RenderError } from "../errors.js";
import { isRepoAllowed, parseRepoUrl, type RepoRef } from "../git/repo-url.js";
import { hasControlChars } from "../paths.js";
import { checkKeyTemplate } from "./key-template.js";
import { type JobInput, jobSchema } from "./schema.js";

export interface ValidatedJob {
	input: JobInput;
	repo: RepoRef;
	ref: string;
	timeoutSec: number;
}

/**
 * Parses a raw payload and checks it against the worker's security settings
 * (allowlists, buckets, env names, limits). Job input can never widen them.
 */
export function validateJob(
	raw: unknown,
	config: RendererConfig,
): ValidatedJob {
	const parsed = jobSchema.safeParse(raw);
	if (!parsed.success) {
		throw new RenderError(
			"JOB_INVALID",
			"The job does not match the v2 schema.",
			{
				details: {
					issues: parsed.error.issues.map((i) => ({
						path: i.path.join("."),
						message: i.message,
					})),
				},
				hint:
					raw && typeof raw === "object" && "virtualMedia" in raw
						? "Inline virtualMedia jobs were removed; send a v2 git job."
						: undefined,
			},
		);
	}
	const input = parsed.data;

	const repoUrl = input.source.repo ?? config.source.defaultRepo;
	if (!repoUrl) {
		throw new RenderError(
			"JOB_INVALID",
			"source.repo is required (no FF_DEFAULT_REPO set).",
		);
	}
	const repo = parseRepoUrl(repoUrl, { allowLocal: config.source.allowLocal });
	if (repo.protocol === "http") {
		throw new RenderError(
			"REPO_NOT_ALLOWED",
			"Plain http:// remotes are not allowed; use https.",
		);
	}
	if (
		repo.protocol !== "file" &&
		!isRepoAllowed(repo.id, config.source.allowlist)
	) {
		throw new RenderError(
			"REPO_NOT_ALLOWED",
			`Repo ${repo.id} is not in FF_REPO_ALLOWLIST.`,
		);
	}

	if (input.source.auth && !config.git.allowJobCredentials) {
		throw new RenderError(
			"JOB_INVALID",
			"source.auth is disabled on this worker (FF_ALLOW_JOB_CREDENTIALS).",
		);
	}

	const ref = input.source.ref ?? config.source.defaultRef;
	if (hasControlChars(ref) || /[ ~^:?*[\\]|\.\.|@\{|^-/.test(ref)) {
		throw new RenderError("JOB_INVALID", `"${ref}" is not a valid git ref.`);
	}

	validateOutput(input, config);

	for (const name of Object.keys(input.env)) {
		if (RESERVED_JOB_ENV.some((re) => re.test(name))) {
			throw new RenderError(
				"JOB_INVALID",
				`env.${name} is reserved and can't be set by a job.`,
			);
		}
		if (!config.jobEnv.allow.some((p) => globMatch(p, name))) {
			throw new RenderError(
				"JOB_INVALID",
				`env.${name} is not allowed by FF_JOB_ENV_ALLOW.`,
			);
		}
	}

	const max = config.limits.jobTimeoutMaxSec;
	const timeoutSec = Math.min(input.timeoutSec ?? max, max);

	return { input, repo, ref, timeoutSec };
}

function validateOutput(input: JobInput, config: RendererConfig): void {
	const out = input.output;
	const driver = config.storage.driver;
	switch (out.type) {
		case "s3": {
			if (driver !== "s3") {
				throw new RenderError(
					"JOB_INVALID",
					'output.type "s3" needs STORAGE_DRIVER=s3 on the worker.',
				);
			}
			const bucket = out.bucket ?? config.storage.bucket;
			if (!bucket || !config.storage.outputBuckets.includes(bucket)) {
				throw new RenderError(
					"BUCKET_NOT_ALLOWED",
					`Bucket "${bucket}" is not in FF_OUTPUT_BUCKETS.`,
				);
			}
			checkKeyTemplate(out.key);
			return;
		}
		case "local":
			if (!config.storage.outputDir) {
				throw new RenderError(
					"JOB_INVALID",
					'output.type "local" needs FF_OUTPUT_DIR on the worker.',
				);
			}
			checkKeyTemplate(out.path);
			return;
		case "presigned":
		case "inline":
			return;
	}
}

function globMatch(pattern: string, value: string): boolean {
	const re = new RegExp(
		`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
	);
	return re.test(value);
}
