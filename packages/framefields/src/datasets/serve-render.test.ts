/**
 * The env server: JSON lines in and out, observations in the mapped file at
 * the offsets `make` gave, several envs per handle, errors as answers.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, type LayoutNode } from "../index.js";
import { Physics } from "../physics/index.js";
import { EnvSession, type InteractiveEnv } from "./interactive.js";
import { serveEnvs } from "./serve.js";

const push: InteractiveEnv<{ x: number }, number[]> = {
	name: "push",
	description: "Push a ball along x.",
	fps: 24,
	frames: 8,
	width: 32,
	height: 24,
	actionSpace: { type: "box", shape: [1], low: -1, high: 1 },
	params: (seed) => ({ x: seed * 10 }),
	async start(params, host) {
		const c = new Composition({
			width: 32,
			height: 24,
			fps: 24,
			durationFrames: 8,
		});
		const ball = Layer3D.sphere({
			id: "ball",
			radius: 20,
			x: params.x,
			y: 180,
			color: "#ff0000",
		});
		c.add([
			Layer.camera({
				x: 0,
				y: 100,
				z: -600,
				targetX: 0,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			ball as LayoutNode,
		]);
		const world = await Physics.world3d({ fps: 24, frames: 8 });
		world.ground({ y: 200 });
		const body = world.body(ball as LayoutNode);
		world.live(host);
		return {
			views: [{ name: "front", composition: c }],
			act: (frame, [a]) => world.impulse(body, frame, [a * 200, 0, 0]),
			reward: (frame) => body.x.get({ frame, fps: 24 } as never) as number,
		};
	},
};

const dir = mkdtempSync(path.join(tmpdir(), "ff-serve-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A server on in-memory streams, and a call function. */
function server() {
	const input = new PassThrough();
	const output = new PassThrough();
	const done = serveEnvs(
		{ push: push as InteractiveEnv<unknown, unknown> },
		{ input, output },
	);
	const pending = new Map<number, (v: Record<string, unknown>) => void>();
	let buffer = "";
	output.on("data", (chunk) => {
		buffer += String(chunk);
		let nl = buffer.indexOf("\n");
		while (nl >= 0) {
			const msg = JSON.parse(buffer.slice(0, nl)) as { id: number };
			pending.get(msg.id)?.(msg as never);
			buffer = buffer.slice(nl + 1);
			nl = buffer.indexOf("\n");
		}
	});
	let id = 0;
	const call = (method: string, params: unknown = {}) =>
		new Promise<Record<string, any>>((resolve) => {
			pending.set(++id, resolve);
			input.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	return { call, end: () => input.end(), done };
}

describe("serveEnvs", () => {
	it("steps a batch of envs and writes each observation into its slot", async () => {
		const { call, end, done } = server();
		const listed = await call("list");
		expect(listed.result.envs[0]).toMatchObject({
			name: "push",
			frameSkip: 1,
			views: [{ name: "front", width: 32, height: 24 }],
		});
		const shm = path.join(dir, "obs.bin");
		const made = await call("make", {
			env: "push",
			count: 2,
			shm,
			truth: true,
		});
		const { handle, layout } = made.result;
		expect(layout.views[0]).toEqual({
			name: "front",
			width: 32,
			height: 24,
			rgba: 0,
			depth: 3072,
			object: 6144,
		});
		expect(layout.slotBytes).toBe(9216);

		const reset = await call("reset", { handle, seeds: [0, 3] });
		expect(reset.result.frames).toEqual([0, 0]);
		expect(reset.result.infos[1]).toMatchObject({ seed: 3, params: { x: 30 } });
		const stepped = await call("step", { handle, actions: [[1], [-1]] });
		expect(stepped.result.frames).toEqual([1, 1]);
		expect(stepped.result.rewards[0]).toBeGreaterThan(0);
		expect(stepped.result.rewards[1]).toBeLessThan(30);

		// The file holds what a session renders for the same seed and action.
		const file = readFileSync(shm);
		const ref = new EnvSession(push, { truth: true });
		await ref.reset(3);
		const obs = (await ref.step([-1])).observation.views[0];
		const slot = file.subarray(9216, 9216 * 2);
		expect(Buffer.compare(slot.subarray(0, 3072), Buffer.from(obs.rgba))).toBe(
			0,
		);
		expect(
			new Float32Array(
				slot.buffer.slice(slot.byteOffset + 3072, slot.byteOffset + 6144),
			),
		).toEqual(obs.depth);

		// Only some envs reset (the vector client's autoreset).
		expect(
			(await call("reset", { handle, seeds: [5], indices: [1] })).result.frames,
		).toEqual([0]);
		expect(
			(await call("step", { handle, actions: [[1]] })).error.message,
		).toContain("one per env (2)");
		expect((await call("nope")).error.message).toContain('no method "nope"');
		expect((await call("make", { env: "x", shm })).error.message).toContain(
			'no env "x"',
		);
		expect((await call("close", { handle })).result).toEqual({});
		end();
		await done;
	});
});
