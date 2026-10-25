import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { add } from "./add.js";
import { CONFIG_FILE, readConfig } from "./config.js";
import {
	type Fetch,
	FONTS,
	FONTS_MODULE_MARKER,
	type FontSpec,
	installFont,
	lfsHint,
	writeFontsModule,
} from "./fonts.js";
import { openRegistry, type RegistryItem } from "./registry.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const FONT = bytes("fake emoji font");
const LICENSE = bytes("SIL Open Font License 1.1");
const pin = (url: string, b: Uint8Array) => ({
	url,
	sha256: hash(b),
	bytes: b.length,
});
const CATALOG: Record<string, FontSpec> = {
	emoji: {
		label: "test emoji",
		file: "Emoji.ttf",
		font: pin("https://fonts.test/Emoji.ttf", FONT),
		license: {
			...pin("https://fonts.test/LICENSE", LICENSE),
			id: "OFL-1.1",
			file: "Emoji-OFL.txt",
		},
		register: { emoji: true },
	},
};

/** A fetch serving `files`, counting requests. */
function server(files: Record<string, Uint8Array>) {
	const calls: string[] = [];
	const get: Fetch = async (url) => {
		calls.push(url);
		const body = files[url];
		return {
			ok: body !== undefined,
			status: body ? 200 : 404,
			statusText: body ? "OK" : "Not Found",
			arrayBuffer: async () =>
				(body ?? new Uint8Array()).slice().buffer as ArrayBuffer,
		};
	};
	return { get, calls };
}
const good = () =>
	server({
		"https://fonts.test/Emoji.ttf": FONT,
		"https://fonts.test/LICENSE": LICENSE,
	});

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "framefields-fonts-test-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("installFont", () => {
	it("downloads, verifies and records the pinned font with its license", async () => {
		const { get } = good();
		const done = await installFont("emoji", {
			cwd,
			fetch: get,
			catalog: CATALOG,
		});
		expect(done).toEqual({
			role: "emoji",
			path: "assets/fonts/Emoji.ttf",
			status: "installed",
		});
		expect(readFileSync(join(cwd, "assets/fonts/Emoji.ttf"))).toEqual(
			Buffer.from(FONT),
		);
		expect(readFileSync(join(cwd, "assets/fonts/Emoji-OFL.txt"), "utf8")).toBe(
			"SIL Open Font License 1.1",
		);
		expect(readConfig(cwd).config.fonts).toEqual({
			emoji: "assets/fonts/Emoji.ttf",
		});
	});

	it("doesn't download again when the font is there or configured", async () => {
		const first = good();
		await installFont("emoji", { cwd, fetch: first.get, catalog: CATALOG });
		const again = good();
		expect(
			(await installFont("emoji", { cwd, fetch: again.get, catalog: CATALOG }))
				.status,
		).toBe("configured");
		expect(again.calls).toEqual([]);
		// The pinned file without a config entry: recorded, not fetched.
		rmSync(join(cwd, CONFIG_FILE));
		const third = good();
		expect(
			(await installFont("emoji", { cwd, fetch: third.get, catalog: CATALOG }))
				.status,
		).toBe("present");
		expect(third.calls).toEqual([]);
	});

	it("keeps the user's own font named in framefields.json", async () => {
		mkdirSync(join(cwd, "fonts"));
		writeFileSync(join(cwd, "fonts/Mine.ttf"), "mine");
		writeFileSync(
			join(cwd, CONFIG_FILE),
			JSON.stringify({
				components: "components",
				fonts: { emoji: "fonts/Mine.ttf" },
			}),
		);
		const { get, calls } = good();
		expect(
			await installFont("emoji", { cwd, fetch: get, catalog: CATALOG }),
		).toMatchObject({ status: "configured", path: "fonts/Mine.ttf" });
		expect(calls).toEqual([]);
	});

	it("writes nothing when a download doesn't match its pin", async () => {
		const { get } = server({
			"https://fonts.test/Emoji.ttf": bytes("tampered"),
			"https://fonts.test/LICENSE": LICENSE,
		});
		await expect(
			installFont("emoji", { cwd, fetch: get, catalog: CATALOG }),
		).rejects.toThrow(/isn't the pinned file .*Nothing was written/);
		expect(existsSync(join(cwd, "assets"))).toBe(false);
		expect(existsSync(join(cwd, CONFIG_FILE))).toBe(false);
	});

	it("won't replace a different file at the target without overwrite", async () => {
		mkdirSync(join(cwd, "assets/fonts"), { recursive: true });
		writeFileSync(join(cwd, "assets/fonts/Emoji.ttf"), "other");
		const { get } = good();
		await expect(
			installFont("emoji", { cwd, fetch: get, catalog: CATALOG }),
		).rejects.toThrow(/--overwrite/);
		await installFont("emoji", {
			cwd,
			fetch: get,
			catalog: CATALOG,
			overwrite: true,
		});
		expect(readFileSync(join(cwd, "assets/fonts/Emoji.ttf"))).toEqual(
			Buffer.from(FONT),
		);
	});

	it("names the fonts it knows when asked for another", async () => {
		await expect(installFont("klingon", { cwd })).rejects.toThrow(
			/Fonts framefields can install: emoji/,
		);
	});
});

describe("fonts.ts", () => {
	it("registers every installed font relative to itself", async () => {
		await installFont("emoji", { cwd, fetch: good().get, catalog: CATALOG });
		const m = writeFontsModule(cwd, join(cwd, "src/components"), CATALOG);
		expect(m).toMatchObject({
			path: "src/components/fonts.ts",
			status: "written",
		});
		const text = readFileSync(join(cwd, "src/components/fonts.ts"), "utf8");
		expect(text.startsWith(FONTS_MODULE_MARKER)).toBe(true);
		expect(text).toContain(
			'\tawait FontManager.registerEmojiFont(\n\t\tasset("../../assets/fonts/Emoji.ttf"),\n\t);',
		);
		expect(
			writeFontsModule(cwd, join(cwd, "src/components"), CATALOG).status,
		).toBe("unchanged");
	});

	it("leaves a fonts.ts it didn't generate alone", () => {
		mkdirSync(join(cwd, "components"));
		writeFileSync(join(cwd, "components/fonts.ts"), "// mine\n");
		expect(writeFontsModule(cwd, join(cwd, "components"), CATALOG).status).toBe(
			"skipped",
		);
		expect(readFileSync(join(cwd, "components/fonts.ts"), "utf8")).toBe(
			"// mine\n",
		);
	});
});

describe("framefields add with fonts", () => {
	const item = (name: string, fonts?: RegistryItem["fonts"]): RegistryItem => ({
		name,
		title: name,
		summary: "",
		tags: [],
		example: "",
		parts: [],
		cues: [],
		registryDependencies: [],
		...(fonts && { fonts }),
		files: [{ path: `${name}/index.ts`, content: `${name}\n` }],
	});
	function registry() {
		const dir = join(cwd, ".registry");
		mkdirSync(dir);
		const items = [
			item("chat-thread", [{ font: "emoji", why: "Reactions are emoji." }]),
			item("captions", [{ font: "emoji", why: "Captions carry emoji." }]),
			item("counter"),
		];
		writeFileSync(join(dir, "index.json"), JSON.stringify(items));
		for (const i of items)
			writeFileSync(join(dir, `${i.name}.json`), JSON.stringify(i));
		return openRegistry(dir);
	}

	it("installs a requested font once and writes fonts.ts", async () => {
		const { get, calls } = good();
		const report = await add(["chat-thread", "captions"], {
			cwd,
			registry: registry(),
			fetch: get,
			fontCatalog: CATALOG,
		});
		expect(report.fonts).toEqual([
			{
				role: "emoji",
				path: "assets/fonts/Emoji.ttf",
				status: "installed",
				why: "Reactions are emoji.",
				by: "chat-thread",
			},
		]);
		expect(calls).toHaveLength(2); // font + license, once
		expect(report.fontsModule?.path).toBe("components/fonts.ts");
		expect(readConfig(cwd).config).toEqual({
			components: "components",
			fonts: { emoji: "assets/fonts/Emoji.ttf" },
		});
	});

	it("skips fonts with fonts: false, and needs none for plain components", async () => {
		const reg = registry();
		const plain = await add(["counter"], { cwd, registry: reg });
		expect(plain.fonts).toEqual([]);
		expect(plain.fontsModule).toBeUndefined();
		const skipped = await add(["chat-thread"], {
			cwd,
			registry: reg,
			fonts: false,
		});
		expect(skipped.fontsSkipped).toEqual([
			{ role: "emoji", why: "Reactions are emoji.", by: "chat-thread" },
		]);
		expect(existsSync(join(cwd, "assets"))).toBe(false);
	});
});

describe("the pinned catalog", () => {
	it("pins Noto Color Emoji by size and SHA-256, with its OFL license", () => {
		const e = FONTS.emoji as FontSpec;
		expect(e.font.url).toMatch(
			/noto-emoji\/v2\.051\/fonts\/NotoColorEmoji\.ttf$/,
		);
		expect(e.font.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(e.license.id).toBe("OFL-1.1");
	});

	it("matches the emoji font the repo renders with", () => {
		const local = readFileSync(
			new URL(
				"../../../renderer/src/assets/NotoColorEmoji.ttf",
				import.meta.url,
			),
		);
		expect(local.length).toBe(FONTS.emoji?.font.bytes);
		expect(hash(local)).toBe(FONTS.emoji?.font.sha256);
	});
});

describe("the themes' fonts", () => {
	it.each([
		["sans", "Inter", "Inter.ttf"],
		["mono", "JetBrains Mono", "JetBrainsMono.ttf"],
	])("%s is the repo's own %s, registered under that family", (role, family, file) => {
		const spec = FONTS[role] as FontSpec;
		expect(spec.register).toEqual({ family });
		expect(spec.license.id).toBe("OFL-1.1");
		const local = readFileSync(
			new URL(`../../../../assets/fonts/${file}`, import.meta.url),
		);
		expect(local.length).toBe(spec.font.bytes);
		expect(hash(local)).toBe(spec.font.sha256);
	});
});

describe("lfsHint", () => {
	it("suggests LFS in a Git repo that doesn't track fonts", () => {
		expect(lfsHint(cwd, "assets/fonts/Emoji.ttf")).toBeNull();
		mkdirSync(join(cwd, ".git"));
		expect(lfsHint(cwd, "assets/fonts/Emoji.ttf")).toMatch(
			/git lfs track "assets\/fonts\/\*\*\/\*\.ttf"/,
		);
		writeFileSync(
			join(cwd, ".gitattributes"),
			"assets/fonts/**/*.ttf filter=lfs diff=lfs merge=lfs -text\n",
		);
		expect(lfsHint(cwd, "assets/fonts/Emoji.ttf")).toBeNull();
	});
});
