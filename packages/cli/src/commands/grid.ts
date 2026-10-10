import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import { loadComposition, outputDir } from "../compositions.js";
import { usageError } from "../errors.js";
import { parseFrame, spreadFrames } from "../timecode.js";

const int = (name: string, value: string, min: number, max: number) => {
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max)
		throw usageError(`${name} must be a whole number from ${min} to ${max}`);
	return n;
};

export function register(program: Command, wrap: Wrap) {
	program
		.command("grid")
		.description(
			"Render a contact sheet of frames (verification ladder, step 3)",
		)
		.argument("[composition]", "composition id or file#export")
		.option("--count <n>", "frames in the sheet", "16")
		.option("--columns <n>", "columns", "4")
		.option("--cell-width <px>", "width of each cell", "480")
		.option("--from <frame>", "first frame or timecode (default 0)")
		.option("--to <frame>", "last frame or timecode (default the last frame)")
		.addHelpText("after", "\nWrites <output>/<id>-grid.png")
		.action(
			wrap(
				async (
					ctx,
					ref: string | undefined,
					opts: {
						count: string;
						columns: string;
						cellWidth: string;
						from?: string;
						to?: string;
					},
				) => {
					const count = int("--count", opts.count, 1, 120);
					const columns = int("--columns", opts.columns, 1, 32);
					const cellWidth = int("--cell-width", opts.cellWidth, 120, 960);
					const { project, target, composition, frameCount } =
						await loadComposition(ctx, ref);
					const last = frameCount - 1;
					const from =
						opts.from === undefined
							? 0
							: parseFrame(opts.from, composition.fps);
					const to =
						opts.to === undefined
							? last
							: Math.min(last, parseFrame(opts.to, composition.fps));
					if (from > to)
						throw usageError(`--from (${from}) is after --to (${to})`);
					const frames = spreadFrames(from, to, count);
					ctx.out.info(`rendering ${frames.length} frames (${from}–${to})`);
					const png = await composition.renderFrameGrid({
						frames,
						columns: Math.min(columns, frames.length),
						cellWidth,
						showLabels: true,
						maxFrames: 120,
						headerText: target.title,
					});
					const file = path.join(
						await outputDir(project),
						`${target.id}-grid.png`,
					);
					await fs.writeFile(file, png);
					const rel = ctx.relative(project, file);
					ctx.out.result({ files: [rel], frames }, () => ctx.out.line(rel));
				},
			),
		);
}
