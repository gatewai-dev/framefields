import { describe, expect, it } from "vitest";
import {
	aberrate,
	DOPPLER_LUT_SIZE,
	dopplerColorMatrix,
	dopplerLut,
	lorentzFactor,
} from "./relativistic-doppler.js";

const apply = (m: number[][], c: number[]) =>
	m.map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2]);

describe("relativistic observer", () => {
	it("aberrates rays towards the direction of motion", () => {
		// A ray seen at cos θ' = β left the scene at 90°.
		expect(aberrate(0.8, 0.8).sourceCos).toBeCloseTo(0, 10);
		// Straight ahead and behind are fixed points.
		expect(aberrate(1, 0.9).sourceCos).toBeCloseTo(1, 10);
		expect(aberrate(-1, 0.9).sourceCos).toBeCloseTo(-1, 10);
		// D ahead is √((1 + β) / (1 − β)).
		expect(aberrate(1, 0.8).doppler).toBeCloseTo(3, 10);
		expect(aberrate(-1, 0.8).doppler).toBeCloseTo(1 / 3, 10);
		expect(lorentzFactor(0.99)).toBeCloseTo(7.0888, 3);
	});

	it("leaves colour untouched at rest", () => {
		for (const beaming of [true, false]) {
			const m = dopplerColorMatrix(1, beaming);
			for (let r = 0; r < 3; r++) {
				for (let c = 0; c < 3; c++) {
					expect(m[r][c]).toBeCloseTo(r === c ? 1 : 0, 6);
				}
			}
		}
	});

	it("shifts ahead to blue and brighter, behind to red and darker", () => {
		const grey = [0.5, 0.5, 0.5];
		const ahead = apply(dopplerColorMatrix(1.3), grey);
		expect(ahead[2]).toBeGreaterThan(ahead[0]);
		expect(ahead[0] + ahead[1] + ahead[2]).toBeGreaterThan(1.5);
		const behind = apply(dopplerColorMatrix(1 / 1.3), grey);
		expect(behind[0]).toBeGreaterThan(behind[2]);
		expect(behind[0] + behind[1] + behind[2]).toBeLessThan(1.5);
		// Without beaming only the hue moves; brightness stays near rest.
		const shiftOnly = apply(dopplerColorMatrix(1.3, false), grey);
		expect(shiftOnly[0] + shiftOnly[1] + shiftOnly[2]).toBeLessThan(
			ahead[0] + ahead[1] + ahead[2],
		);
	});

	it("tabulates the matrix in ln D, identity in the middle", () => {
		const lut = dopplerLut(true);
		expect(lut).toHaveLength(DOPPLER_LUT_SIZE * 12);
		expect(lut.every(Number.isFinite)).toBe(true);
		// An even table has no entry at exactly D = 1; its two middle entries
		// straddle it, so their average is nearly identity.
		const mid = DOPPLER_LUT_SIZE / 2;
		const diag = (n: number, r: number) => lut[n * 12 + r * 5];
		for (let r = 0; r < 3; r++) {
			expect((diag(mid - 1, r) + diag(mid, r)) / 2).toBeCloseTo(1, 1);
		}
	});
});
