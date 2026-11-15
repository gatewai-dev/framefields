/**
 * Recorded poses: trajectories from another simulator, in its axes, land in
 * scene pixels by a proper rotation.
 */
import { describe, expect, it } from "vitest";
import { Physics } from "./index.js";

const FPS = 30;
const at = (s: { get(ctx?: never): number }, frame: number) =>
	s.get({ frame, fps: FPS } as never);

describe("Physics.poses", () => {
	it("maps z-up and y-up meters into scene pixels", () => {
		const point = { position: [[1, 2, 3]] };
		const zUp = Physics.poses({ fps: FPS, bodies: { p: point } }).body("p");
		expect([at(zUp.x, 0), at(zUp.y, 0), at(zUp.z, 0)]).toEqual([
			100, -300, 200,
		]);
		const yUp = Physics.poses({
			fps: FPS,
			axes: "y-up",
			pixelsPerMeter: 10,
			origin: [5, 5, 5],
			bodies: { p: point },
		}).body("p");
		expect([at(yUp.x, 0), at(yUp.y, 0), at(yUp.z, 0)]).toEqual([15, -15, -25]);
	});

	it("turns orientations with the axes, in either quaternion order", () => {
		const s = Math.SQRT1_2;
		// A quarter turn about z-up's up axis is a quarter turn about the
		// scene's -y (its up).
		const xyzw = Physics.poses({
			fps: FPS,
			bodies: { b: { position: [0, 0, 0], rotation: [0, 0, s, s] } },
		}).body("b");
		expect(at(xyzw.rotateX, 0)).toBeCloseTo(0, 5);
		expect(at(xyzw.rotateY, 0)).toBeCloseTo(-90, 4);
		expect(at(xyzw.rotateZ, 0)).toBeCloseTo(0, 5);
		const wxyz = Physics.poses({
			fps: FPS,
			quaternion: "wxyz",
			bodies: { b: { position: [[0, 0, 0]], rotation: [[s, 0, 0, s]] } },
		}).body("b");
		expect(at(wxyz.rotateY, 0)).toBeCloseTo(-90, 4);
	});

	it("keeps rotations continuous and holds the first pose before it starts", () => {
		const frames = 40;
		const rotation = Array.from({ length: frames }, (_, f) => {
			// Spinning about z-up's up axis past ±180°.
			const a = (f / frames) * 3 * Math.PI;
			return [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
		});
		const track = Physics.poses({
			fps: FPS,
			startFrame: 10,
			bodies: {
				spin: {
					position: Array.from({ length: frames }, (_, f) => [f, 0, 0]),
					rotation,
				},
			},
		});
		const spin = track.body("spin");
		expect(track.frames).toBe(frames);
		expect(at(spin.x, 0)).toBe(0);
		expect(at(spin.x, 15)).toBe(500);
		for (let f = 11; f < 10 + frames; f++) {
			const step = at(spin.rotateY, f) - at(spin.rotateY, f - 1);
			expect(Math.abs(step)).toBeLessThan(15);
		}
		expect(at(spin.rotateY, 9 + frames)).toBeLessThan(-500);
	});

	it("says what is wrong with a trajectory", () => {
		expect(() =>
			Physics.poses({ fps: FPS, bodies: { a: { position: [1, 2] } } }),
		).toThrow("not a multiple of 3");
		expect(() =>
			Physics.poses({
				fps: FPS,
				bodies: {
					a: { position: [[0, 0, 0]] },
					b: {
						position: [
							[0, 0, 0],
							[1, 1, 1],
						],
					},
				},
			}),
		).toThrow('"b" has 2 positions');
		const track = Physics.poses({
			fps: FPS,
			bodies: { a: { position: [0, 0, 0] } },
		});
		expect(() => track.body("c")).toThrow('no body "c" (bodies: a)');
	});
});
