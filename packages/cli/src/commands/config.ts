import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import {
	assertConfigKey,
	CONFIG_KEYS,
	readConfig,
	writeConfig,
} from "../config.js";
import { usageError } from "../errors.js";

export function register(program: Command, wrap: Wrap) {
	const config = program
		.command("config")
		.description(
			"Read and write per-user settings (~/.config/framefields/config.json)",
		)
		.addHelpText(
			"after",
			`\nKeys:\n${Object.entries(CONFIG_KEYS)
				.map(([k, v]) => `  ${k.padEnd(8)} ${v}`)
				.join("\n")}`,
		);

	config
		.command("get")
		.argument("<key>")
		.description("Print a setting")
		.action(
			wrap(async (ctx, key: string) => {
				assertConfigKey(key);
				const value = (await readConfig(ctx.env))[key] ?? null;
				ctx.out.result({ [key]: value }, () => {
					if (value !== null) ctx.out.line(value);
				});
			}),
		);

	config
		.command("set")
		.argument("<key>")
		.argument("[value]", "omit to unset")
		.description("Change a setting")
		.action(
			wrap(async (ctx, key: string, value: string | undefined) => {
				assertConfigKey(key);
				if (
					key === "prompt" &&
					value !== undefined &&
					!["enabled", "disabled"].includes(value)
				) {
					throw usageError("prompt is 'enabled' or 'disabled'");
				}
				const current = await readConfig(ctx.env);
				if (value === undefined) delete current[key];
				else current[key] = value;
				await writeConfig(ctx.env, current);
				ctx.out.result({ [key]: value ?? null }, () => {});
			}),
		);

	config
		.command("list")
		.description("Print all settings")
		.action(
			wrap(async (ctx) => {
				const current = await readConfig(ctx.env);
				ctx.out.result(current, () => ctx.out.view(Object.entries(current)));
			}),
		);
}
