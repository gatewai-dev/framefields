import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";

export function register(program: Command, wrap: Wrap) {
	program
		.command("ls")
		.description("List the project's compositions")
		.action(
			wrap(async (ctx) => {
				const project = await ctx.project();
				ctx.out.result(project, () => {
					ctx.out.table(
						project.compositions.map((c) => ({
							id: c.id,
							title: c.title,
							group: c.group,
							entry: `${c.entry}#${c.export}`,
							default: c.default ? "yes" : "",
						})),
						[
							{ key: "id", label: "id" },
							{ key: "title", label: "title" },
							{ key: "group", label: "group" },
							{ key: "entry", label: "entry" },
							{ key: "default", label: "default" },
						],
					);
				});
				if (project.source === "default") {
					const film = project.compositions[0];
					const exists =
						film && fs.existsSync(path.join(project.root, film.entry));
					ctx.out.info(
						exists
							? "no framefields.json: using the default composition"
							: `no framefields.json and no ${film?.entry}: create one, or run ff init`,
					);
				}
			}),
		);
}
