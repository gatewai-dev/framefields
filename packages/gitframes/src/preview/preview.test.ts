import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildEngine, prebuiltEngineDir } from "./bundle.js";
import { type PreviewSession, startPreview } from "./index.js";

const entry = new URL("./fixtures/comp.ts", import.meta.url);

describe("startPreview", () => {
	const sessions: PreviewSession[] = [];
	const start = async (...args: Parameters<typeof startPreview>) => {
		const s = await startPreview(...args);
		sessions.push(s);
		return s;
	};
	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((s) => s.close()));
	});

	it("serves meta, the page, and the composition's browser bundle", async () => {
		const session = await start(
			{ entry },
			{ open: false, port: 0, title: "Test" },
		);

		const meta = await (await fetch(`${session.url}meta`)).json();
		expect(meta).toMatchObject({
			title: "Test",
			fps: 10,
			frameCount: 10,
			width: 64,
			audio: { state: "none" },
		});

		const page = await (await fetch(session.url)).text();
		expect(page).toContain('id="canvas"');
		expect(page).toContain("/@gitframes/player.js");

		const player = await fetch(`${session.url}@gitframes/player.js`);
		expect(player.headers.get("content-type")).toContain("javascript");
		const code = await player.text();
		expect(code).toContain("startPlayer");
		expect(code).not.toContain("Could not build the preview");
	}, 60_000);

	it("serves the browser engine the project bundle imports", async () => {
		const session = await start({ entry }, { open: false, port: 0 });

		const player = await fetch(`${session.url}@gitframes/engine/player.mjs`);
		expect(player.status).toBe(200);
		expect(player.headers.get("content-type")).toContain("javascript");
		expect(await player.text()).toContain("startPlayer");

		const shim = await fetch(`${session.url}@gitframes/engine/shims/path.mjs`);
		expect(shim.status).toBe(200);
		expect(await shim.text()).toContain("export");

		expect(
			(await fetch(`${session.url}@gitframes/engine/missing.mjs`)).status,
		).toBe(404);
	}, 60_000);

	it("serves project files by absolute path, with byte ranges", async () => {
		const session = await start({ entry }, { open: false, port: 0 });
		const file = fileURLToPath(entry);

		const whole = await fetch(`${session.url}${file.slice(1)}`);
		expect(whole.status).toBe(200);
		expect(await whole.text()).toContain("stand-in composition");

		const part = await fetch(`${session.url}${file.slice(1)}`, {
			headers: { range: "bytes=0-1" },
		});
		expect(part.status).toBe(206);
		expect(await part.text()).toBe("//");

		expect((await fetch(`${session.url}etc/hosts`)).status).toBe(404);

		const stat = (p: string) =>
			fetch(`${session.url}@gitframes/stat?path=${encodeURIComponent(p)}`).then(
				(r) => r.json(),
			);
		expect(await stat(file)).toMatchObject({ exists: true });
		expect(await stat(`${file}.missing`)).toEqual({ exists: false, size: 0 });
		expect(await stat("/etc/hosts")).toEqual({ exists: false, size: 0 });
	});

	it("serves assets from the project root, not only the entry's directory", async () => {
		const project = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "gf-project-"),
		);
		try {
			const src = path.join(project, "src");
			const fonts = path.join(project, "assets", "fonts");
			await fs.promises.mkdir(src, { recursive: true });
			await fs.promises.mkdir(fonts, { recursive: true });
			// A project with no .git: the root is the nearest package.json.
			await fs.promises.writeFile(path.join(project, "package.json"), "{}");
			const comp = path.join(src, "comp.ts");
			await fs.promises.writeFile(
				comp,
				"export default function build() { return { fps: 10, durationMs: 1000, width: 64, height: 36 }; }",
			);
			const font = path.join(fonts, "Test.ttf");
			await fs.promises.writeFile(font, "font-bytes");

			const session = await start({ entry: comp }, { open: false, port: 0 });
			const res = await fetch(`${session.url}${font.slice(1)}`);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("font-bytes");
		} finally {
			await fs.promises.rm(project, { recursive: true, force: true });
		}
	});

	it("allows extra asset roots outside the project", async () => {
		const project = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "gf-project-"),
		);
		const shared = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "gf-shared-"),
		);
		try {
			const src = path.join(project, "src");
			await fs.promises.mkdir(src, { recursive: true });
			await fs.promises.writeFile(path.join(project, "package.json"), "{}");
			const comp = path.join(src, "comp.ts");
			await fs.promises.writeFile(
				comp,
				"export default function build() { return { fps: 10, durationMs: 1000, width: 64, height: 36 }; }",
			);
			const font = path.join(shared, "Shared.ttf");
			await fs.promises.writeFile(font, "shared-bytes");

			const session = await start(
				{ entry: comp },
				{ open: false, port: 0, root: [project, shared] },
			);
			const res = await fetch(`${session.url}${font.slice(1)}`);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("shared-bytes");
		} finally {
			await fs.promises.rm(project, { recursive: true, force: true });
			await fs.promises.rm(shared, { recursive: true, force: true });
		}
	});

	it("names a missing export", async () => {
		await expect(
			startPreview({ entry, export: "film" }, { open: false, port: 0 }),
		).rejects.toThrow(/no export named "film"/);
	});

	it("closes once the last tab has gone, but not on a reload", async () => {
		const lines: string[] = [];
		const session = await start(
			{ entry },
			{ open: false, port: 0, idleCloseMs: 100, log: (l) => lines.push(l) },
		);
		let isClosed = false;
		session.closed.then(() => {
			isClosed = true;
		});
		const connect = () =>
			new Promise<http.ClientRequest>((resolve) => {
				const req = http.get(`${session.url}events`, { agent: false }, () =>
					resolve(req),
				);
			});
		// A reload: the tab drops and is back well inside the grace period.
		(await connect()).destroy();
		await new Promise((r) => setTimeout(r, 30));
		const tab = await connect();
		await new Promise((r) => setTimeout(r, 200));
		expect(isClosed).toBe(false);
		// The tab closes for good.
		tab.destroy();
		expect(await session.closed).toBe("idle");
		expect(lines).toEqual([
			"[gitframes preview] page opened; the server stops 0.1 s after its last tab closes",
			"[gitframes preview] stopped: its tab was closed",
		]);
	});

	it("reports the page's errors once each", async () => {
		const lines: string[] = [];
		const session = await start(
			{ entry },
			{ open: false, port: 0, log: (l) => lines.push(l) },
		);
		const send = (body: unknown, type = "application/json") =>
			fetch(`${session.url}@gitframes/log`, {
				method: "POST",
				headers: { "content-type": type },
				body: JSON.stringify(body),
			});
		expect((await send({ level: "error", message: "boom" })).status).toBe(204);
		await send({ level: "error", message: "boom" });
		await send({ level: "warning", message: "[gitframes] font" });
		// Not JSON: a form post from another site.
		expect((await send({ message: "spoof" }, "text/plain")).status).toBe(404);
		expect(lines).toEqual([
			"[gitframes preview] error in the page: boom",
			"[gitframes preview] warning in the page: [gitframes] font",
		]);
	});

	it("keeps notes pinned on the page as files, and reports them", async () => {
		const project = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "gf-notes-"),
		);
		try {
			const dir = path.join(project, ".gitframes", "preview-notes");
			const lines: string[] = [];
			const session = await start(
				{ entry },
				{ open: false, port: 0, notesDir: dir, log: (l) => lines.push(l) },
			);
			const meta = await (await fetch(`${session.url}meta`)).json();
			expect(meta.notesDir).toBe(dir);

			const send = (body: unknown) =>
				fetch(`${session.url}@gitframes/notes`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
			const jpeg = `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`;
			const added = await (
				await send({
					op: "add",
					note: {
						frame: 5,
						time: 0.5,
						x: 0.25,
						y: 0.5,
						text: " Bigger title ",
						image: jpeg,
					},
				})
			).json();
			expect(added).toMatchObject({
				id: 1,
				frame: 5,
				x: 0.25,
				y: 0.5,
				text: "Bigger title",
				done: false,
			});
			expect(await fs.promises.readFile(added.image, "utf8")).toBe(
				"jpeg-bytes",
			);
			expect(
				await fs.promises.readFile(
					path.join(project, ".gitframes", ".gitignore"),
					"utf8",
				),
			).toBe("*\n");
			expect(lines.at(-1)).toBe(
				`[gitframes preview] note 1 at 0:00.50 (frame 5), spot 25%,50%: Bigger title\n  frame with the spot marked: ${added.image} · all notes: ${dir}/notes.json`,
			);

			await send({
				op: "add",
				note: {
					frame: 2,
					time: 0.2,
					x: 0.1,
					y: 0.1,
					w: 0.5,
					h: 0.2,
					text: "Too dark",
				},
			});
			await send({ op: "update", id: 2, done: true });
			expect(lines.at(-1)).toBe("[gitframes preview] note 2 marked done");

			// notes.json is the record: edits made to it show up.
			const file = JSON.parse(
				await fs.promises.readFile(path.join(dir, "notes.json"), "utf8"),
			);
			expect(file).toHaveLength(2);
			expect(file[1]).toMatchObject({ w: 0.5, h: 0.2, done: true });

			expect((await send({ op: "remove", id: 1 })).status).toBe(200);
			expect(fs.existsSync(added.image)).toBe(false);
			const list = await (await fetch(`${session.url}@gitframes/notes`)).json();
			expect(list.map((n: { id: number }) => n.id)).toEqual([2]);
			expect((await send({ op: "remove", id: 9 })).status).toBe(404);
		} finally {
			await fs.promises.rm(project, { recursive: true, force: true });
		}
	});

	it("a new preview of the project takes over the port", async () => {
		const first = await start({ entry }, { open: false, port: 0 });
		const port = Number(new URL(first.url).port);
		const second = await start({ entry }, { open: false, port });

		expect(await first.closed).toBe("replaced");
		expect(second.url).toBe(first.url);
		expect((await fetch(`${second.url}meta`)).status).toBe(200);
	});
});

describe("browser engine", () => {
	it("loads every entry, with no Node built-ins left unshimmed", async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gf-engine-"));
		try {
			await buildEngine(dir);
			for (const name of [
				"gitframes",
				"effects",
				"audio",
				"signals",
				"fonts",
				"player",
			]) {
				// Importing runs the module's top-level code, as a browser would.
				await import(pathToFileURL(path.join(dir, `${name}.mjs`)).href);
			}
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	}, 120_000);
});

describe("prebuiltEngineDir", () => {
	it("finds the engine at the dist root or beside dist/preview", async () => {
		const root = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "gf-engine-"),
		);
		try {
			const engine = path.join(root, "preview-engine");
			expect(prebuiltEngineDir(root)).toBeUndefined();

			await fs.promises.mkdir(engine, { recursive: true });
			await fs.promises.writeFile(path.join(engine, "player.mjs"), "export {}");
			expect(prebuiltEngineDir(root)).toBe(engine);

			const nested = path.join(root, "preview");
			await fs.promises.mkdir(nested, { recursive: true });
			expect(prebuiltEngineDir(nested)).toBe(engine);
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});
});
