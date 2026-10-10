/**
 * Output contract (SPEC §7): stdout carries data — one JSON value with
 * `--json`, tables, `key: value` views or written paths otherwise — and
 * progress and logs go to stderr.
 */
import { spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { CliError } from "./errors.js";

/** The terminal, injected so commands run without one in tests. */
export interface Io {
	stdout(text: string): void;
	stderr(text: string): void;
	/** Reads all of stdin. */
	readStdin(): Promise<string>;
	/** True when stdin and stdout are terminals, so prompting is allowed. */
	isTTY: boolean;
	/** Whether stderr supports colors. */
	colorSupported: boolean;
	/** Asks a question on the terminal. Only called when `isTTY`. */
	prompt(question: string, options?: { secret?: boolean }): Promise<string>;
	/** Opens a URL in the user's browser. */
	openUrl(url: string): void;
}

export function processIo(): Io {
	// stdout is the CLI's data only. The engine's logger, the composition's
	// console.log and anything else writing to stdout go to stderr instead.
	const stdout = process.stdout.write.bind(process.stdout);
	process.stdout.write = process.stderr.write.bind(
		process.stderr,
	) as typeof process.stdout.write;
	return {
		stdout: (t) => void stdout(t),
		stderr: (t) => void process.stderr.write(t),
		readStdin: async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
			return Buffer.concat(chunks).toString("utf8");
		},
		isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY,
		colorSupported:
			!!process.stderr.isTTY && process.env.NO_COLOR === undefined,
		prompt: async (question, options = {}) => {
			// Prompts draw on stderr: stdout is data.
			const common = { message: question, output: process.stderr };
			const answer = options.secret
				? await clack.password(common)
				: await clack.text(common);
			if (clack.isCancel(answer)) {
				throw new CliError("cancelled", { code: "interrupted" });
			}
			return answer.trim();
		},
		openUrl: (url) => {
			const [cmd, args] =
				process.platform === "darwin"
					? ["open", [url]]
					: process.platform === "win32"
						? ["cmd", ["/c", "start", "", url]]
						: ["xdg-open", [url]];
			try {
				spawn(cmd, args, { stdio: "ignore", detached: true })
					.on("error", () => {})
					.unref();
			} catch {}
		},
	};
}

export interface OutputOptions {
	json: boolean;
	quiet: boolean;
	verbose: boolean;
	color: boolean;
}

const ANSI = {
	bold: [1, 22],
	dim: [2, 22],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	cyan: [36, 39],
} as const;

export class Output {
	constructor(
		readonly io: Io,
		readonly options: OutputOptions,
	) {}

	get json(): boolean {
		return this.options.json;
	}

	style(name: keyof typeof ANSI, text: string): string {
		if (!this.options.color) return text;
		const [open, close] = ANSI[name];
		return `\u001b[${open}m${text}\u001b[${close}m`;
	}

	/** Prints a command's result: JSON with `--json`, else `human()`. */
	result(value: unknown, human: () => void): void {
		if (this.options.json)
			this.io.stdout(`${JSON.stringify(value, null, 2)}\n`);
		else human();
	}

	/** A line of human output on stdout (never with `--json`). */
	line(text = ""): void {
		if (!this.options.json) this.io.stdout(`${text}\n`);
	}

	/** Progress or a note on stderr, unless `--quiet`. */
	info(text: string): void {
		if (!this.options.quiet) this.io.stderr(`${text}\n`);
	}

	warn(text: string): void {
		this.io.stderr(`${this.style("yellow", "warning:")} ${text}\n`);
	}

	debug(text: string): void {
		if (this.options.verbose) this.io.stderr(`${this.style("dim", text)}\n`);
	}

	/** A table for lists. */
	table(
		rows: Record<string, unknown>[],
		columns: { key: string; label: string }[],
	): void {
		if (rows.length === 0) return;
		const cells = rows.map((r) =>
			columns.map((c) =>
				r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]),
			),
		);
		const widths = columns.map((c, i) =>
			Math.max(c.label.length, ...cells.map((row) => (row[i] ?? "").length)),
		);
		const fmt = (row: string[]) =>
			row
				.map((cell, i) =>
					i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0),
				)
				.join("  ")
				.trimEnd();
		this.line(
			this.style("bold", fmt(columns.map((c) => c.label.toUpperCase()))),
		);
		for (const row of cells) this.line(fmt(row));
	}

	/** `key: value` lines for views. */
	view(pairs: [string, unknown][]): void {
		for (const [key, value] of pairs) {
			if (value === undefined) continue;
			this.line(
				`${this.style("dim", `${key}:`)} ${value === null ? "-" : String(value)}`,
			);
		}
	}
}
