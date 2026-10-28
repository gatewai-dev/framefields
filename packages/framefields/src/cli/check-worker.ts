import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { frameCount } from "@framefields/core";
import { Composition, CompositorProgramSchema, describeGpu } from "../index.js";
import type { CheckOptions } from "./check.js";
import { checkLocalAssets } from "./check-assets.js";
import { type CheckReport, failedCheck } from "./check-result.js";

type WorkerOptions = CheckOptions & {
	exportName: string;
	sdkVersion: string;
	outputDir: string;
};

async function inspect(options: WorkerOptions): Promise<CheckReport> {
	const report: CheckReport = {
		schemaVersion: 1,
		sdkVersion: options.sdkVersion,
		entry: options.entry,
		exportName: options.exportName,
		status: "passed",
		diagnostics: [],
		artifacts: [],
		render: options.render ? "skipped" : "not_requested",
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
		},
	};
	let stage: "build" | "schema" | "lint" | "timeline" | "render" = "build";
	try {
		// User-selected entry and export are necessarily loaded at runtime.
		const mod: Record<string, unknown> = await import(
			pathToFileURL(options.entry).href
		);
		const exported = mod[options.exportName];
		const comp: unknown =
			typeof exported === "function" ? await exported() : exported;
		if (!isComposition(comp))
			throw new Error(
				`Export '${options.exportName}' must be a Composition or a builder returning one.`,
			);
		stage = "schema";
		const spec = comp.toSpec();
		const parsed = CompositorProgramSchema.safeParse(spec);
		if (!parsed.success) {
			for (const issue of parsed.error.issues)
				report.diagnostics.push({
					severity: "error",
					code: "invalid_spec",
					stage,
					path: issue.path.join("."),
					message: issue.message,
				});
		} else {
			comp.toVirtualMedia();
			report.diagnostics.push(...checkLocalAssets(parsed.data));
			stage = "lint";
			report.diagnostics.push(
				...comp.lint().map((d) => ({ ...d, stage: "lint" as const })),
			);
			stage = "timeline";
			const durationMs = comp.durationMs ?? (await comp.computeDuration());
			report.timeline = {
				fps: comp.fps,
				durationMs,
				totalFrames: frameCount(durationMs, comp.fps),
			};
			if (options.render && !hasErrors(report)) {
				stage = "render";
				report.render = "failed";
				report.backend = await describeGpu();
				await renderSmoke(comp, report, options.outputDir);
				report.render = "passed";
			}
		}
	} catch (error) {
		report.diagnostics.push({
			severity: "error",
			code: `${stage}_failed`,
			stage,
			message:
				error instanceof Error ? (error.stack ?? error.message) : String(error),
		});
	}
	if (
		hasErrors(report) ||
		(options.warningsAsErrors &&
			report.diagnostics.some((d) => d.severity === "warning"))
	)
		report.status = "failed";
	return report;
}

function hasErrors(report: CheckReport): boolean {
	return report.diagnostics.some((d) => d.severity === "error");
}

// Bundles can carry distinct Composition constructors; check its public contract.
function isComposition(value: unknown): value is Composition {
	return (
		value instanceof Composition ||
		(typeof value === "object" &&
			value !== null &&
			"toSpec" in value &&
			typeof value.toSpec === "function" &&
			"lint" in value &&
			typeof value.lint === "function" &&
			"renderFrameGrid" in value &&
			typeof value.renderFrameGrid === "function" &&
			"computeDuration" in value &&
			typeof value.computeDuration === "function")
	);
}

async function renderSmoke(
	comp: Composition,
	report: CheckReport,
	outputDir: string,
): Promise<void> {
	const count = report.timeline?.totalFrames ?? 1;
	const frames = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
	await mkdir(outputDir, { recursive: true });
	const frameFile = join(outputDir, "frame.png");
	await writeFile(frameFile, await comp.renderFrame({ frame: 0 }));
	report.artifacts.push(frameFile);
	const gridFile = join(outputDir, "grid.png");
	await writeFile(
		gridFile,
		await comp.renderFrameGrid({ frames, cellWidth: 320 }),
	);
	report.artifacts.push(gridFile);
}

process.once("message", (options: WorkerOptions) => {
	process.channel?.ref();
	inspect(options).then(
		(report) =>
			process.send?.(report, () =>
				process.exit(report.status === "passed" ? 0 : 1),
			),
		(error: unknown) => {
			const report = failedCheck(
				options.entry,
				options.exportName,
				options.sdkVersion,
				"worker_failed",
				String(error),
			);
			process.send?.(report, () => process.exit(1));
		},
	);
});
