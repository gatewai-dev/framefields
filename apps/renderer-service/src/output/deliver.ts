import { RenderError } from "../errors.js";
import { renderKeys } from "../jobs/key-template.js";
import type { DeliveredFile, Pipeline } from "../jobs/pipeline.js";
import {
	deliverInline,
	deliverLocal,
	deliverPresigned,
	deliverS3,
	readManifest,
	writeManifest,
} from "./sinks.js";
import { qaFailures, type VerifiedFile, verifyFile } from "./verify.js";

/**
 * Pipeline step: verifies every rendered file, applies the QA gate, and
 * delivers the files to the job's output target (PLAN.md §8.5).
 */
export const deliver: Pipeline["deliver"] = async (files, job, ctx) => {
	const { input, sha, ref } = job;
	const config = ctx.config;
	if (files.length === 0) {
		throw new RenderError("OUTPUT_MISSING", "The render produced no files.", { phase: "verify" });
	}

	ctx.progress({ phase: "verifying" });
	const verified: VerifiedFile[] = [];
	for (const file of files) {
		verified.push(await verifyFile(file, { maxBytes: config.storage.outputMaxBytes, signal: ctx.signal }));
	}

	const failOn = typeof input.render.qa === "object" ? input.render.qa.failOn : undefined;
	const qaIssues = verified.flatMap((f) =>
		qaFailures(f.qa, failOn as string[] | undefined).map((i) => ({ output: f.name, ...i })),
	);
	if (qaIssues.length > 0 && config.qaBlockUpload) {
		throw qaError(qaIssues, []);
	}

	ctx.progress({ phase: "uploading" });
	const out = input.output;
	const deliveries = verified.map((file) => ({ file, signal: ctx.signal }));
	const vars = { jobId: ctx.jobId, sha, ref };
	const named = verified.map((f) => ({ name: f.name, ext: f.ext }));
	let delivered: DeliveredFile[] = [];

	switch (out.type) {
		case "s3": {
			const bucket = out.bucket ?? (config.storage.bucket as string);
			const keys = renderKeys(out.key, named, vars);
			const metadata = {
				"ff-sha": sha,
				"ff-job": ctx.jobId,
				...(input.idempotencyKey && { "ff-idempotency": input.idempotencyKey }),
			};
			for (const [i, d] of deliveries.entries()) {
				delivered.push(await deliverS3(d, config, bucket, keys[i], metadata));
			}
			if (input.idempotencyKey) {
				await writeManifest(config, bucket, {
					idempotencyKey: input.idempotencyKey,
					sha,
					outputs: delivered,
					createdAt: new Date().toISOString(),
				});
			}
			break;
		}
		case "presigned": {
			if (out.urls.length !== deliveries.length) {
				throw new RenderError(
					"JOB_INVALID",
					`The render produced ${deliveries.length} file(s) but output.urls has ${out.urls.length}.`,
					{ phase: "upload", details: { files: named.map((n) => n.name) } },
				);
			}
			for (const [i, d] of deliveries.entries()) {
				delivered.push(await deliverPresigned(d, out.urls[i], out.headers));
			}
			break;
		}
		case "local": {
			const paths = renderKeys(out.path, named, vars);
			for (const [i, d] of deliveries.entries()) {
				delivered.push(await deliverLocal(d, config.storage.outputDir as string, paths[i]));
			}
			break;
		}
		case "inline": {
			const total = verified.reduce((sum, f) => sum + f.bytes, 0);
			// base64 grows ~4/3; keep the encoded payload under the limit.
			if (Math.ceil(total / 3) * 4 > config.storage.inlineMaxBytes) {
				throw new RenderError(
					"OUTPUT_TOO_LARGE",
					`Outputs total ${total} bytes, too large to return inline (FF_INLINE_MAX_BYTES=${config.storage.inlineMaxBytes}).`,
					{ phase: "upload", hint: 'Use an "s3", "presigned" or "local" output.' },
				);
			}
			delivered = await Promise.all(deliveries.map(deliverInline));
			break;
		}
	}

	if (qaIssues.length > 0) throw qaError(qaIssues, delivered);
	return delivered;
};

function qaError(issues: Record<string, unknown>[], outputs: DeliveredFile[]): RenderError {
	return new RenderError("QA_FAILED", `QA found ${issues.length} issue(s) listed in render.qa.failOn.`, {
		phase: "verify",
		details: {
			issues: issues.slice(0, 50),
			// Delivered anyway (unless FF_QA_BLOCK_UPLOAD), so callers can inspect them.
			outputs: outputs.map(({ base64: _, ...rest }) => rest),
		},
	});
}

/**
 * Pipeline step: finds outputs an earlier attempt of the same job already
 * delivered for this commit (s3 + idempotencyKey only).
 */
export const findExisting: NonNullable<Pipeline["findExisting"]> = async (input, sha, ctx) => {
	if (!input.idempotencyKey || input.output.type !== "s3") return undefined;
	const bucket = input.output.bucket ?? (ctx.config.storage.bucket as string);
	const manifest = await readManifest(ctx.config, bucket, input.idempotencyKey, sha);
	return manifest?.outputs;
};
