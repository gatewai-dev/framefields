import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decodeKtx2, isKtx2 } from "./ktx2.js";

describe("KTX2 Basis transcoding", () => {
	it.each([
		"etc1s",
		"uastc-ldr",
	])("decodes %s and all mip levels offline", async (format) => {
		const bytes = await readFile(
			new URL(`./fixtures/${format}.ktx2`, import.meta.url),
		);
		expect(isKtx2(bytes)).toBe(true);
		const image = await decodeKtx2(bytes);
		expect([image.width, image.height]).toEqual([16, 16]);
		expect(image.levels.map((level) => level.length)).toEqual([
			1024, 256, 64, 16, 4,
		]);
		expect(image.levels[0]?.[0]).toBeGreaterThan(180);
		expect(image.levels[0]?.[1]).toBeLessThan(60);
	});
	it("preserves ETC1S alpha", async () => {
		const bytes = await readFile(
			new URL("./fixtures/etc1s-alpha.ktx2", import.meta.url),
		);
		const image = await decodeKtx2(bytes);
		expect(image.levels[0]?.[3]).toBeGreaterThan(115);
		expect(image.levels[0]?.[3]).toBeLessThan(140);
	});
});
