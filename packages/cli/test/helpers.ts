import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";
import type { Io } from "../src/output.js";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
	json<T = unknown>(): T;
}

export interface RunOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	stdin?: string;
	tty?: boolean;
	answers?: string[];
}

/** Runs `ff` in-process with a fake terminal. */
export async function ff(
	args: string[],
	options: RunOptions,
): Promise<RunResult> {
	let stdout = "";
	let stderr = "";
	const answers = [...(options.answers ?? [])];
	const io: Io = {
		stdout: (t) => {
			stdout += t;
		},
		stderr: (t) => {
			stderr += t;
		},
		readStdin: async () => options.stdin ?? "",
		isTTY: !!options.tty,
		colorSupported: false,
		prompt: async () => answers.shift() ?? "",
		openUrl: () => {},
	};
	const code = await run(args, {
		io,
		env: { ...options.env },
		cwd: options.cwd,
	});
	return {
		code,
		stdout,
		stderr,
		json: <T>() => JSON.parse(stdout) as T,
	};
}

const dirs: string[] = [];
export function tmpdir(prefix = "ff-cli-"): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}
export function cleanupTmp() {
	for (const d of dirs.splice(0))
		fs.rmSync(d, { recursive: true, force: true });
}

export function writeFiles(
	root: string,
	files: Record<string, string | Buffer>,
) {
	for (const [rel, content] of Object.entries(files)) {
		const file = path.join(root, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}
}

/** Commits by a test identity, without touching the user's git config. */
export function gitEnv(home: string) {
	Object.assign(process.env, {
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.com",
		GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_ALLOW_PROTOCOL: "file",
	});
	fs.writeFileSync(
		path.join(home, "gitconfig"),
		'[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n',
	);
}
