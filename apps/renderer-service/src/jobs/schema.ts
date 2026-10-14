import z from "zod";
import { isSafeRelativePath } from "../paths.js";

const relPath = (what: string) =>
	z
		.string()
		.min(1)
		.max(1024)
		.refine((p) => p === "." || isSafeRelativePath(p), {
			message: `${what} must be a relative path inside the repo (no "..", no leading "/")`,
		});

const lfsPattern = z.string().min(1).max(512).refine(isSafeRelativePath, {
	message: 'LFS patterns must be relative and must not contain ".."',
});

const sourceSchema = z.object({
	type: z.literal("git").default("git"),
	repo: z.string().min(1).max(2048).optional(),
	ref: z.string().min(1).max(255).optional(),
	commit: z
		.string()
		.regex(/^[0-9a-f]{7,64}$/i, "commit must be a hex SHA (7-64 chars)")
		.optional(),
	workdir: relPath("workdir").default("."),
	lfs: z
		.object({
			enabled: z.boolean().optional(),
			include: z.array(lfsPattern).max(256).default([]),
			exclude: z.array(lfsPattern).max(256).default([]),
		})
		.default({ include: [], exclude: [] }),
	submodules: z.boolean().default(false),
	sparse: z.array(relPath("sparse path")).max(256).optional(),
	auth: z
		.object({
			username: z.string().optional(),
			token: z.string().optional(),
			sshKey: z.string().optional(),
		})
		.optional(),
});

const exportName = z
	.string()
	.regex(/^[A-Za-z_$][\w$]*$/, "export must be a JavaScript identifier");

const targetSchema = z.object({
	entry: relPath("entry").refine(
		(p) => /\.(m?ts|m?js|tsx|jsx|cts|cjs)$/.test(p),
		{
			message: "entry must be a .ts/.mts/.js/.mjs module",
		},
	),
	export: exportName.default("default"),
	args: z.unknown().optional(),
	select: z.array(z.string().min(1).max(128)).min(1).optional(),
});

export const RENDER_KINDS = [
	"video",
	"frames",
	"frameGrid",
	"lut",
	"audio",
] as const;

export const renderSchema = z.object({
	kind: z.enum(RENDER_KINDS).default("video"),
	codec: z.string().max(32).optional(),
	audioCodec: z.string().max(32).optional(),
	quality: z.string().max(32).optional(),
	frames: z.array(z.number().int().min(0)).min(1).max(10_000).optional(),
	range: z
		.object({ from: z.number().int().min(0), to: z.number().int().min(1) })
		.refine((r) => r.to > r.from, { message: "range.to must be > range.from" })
		.optional(),
	grid: z
		.object({
			from: z.number().int().min(0).optional(),
			to: z.number().int().min(1).optional(),
			step: z.number().int().min(1).optional(),
			columns: z.number().int().min(1).max(64).optional(),
		})
		.optional(),
	qa: z
		.union([
			z.boolean(),
			z.looseObject({ failOn: z.array(z.string()).optional() }),
		])
		.optional(),
});

export type RenderSettings = z.infer<typeof renderSchema>;

const outputSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("s3"),
		bucket: z.string().min(1).max(255).optional(),
		key: z.string().min(1).max(1024),
	}),
	z.object({
		type: z.literal("presigned"),
		/** One URL per output, in plan order. */
		urls: z
			.array(z.url({ protocol: /^https?$/ }))
			.min(1)
			.max(256),
		headers: z.record(z.string(), z.string()).optional(),
	}),
	z.object({
		type: z.literal("local"),
		path: z.string().min(1).max(1024),
	}),
	z.object({ type: z.literal("inline") }),
]);

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const jobSchema = z
	.object({
		version: z.literal(2),
		source: sourceSchema.default({
			type: "git",
			workdir: ".",
			lfs: { include: [], exclude: [] },
			submodules: false,
		}),
		target: targetSchema,
		render: renderSchema.default({ kind: "video" }),
		output: outputSchema,
		env: z
			.record(
				z.string().regex(envName, "invalid env var name"),
				z.string().max(32_768),
			)
			.default({}),
		timeoutSec: z.number().int().positive().optional(),
		idempotencyKey: z.string().min(1).max(200).optional(),
	})
	.superRefine((job, ctx) => {
		if (job.render.kind === "frames" && !job.render.frames) {
			ctx.addIssue({
				code: "custom",
				path: ["render", "frames"],
				message: 'required when render.kind is "frames"',
			});
		}
	});

export type JobInput = z.infer<typeof jobSchema>;
export type JobOutputTarget = JobInput["output"];
