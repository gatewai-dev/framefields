import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchAssets } from "./assets.js";

let workdir: string;
let cacheDir: string;
beforeEach(() => {
	workdir = mkdtempSync(path.join(tmpdir(), "ff-ws-"));
	cacheDir = mkdtempSync(path.join(tmpdir(), "ff-cache-"));
});
afterEach(() => {
	rmSync(workdir, { recursive: true, force: true });
	rmSync(cacheDir, { recursive: true, force: true });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const INTRO = "intro frames";
const RAW = "raw interview";

function project(assets: Record<string, unknown>) {
	writeFileSync(
		path.join(workdir, "framefields.json"),
		JSON.stringify({
			storage: {
				default: "media",
				remotes: {
					media: {
						endpoint: "https://acct.r2.cloudflarestorage.com",
						bucket: "films",
						publicUrl: "https://media.example.com",
					},
					raw: {
						endpoint: "https://acct.r2.cloudflarestorage.com",
						bucket: "raw",
					},
				},
			},
			assets,
		}),
	);
}

function served(files: Record<string, string>) {
	const requests: string[] = [];
	const fetch = (async (input: string | URL | Request) => {
		const url = String(input instanceof Request ? input.url : input);
		requests.push(url);
		const body = files[url];
		return body === undefined
			? new Response(null, { status: 404 })
			: new Response(body);
	}) as typeof globalThis.fetch;
	return { fetch, requests };
}

const introUrl = `https://media.example.com/sha256/${sha(INTRO).slice(0, 2)}/${sha(INTRO)}`;

describe("fetchAssets", () => {
	it("downloads from the custom domain once, then copies from the cache", async () => {
		project({ "assets/intro.mp4": { sha256: sha(INTRO), size: INTRO.length } });
		const cdn = served({ [introUrl]: INTRO });
		expect(await fetchAssets(workdir, { cacheDir, fetch: cdn.fetch })).toEqual({
			files: 1,
			bytes: INTRO.length,
			cache: "miss",
		});
		expect(readFileSync(path.join(workdir, "assets/intro.mp4"), "utf8")).toBe(
			INTRO,
		);

		rmSync(path.join(workdir, "assets"), { recursive: true });
		expect(
			(await fetchAssets(workdir, { cacheDir, fetch: cdn.fetch })).cache,
		).toBe("hit");
		expect(cdn.requests).toEqual([introUrl]);
	});

	it("reads private remotes through the job's signed URLs", async () => {
		project({
			"assets/raw.mov": { sha256: sha(RAW), size: RAW.length, remote: "raw" },
		});
		await expect(
			fetchAssets(workdir, { cacheDir, fetch: served({}).fetch }),
		).rejects.toMatchObject({
			code: "ASSET_PRIVATE",
		});
		const signedUrl =
			"https://acct.r2.cloudflarestorage.com/raw/x?X-Amz-Signature=s";
		const cdn = served({ [signedUrl]: RAW });
		await fetchAssets(workdir, {
			cacheDir,
			fetch: cdn.fetch,
			signed: { [sha(RAW)]: signedUrl },
		});
		expect(readFileSync(path.join(workdir, "assets/raw.mov"), "utf8")).toBe(
			RAW,
		);
	});

	it("names missing uploads and wrong bytes", async () => {
		project({ "assets/intro.mp4": { sha256: sha(INTRO), size: INTRO.length } });
		await expect(
			fetchAssets(workdir, { cacheDir, fetch: served({}).fetch }),
		).rejects.toMatchObject({
			code: "ASSET_NOT_UPLOADED",
			hint: "Run `npx framefields assets push` and render again.",
		});
		await expect(
			fetchAssets(workdir, {
				cacheDir,
				fetch: served({ [introUrl]: "intro framez" }).fetch,
			}),
		).rejects.toMatchObject({ code: "ASSET_HASH_MISMATCH" });
	});

	it("does nothing without assets, and refuses paths outside the project", async () => {
		expect((await fetchAssets(workdir, { cacheDir })).cache).toBe("off");
		project({ "../escape.mp4": { sha256: sha(INTRO), size: 1 } });
		await expect(fetchAssets(workdir, { cacheDir })).rejects.toMatchObject({
			code: "ASSET_MANIFEST_INVALID",
		});
	});

	it("won't write through a folder that links out of the checkout", async () => {
		const outside = mkdtempSync(path.join(tmpdir(), "ff-outside-"));
		symlinkSync(outside, path.join(workdir, "assets"));
		project({ "assets/intro.mp4": { sha256: sha(INTRO), size: INTRO.length } });
		await expect(
			fetchAssets(workdir, {
				cacheDir,
				fetch: served({ [introUrl]: INTRO }).fetch,
			}),
		).rejects.toMatchObject({ code: "PATH_ESCAPE" });
		rmSync(outside, { recursive: true, force: true });
	});
});
