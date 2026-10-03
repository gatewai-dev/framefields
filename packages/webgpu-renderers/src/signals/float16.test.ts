import { describe, expect, it } from "vitest";
import { encodeFloat32ToFloat16, float32ToFloat16Bits } from "./float16.js";

describe("float16 encoder", () => {
	it("converts special values correctly", () => {
		// 0.0 -> 0x0000
		expect(float32ToFloat16Bits(0.0)).toBe(0x0000);
		// 1.0 -> 0x3c00
		expect(float32ToFloat16Bits(1.0)).toBe(0x3c00);
		// -1.0 -> 0xbc00
		expect(float32ToFloat16Bits(-1.0)).toBe(0xbc00);
		// 0.5 -> 0x3800
		expect(float32ToFloat16Bits(0.5)).toBe(0x3800);
		// 2.0 -> 0x4000
		expect(float32ToFloat16Bits(2.0)).toBe(0x4000);
	});

	it("encodes array of floats matching Float16Array if available", () => {
		const testData = [0.0, 1.0, -1.0, 0.5, 0.25, 65500, 0.123];
		const encoded = encodeFloat32ToFloat16(testData);
		expect(encoded.length).toBe(testData.length);

		if (typeof Float16Array !== "undefined") {
			const native = new Uint16Array(new Float16Array(testData).buffer);
			for (let i = 0; i < testData.length; i++) {
				expect(encoded[i]).toBe(native[i]);
			}
		}
	});
});
