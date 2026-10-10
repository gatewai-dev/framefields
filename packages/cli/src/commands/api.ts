import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import { apiError } from "../cloud/client.js";
import { usageError } from "../errors.js";

const collect = (value: string, previous: string[] = []) => [
	...previous,
	value,
];

function splitField(field: string): [string, string] {
	const i = field.indexOf("=");
	if (i <= 0) throw usageError(`'${field}' is not key=value`);
	return [field.slice(0, i), field.slice(i + 1)];
}

/** `-F`: true, false, null and numbers become JSON values; `@file` reads a file. */
function typedValue(value: string, cwd: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (value.startsWith("@"))
		return fs.readFileSync(path.resolve(cwd, value.slice(1)), "utf8");
	return value;
}

export function register(program: Command, wrap: Wrap) {
	program
		.command("api")
		.description(
			"Make an authenticated request to the Framefields Cloud API (like gh api)",
		)
		.argument("<path>", "e.g. /v1/repos")
		.option(
			"-X, --method <method>",
			"HTTP method (default GET, or POST with fields or --input)",
		)
		.option(
			"-f, --raw-field <key=value>",
			"add a string field (repeatable)",
			collect,
			[],
		)
		.option(
			"-F, --field <key=value>",
			"add a typed field: numbers, true/false/null, @file (repeatable)",
			collect,
			[],
		)
		.option(
			"-H, --header <key:value>",
			"add a header (repeatable)",
			collect,
			[],
		)
		.option("--input <file>", "request body from a file (- for stdin)")
		.option("-i, --include", "print the status line and headers")
		.addHelpText(
			"after",
			"\nFields go in the query string for GET and in a JSON body otherwise.\n\nExamples:\n  ff api /v1/repos\n  ff api /v1/renders -f repositoryId=repo_123 -f commitSha=abc1234 -f composition=film",
		)
		.action(
			wrap(
				async (
					ctx,
					apiPath: string,
					opts: {
						method?: string;
						rawField: string[];
						field: string[];
						header: string[];
						input?: string;
						include?: boolean;
					},
				) => {
					const client = await ctx.client();
					client.requireToken();
					const fields: Record<string, unknown> = {};
					for (const f of opts.rawField) {
						const [k, v] = splitField(f);
						fields[k] = v;
					}
					for (const f of opts.field) {
						const [k, v] = splitField(f);
						fields[k] = typedValue(v, ctx.cwd);
					}
					const hasFields = Object.keys(fields).length > 0;
					const method = (
						opts.method ?? (hasFields || opts.input ? "POST" : "GET")
					).toUpperCase();
					const headers: Record<string, string> = {};
					for (const h of opts.header) {
						const i = h.indexOf(":");
						if (i <= 0) throw usageError(`'${h}' is not key:value`);
						headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
					}
					let rawBody: string | undefined;
					if (opts.input !== undefined) {
						if (hasFields) throw usageError("--input and fields are exclusive");
						rawBody =
							opts.input === "-"
								? await ctx.io.readStdin()
								: fs.readFileSync(path.resolve(ctx.cwd, opts.input), "utf8");
						headers["Content-Type"] ??= "application/json";
					}
					const query =
						method === "GET" && hasFields
							? (fields as Record<string, string>)
							: undefined;
					const body = method !== "GET" && hasFields ? fields : undefined;
					const p =
						apiPath.startsWith("/") || /^https?:/.test(apiPath)
							? apiPath
							: `/${apiPath}`;
					const res = await client.raw(method, p, {
						query,
						body,
						rawBody,
						headers,
					});
					const text = await res.text();
					if (opts.include) {
						ctx.io.stdout(`HTTP ${res.status} ${res.statusText}\n`);
						for (const [k, v] of res.headers) ctx.io.stdout(`${k}: ${v}\n`);
						ctx.io.stdout("\n");
					}
					let pretty = text;
					try {
						pretty = JSON.stringify(JSON.parse(text), null, 2);
					} catch {}
					if (pretty)
						ctx.io.stdout(`${pretty}${pretty.endsWith("\n") ? "" : "\n"}`);
					if (!res.ok) {
						let data: unknown = text;
						try {
							data = JSON.parse(text);
						} catch {}
						throw apiError(res.status, data, `${method} ${p}`);
					}
				},
			),
		);
}
