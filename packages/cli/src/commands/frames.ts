import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import {
	isCompositionRef,
	loadComposition,
	outputDir,
} from "../compositions.js";
import { usageError } from "../errors.js";
import { frameFileName, looksLikeFrame, parseFrame } from "../timecode.js";

export function register(program: Command, wrap: Wrap) {
	program
		.command("frames")
		.description("Render frames to PNG (verification ladder, step 2)")
		.argument(
			"[composition]",
			"composition id or file#export; may be omitted for the default",
		)
		.argument(
			"[frames...]",
			"frame numbers or timecodes: 60, 2.5s, 1500ms, 00:02:15",
		)
		.addHelpText(
			"after",
			"\nWrites <output>/frames/<id>/f0060.png …\n\nExamples:\n  ff frames 0 60 2.5s\n  ff frames step-3 00:00:04",
		)
		.action(
			wrap(async (ctx, first: string | undefined, rest: string[]) => {
				const project = await ctx.project();
				let ref: string | undefined = first;
				let refs = rest;
				// `ff frames 60 120`: the first argument is a frame, not a composition.
				if (
					first !== undefined &&
					!isCompositionRef(project, first) &&
					looksLikeFrame(first)
				) {
					ref = undefined;
					refs = [first, ...rest];
				}
				if (refs.length === 0) {
					throw usageError(
						"which frames?",
						"ff frames [composition] <frame…>, e.g. ff frames 0 60 2.5s",
					);
				}
				const { engine, target, composition, frameCount } =
					await loadComposition(ctx, ref);
				const frames = refs.map((r) => {
					const f = parseFrame(r, composition.fps);
					if (f >= frameCount) {
						throw usageError(
							`frame ${r} (${f}) is past the end: ${target.id} has ${frameCount} frames (0–${frameCount - 1})`,
						);
					}
					return f;
				});
				const dir = await outputDir(project, "frames", target.id);
				const renderer = new engine.HeadlessMediaRenderer();
				const files: string[] = [];
				for (const frame of frames) {
					const file = path.join(dir, frameFileName(frame));
					ctx.out.info(`rendering frame ${frame}`);
					const png = await composition.renderFrame({
						frame,
						renderer: renderer as never,
					});
					await fs.writeFile(file, png);
					const rel = ctx.relative(project, file);
					files.push(rel);
					if (!ctx.out.json) ctx.out.line(rel);
				}
				ctx.out.result({ files }, () => {});
			}),
		);
}
