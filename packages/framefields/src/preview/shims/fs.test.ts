import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, promises, readFileSync, statSync } from "./fs.js";

afterEach(() => vi.unstubAllGlobals());

describe("static preview filesystem", () => {
	it("looks up absolute, file URL and relative paths without contacting a server", () => {
		vi.stubGlobal("window", {
			__framefieldsStaticFiles: { "/films/assets/a #?%.json": 7 },
		});
		vi.stubGlobal("document", { baseURI: "https://example.test/films/" });
		for (const file of [
			"/films/assets/a #?%.json",
			new URL("file:///films/assets/a%20%23%3F%25.json"),
			"assets/a #?%.json",
		]) {
			expect(existsSync(file)).toBe(true);
			expect(statSync(file).size).toBe(7);
		}
		expect(existsSync("missing.json")).toBe(false);
		expect(() => statSync("missing.json")).toThrow(/ENOENT/);
	});

	it("preserves reserved filename characters in synchronous and async reads", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"XMLHttpRequest",
			class {
				status = 200;
				responseText = "data";
				open(_method: string, url: string) {
					urls.push(url);
				}
				overrideMimeType() {}
				send() {}
			},
		);
		vi.stubGlobal("fetch", async (url: string) => {
			urls.push(url);
			return new Response("data");
		});
		const file = new URL("file:///films/assets/a%20%23%3F%25.json");
		expect(readFileSync(file, "utf8")).toBe("data");
		expect(await promises.readFile(file, "utf8")).toBe("data");
		expect(urls).toEqual([
			"/films/assets/a%20%23%3F%25.json",
			"/films/assets/a%20%23%3F%25.json",
		]);
	});
});
