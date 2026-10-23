import { describe, expect, it } from "vitest";
import { hashRng, hashString, rng } from "./rng.js";

describe("rng", () => {
	it("is deterministic per seed", () => {
		const a = rng(42);
		const b = rng(42);
		const seqA = Array.from({ length: 5 }, () => a.next());
		const seqB = Array.from({ length: 5 }, () => b.next());
		expect(seqA).toEqual(seqB);
		expect(rng(43).next()).not.toBe(seqA[0]);
	});

	it("stays in range and is roughly uniform", () => {
		const r = rng(7);
		const buckets = new Array(10).fill(0);
		for (let i = 0; i < 10000; i++) {
			const v = r.next();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
			buckets[Math.floor(v * 10)]++;
		}
		for (const b of buckets) expect(b).toBeGreaterThan(850);
		const ints = new Set(Array.from({ length: 200 }, () => r.int(1, 3)));
		expect([...ints].sort()).toEqual([1, 2, 3]);
	});

	it("keys streams independently", () => {
		expect(hashRng(1, "word-3").next()).toBe(hashRng(1, "word-3").next());
		expect(hashRng(1, "word-3").next()).not.toBe(hashRng(1, "word-4").next());
		expect(hashRng(1, "a").next()).not.toBe(hashRng(2, "a").next());
		expect(hashString("abc")).toBe(hashString("abc"));
	});
});
