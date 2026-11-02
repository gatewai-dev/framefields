import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addAssets,
	assetStatus,
	prepareCloudAssets,
	pullAssets,
	pushAssets,
} from "./assets.js";
import { CONFIG_FILE, readConfig } from "./config.js";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "ff-assets-"));
	mkdirSync(join(cwd, "assets/footage"), { recursive: true });
	writeFileSync(join(cwd, "assets/footage/intro.mp4"), "intro frames");
	writeFileSync(join(cwd, "assets/footage/outro.mov"), "outro frames");
	writeFileSync(join(cwd, ".gitignore"), "node_modules/");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const env = {
	FRAMEFIELDS_STORAGE_MEDIA_ACCESS_KEY_ID: "id",
	FRAMEFIELDS_STORAGE_MEDIA_SECRET_ACCESS_KEY: "secret",
};

/**
 * One bucket behind two hosts: the S3 API (signed) and its custom domain
 * (public reads), as an R2 bucket with a custom domain is.
 */
function fakeR2() {
	const objects = new Map<string, Buffer>();
	const log: string[] = [];
	const handler = async (input: Request | string | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		const url = new URL(req.url);
		log.push(`${req.method} ${url.host}${url.pathname}`);
		const key =
			url.host === "media.example.com"
				? url.pathname.slice(1)
				: url.pathname.replace(/^\/films\//, "");
		if (
			url.host !== "media.example.com" &&
			!url.searchParams.has("X-Amz-Signature")
		)
			expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
		const body = objects.get(key);
		if (req.method === "PUT") {
			objects.set(key, Buffer.from(await req.arrayBuffer()));
			return new Response(null);
		}
		if (!body) return new Response(null, { status: 404 });
		if (req.method === "HEAD")
			return new Response(null, {
				headers: { "content-length": String(body.length) },
			});
		return new Response(body);
	};
	return { fetch: handler as typeof fetch, objects, log };
}

const manifest = (storage: object) =>
	writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify({ storage }));

const media = {
	endpoint: "https://acct.r2.cloudflarestorage.com",
	bucket: "films",
	publicUrl: "https://media.example.com",
};

describe("framefields assets", () => {
	it("adds a folder: uploads, pins by sha256, gitignores", async () => {
		manifest({ remotes: { media } });
		const r2 = fakeR2();
		const added = await addAssets(["assets/footage"], {
			cwd,
			env,
			fetch: r2.fetch,
		});
		expect(added.map((a) => [a.path, a.uploaded])).toEqual([
			["assets/footage/intro.mp4", true],
			["assets/footage/outro.mov", true],
		]);
		expect(readConfig(cwd).config.assets).toEqual({
			"assets/footage/intro.mp4": { sha256: sha("intro frames"), size: 12 },
			"assets/footage/outro.mov": { sha256: sha("outro frames"), size: 12 },
		});
		expect(
			r2.objects
				.get(`sha256/${sha("intro frames").slice(0, 2)}/${sha("intro frames")}`)
				?.toString(),
		).toBe("intro frames");
		expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
			"node_modules/\n# framefields assets: on the bucket, pinned in framefields.json\n/assets/footage/intro.mp4\n/assets/footage/outro.mov\n",
		);
		// Adding again uploads nothing and ignores nothing twice.
		const again = await addAssets(["assets/footage/intro.mp4"], {
			cwd,
			env,
			fetch: r2.fetch,
		});
		expect(again[0].uploaded).toBe(false);
		expect(
			readFileSync(join(cwd, ".gitignore"), "utf8").match(/intro/g),
		).toHaveLength(1);
	});

	it("pulls from the custom domain without keys, and verifies", async () => {
		manifest({ remotes: { media } });
		const r2 = fakeR2();
		await addAssets(["assets/footage"], { cwd, env, fetch: r2.fetch });
		rmSync(join(cwd, "assets/footage/intro.mp4"));
		writeFileSync(join(cwd, "assets/footage/outro.mov"), "edited");
		r2.log.length = 0;
		const pulled = await pullAssets({ cwd, env: {}, fetch: r2.fetch });
		expect(pulled).toEqual({
			downloaded: ["assets/footage/intro.mp4"],
			present: [],
			changed: ["assets/footage/outro.mov"],
		});
		expect(r2.log).toEqual([
			`GET media.example.com/sha256/${sha("intro frames").slice(0, 2)}/${sha("intro frames")}`,
		]);
		expect(readFileSync(join(cwd, "assets/footage/intro.mp4"), "utf8")).toBe(
			"intro frames",
		);
		expect((await assetStatus(cwd)).map((a) => a.state)).toEqual([
			"ok",
			"changed",
		]);
		await pullAssets({ cwd, env: {}, fetch: r2.fetch, overwrite: true });
		expect(readFileSync(join(cwd, "assets/footage/outro.mov"), "utf8")).toBe(
			"outro frames",
		);
	});

	it("needs keys for a private bucket, and names them", async () => {
		manifest({ remotes: { media: { ...media, publicUrl: undefined } } });
		const r2 = fakeR2();
		await addAssets(["assets/footage/intro.mp4"], {
			cwd,
			env,
			fetch: r2.fetch,
		});
		rmSync(join(cwd, "assets/footage/intro.mp4"));
		await expect(pullAssets({ cwd, env: {}, fetch: r2.fetch })).rejects.toThrow(
			"set FRAMEFIELDS_STORAGE_MEDIA_ACCESS_KEY_ID and FRAMEFIELDS_STORAGE_MEDIA_SECRET_ACCESS_KEY",
		);
		await pullAssets({ cwd, env, fetch: r2.fetch });
		expect(readFileSync(join(cwd, "assets/footage/intro.mp4"), "utf8")).toBe(
			"intro frames",
		);
	});

	it("push uploads what the bucket lost, and refuses files that changed", async () => {
		manifest({ remotes: { media } });
		const r2 = fakeR2();
		await addAssets(["assets/footage"], { cwd, env, fetch: r2.fetch });
		r2.objects.clear();
		expect(await pushAssets({ cwd, env, fetch: r2.fetch })).toEqual({
			uploaded: ["assets/footage/intro.mp4", "assets/footage/outro.mov"],
			present: [],
		});
		r2.objects.clear();
		writeFileSync(join(cwd, "assets/footage/intro.mp4"), "edited");
		await expect(pushAssets({ cwd, env, fetch: r2.fetch })).rejects.toThrow(
			"assets/footage/intro.mp4 (changed here)",
		);
	});

	it("signs private assets for cloud renders; public ones need no signature", async () => {
		manifest({
			default: "media",
			remotes: { media, raw: { endpoint: media.endpoint, bucket: "films" } },
		});
		const r2 = fakeR2();
		const keys = {
			...env,
			FRAMEFIELDS_STORAGE_RAW_ACCESS_KEY_ID: "id",
			FRAMEFIELDS_STORAGE_RAW_SECRET_ACCESS_KEY: "secret",
		};
		await addAssets(["assets/footage/intro.mp4"], {
			cwd,
			env: keys,
			fetch: r2.fetch,
		});
		await addAssets(["assets/footage/outro.mov"], {
			cwd,
			env: keys,
			fetch: r2.fetch,
			remote: "raw",
		});
		expect(
			readConfig(cwd).config.assets?.["assets/footage/outro.mov"]?.remote,
		).toBe("raw");
		const signed = await prepareCloudAssets({
			cwd,
			env: keys,
			fetch: r2.fetch,
		});
		expect(Object.keys(signed)).toEqual([sha("outro frames")]);
		expect(signed[sha("outro frames")]).toContain("X-Amz-Signature=");
		// Without keys, a private remote can't be signed.
		await expect(
			prepareCloudAssets({ cwd, env: {}, fetch: r2.fetch }),
		).rejects.toThrow("assets/footage/outro.mov is on raw, which needs keys");
	});
});
