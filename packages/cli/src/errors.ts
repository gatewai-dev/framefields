/** Exit codes (SPEC §7). */
export const EXIT = {
	ok: 0,
	failed: 1,
	usage: 2,
	auth: 3,
	project: 4,
	interrupted: 130,
} as const;

export type ErrorCode = keyof typeof EXIT;

/** An error the CLI reports as `error: <message>` plus an optional hint. */
export class CliError extends Error {
	override name = "CliError";
	readonly code: ErrorCode;
	readonly hint?: string;
	constructor(
		message: string,
		options: { code?: ErrorCode; hint?: string; cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.code = options.code ?? "failed";
		this.hint = options.hint;
	}
	get exitCode(): number {
		return EXIT[this.code];
	}
}

export const usageError = (message: string, hint?: string) =>
	new CliError(message, { code: "usage", hint });
