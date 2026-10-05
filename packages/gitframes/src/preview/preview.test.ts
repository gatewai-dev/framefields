import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prebuiltEngineDir } from "./bundle.js";
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

	it("names a missing export", async () => {
		await expect(
			startPreview({ entry, export: "film" }, { open: false, port: 0 }),
		).rejects.toThrow(/no export named "film"/);
	});

	it("closes once the last tab has gone, but not on a reload", async () => {
		const session = await start(
			{ entry },
			{ open: false, port: 0, idleCloseMs: 100 },
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
		await session.closed;
	});

	it("a new preview of the project takes over the port", async () => {
		const first = await start({ entry }, { open: false, port: 0 });
		const port = Number(new URL(first.url).port);
		const second = await start({ entry }, { open: false, port });

		await first.closed;
		expect(second.url).toBe(first.url);
		expect((await fetch(`${second.url}meta`)).status).toBe(200);
	});
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
