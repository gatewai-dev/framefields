import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { buildComposition, type Project } from "framefields/project";
import type { Wrap } from "../cli.js";
import { resolveTarget } from "../compositions.js";
import { findPackageDir, fromProjectError } from "../context.js";
import { CliError } from "../errors.js";

interface TypecheckResult {
	status: "passed" | "failed" | "skipped";
	reason?: string;
	output?: string;
}

interface CompositionResult {
	id: string;
	ok: boolean;
	error?: string;
	issues?: { path: string; message: string }[];
}

export function register(program: Command, wrap: Wrap) {
	program
		.command("check")
		.description(
			"Typecheck the project, then build each composition and validate its spec (verification ladder, step 1)",
		)
		.argument(
			"[compositions...]",
			"composition ids or file#export (all by default)",
		)
		.option("--no-typecheck", "skip tsc --noEmit")
		.action(
			wrap(async (ctx, refs: string[], opts: { typecheck: boolean }) => {
				const project = await ctx.project();
				const targets = refs.length
					? refs.map((ref) => ({ ref, target: resolveTarget(project, ref) }))
					: project.compositions.map((target) => ({ ref: target.id, target }));

				const typecheck: TypecheckResult = opts.typecheck
					? await runTsc(project, (t) => ctx.out.info(t))
					: { status: "skipped", reason: "--no-typecheck" };
				if (typecheck.status === "failed" && !ctx.out.json)
					ctx.io.stderr(typecheck.output ?? "");

				const engine = await ctx.engine(project);
				const results: CompositionResult[] = [];
				for (const { ref, target } of targets) {
					ctx.out.info(
						`building ${target.id} (${target.entry}#${target.export})`,
					);
					try {
						const comp = await buildComposition(project, ref);
						const parsed = engine.CompositorProgramSchema?.safeParse(
							comp.toSpec(),
						);
						if (parsed && !parsed.success) {
							results.push({
								id: target.id,
								ok: false,
								error: "the spec does not match the program schema",
								issues: (parsed.error?.issues ?? []).slice(0, 10).map((i) => ({
									path: i.path.map(String).join(".") || "(root)",
									message: i.message,
								})),
							});
						} else {
							results.push({ id: target.id, ok: true });
						}
					} catch (err) {
						const mapped = fromProjectError(err);
						results.push({
							id: target.id,
							ok: false,
							error: (mapped as Error).message ?? String(err),
						});
					}
				}

				const ok = typecheck.status !== "failed" && results.every((r) => r.ok);
				ctx.out.result({ ok, typecheck, compositions: results }, () => {
					const mark = (pass: boolean) =>
						pass ? ctx.out.style("green", "✓") : ctx.out.style("red", "✗");
					ctx.out.line(
						typecheck.status === "skipped"
							? `- typecheck (skipped: ${typecheck.reason})`
							: `${mark(typecheck.status === "passed")} typecheck`,
					);
					for (const r of results) {
						ctx.out.line(
							`${mark(r.ok)} ${r.id}${r.error ? `: ${r.error}` : ""}`,
						);
						for (const i of r.issues ?? [])
							ctx.out.line(`    ${i.path}: ${i.message}`);
					}
				});
				if (!ok) {
					const failed = results.filter((r) => !r.ok).map((r) => r.id);
					throw new CliError(
						[
							typecheck.status === "failed" && "typecheck failed",
							failed.length && `${failed.join(", ")} failed`,
						]
							.filter(Boolean)
							.join("; "),
						{
							hint: failed.length
								? `ff frames ${failed[0]} 0  (render a frame to see the failure)`
								: undefined,
						},
					);
				}
			}),
		);
}

async function runTsc(
	project: Project,
	info: (text: string) => void,
): Promise<TypecheckResult> {
	if (!fs.existsSync(path.join(project.root, "tsconfig.json"))) {
		return { status: "skipped", reason: "no tsconfig.json" };
	}
	const typescript = findPackageDir(project.root, "typescript");
	if (!typescript)
		return {
			status: "skipped",
			reason: "typescript is not installed in the project",
		};
	const tsc = path.join(typescript, "bin", "tsc");
	info("typechecking (tsc --noEmit)");
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[tsc, "--noEmit", "-p", project.root],
			{ cwd: project.root, maxBuffer: 32 * 1024 * 1024 },
			(err, stdout, stderr) => {
				resolve(
					err
						? { status: "failed", output: `${stdout}${stderr}` }
						: { status: "passed" },
				);
			},
		);
	});
}
