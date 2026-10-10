import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import { resolveTarget } from "../compositions.js";
import { usageError } from "../errors.js";

export function register(program: Command, wrap: Wrap) {
	program
		.command("preview")
		.description("Start the live preview of a composition and print its URL")
		.argument(
			"[composition]",
			"composition id or file#export (default composition when omitted)",
		)
		.option("--open", "open the page in the system browser")
		.option("--port <port>", "port to listen on (default: stable per project)")
		.option("--no-audio", "don't mix or play the soundtrack")
		.action(
			wrap(
				async (
					ctx,
					ref: string | undefined,
					opts: { open?: boolean; port?: string; audio: boolean },
				) => {
					const project = await ctx.project();
					const target = resolveTarget(project, ref);
					const port = opts.port === undefined ? undefined : Number(opts.port);
					if (
						port !== undefined &&
						(!Number.isInteger(port) || port < 0 || port > 65535)
					) {
						throw usageError(`--port ${opts.port} is not a port number`);
					}
					const engine = await ctx.engine(project);
					const options = {
						open: !!opts.open,
						port,
						audio: opts.audio,
						title: target.title,
					};
					// Engines that read framefields.json switch between compositions in the
					// page; older ones preview one entry.
					const session = ctx.engineHasProject(project)
						? await engine.startPreview(
								{ project, composition: ref },
								{ ...options, title: undefined },
							)
						: await engine.startPreview(
								{
									entry: path.join(project.root, target.entry),
									export: target.export,
								},
								options,
							);
					ctx.out.result({ url: session.url, composition: target.id }, () =>
						ctx.out.line(session.url),
					);
					ctx.out.info(
						`previewing ${target.id}; serves until its tab closes or the next ff preview takes over (ctrl-c to stop)`,
					);
					const reason = await session.closed;
					ctx.out.debug(`preview stopped: ${reason}`);
				},
			),
		);
}
