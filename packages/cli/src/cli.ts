/**
 * The `ff` command line. `run()` is the whole CLI as a function of
 * `(args, io, env, cwd)`, so tests drive it without a terminal; `bin.ts` wires
 * it to the process.
 */
import { Command, CommanderError } from "commander";
import * as api from "./commands/api.js";
import * as asset from "./commands/asset.js";
import * as auth from "./commands/auth.js";
import * as check from "./commands/check.js";
import * as clone from "./commands/clone.js";
import * as config from "./commands/config.js";
import * as frames from "./commands/frames.js";
import * as grid from "./commands/grid.js";
import * as init from "./commands/init.js";
import * as issue from "./commands/issue.js";
import * as ls from "./commands/ls.js";
import * as pr from "./commands/pr.js";
import * as preview from "./commands/preview.js";
import * as render from "./commands/render.js";
import * as repo from "./commands/repo.js";
import * as sync from "./commands/sync.js";
import { Context, type Deps, type GlobalOptions } from "./context.js";
import { CliError, EXIT } from "./errors.js";
import { Output } from "./output.js";
import { VERSION } from "./version.js";

// biome-ignore lint/suspicious/noExplicitAny: commander passes positional arguments untyped
export type Handler = (ctx: Context, ...args: any[]) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: see Handler
export type Wrap = (handler: Handler) => (...args: any[]) => Promise<void>;

export function buildProgram(deps: Deps): Command {
	const program = new Command("ff")
		.description(
			"The command line for Framefields projects: preview and render compositions, and work with Framefields Cloud.",
		)
		.version(VERSION, "-V, --version")
		.option("--json", "print one JSON value on stdout")
		.option("--yes", "never prompt; assume yes for confirmations")
		.option("-C, --directory <dir>", "run as if started in <dir>")
		.option(
			"--host <url>",
			"Framefields Cloud host (default https://framefields.dev)",
		)
		.option("-q, --quiet", "no progress output on stderr")
		.option("--verbose", "more output on stderr")
		.option("--no-color", "no colors")
		.showHelpAfterError("(run with --help for usage)")
		.configureOutput({
			writeOut: (t) => deps.io.stdout(t),
			writeErr: (t) => deps.io.stderr(t),
			outputError: (t, write) => write(t),
		})
		.exitOverride();

	const wrap: Wrap =
		(handler) =>
		async (...args) => {
			const command = args[args.length - 1] as Command;
			const globals = command.optsWithGlobals() as GlobalOptions;
			const ctx = new Context(globals, deps);
			// commander passes (...operands, options, command); handlers take (ctx, ...operands, options).
			await handler(ctx, ...args.slice(0, -1));
		};

	for (const mod of [
		ls,
		check,
		preview,
		frames,
		grid,
		render,
		init,
		auth,
		config,
		repo,
		clone,
		sync,
		asset,
		issue,
		pr,
		api,
	]) {
		mod.register(program, wrap);
	}
	// Subcommands inherit the global options' help text and error handling.
	const configure = (cmd: Command) => {
		cmd.exitOverride();
		cmd.configureOutput(program.configureOutput());
		cmd.showHelpAfterError("(run with --help for usage)");
		for (const sub of cmd.commands) configure(sub);
	};
	for (const cmd of program.commands) configure(cmd);
	return program;
}

/** Runs `ff` with `args` (without `node ff`) and returns the exit code. */
export async function run(args: string[], deps: Deps): Promise<number> {
	const program = buildProgram(deps);
	try {
		await program.parseAsync(args, { from: "user" });
		return EXIT.ok;
	} catch (err) {
		if (err instanceof CommanderError) {
			// --help and --version end here too.
			if (err.exitCode === 0) return EXIT.ok;
			return EXIT.usage;
		}
		return report(err, args, deps);
	}
}

function report(err: unknown, args: string[], deps: Deps): number {
	const json = args.includes("--json");
	const cliError =
		err instanceof CliError
			? err
			: new CliError(err instanceof Error ? err.message : String(err), {
					cause: err,
				});
	const out = new Output(deps.io, {
		json,
		quiet: false,
		verbose: false,
		color:
			!args.includes("--no-color") &&
			deps.io.colorSupported &&
			deps.env.NO_COLOR === undefined,
	});
	deps.io.stderr(`${out.style("red", "error:")} ${cliError.message}\n`);
	if (cliError.hint) deps.io.stderr(`  hint: ${cliError.hint}\n`);
	if (
		args.includes("--verbose") &&
		err instanceof Error &&
		!(err instanceof CliError)
	) {
		deps.io.stderr(`${err.stack}\n`);
	}
	if (json) {
		deps.io.stdout(
			`${JSON.stringify({ error: { code: cliError.code, message: cliError.message, hint: cliError.hint ?? null } }, null, 2)}\n`,
		);
	}
	return cliError.exitCode;
}
