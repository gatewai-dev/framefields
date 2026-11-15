/**
 * The framefields additions to the solver: run-time gravity, mass, gravity
 * scale, linear damping, the planar lock, enabling and collision toggles,
 * snapshots and the contact readback.
 */
import { describe, expect, it } from "vitest";
import { SceneBuilder } from "../src/index.js";
import { boxOnPlane, simOf, zOf } from "./helpers.js";

/** One free box of half size 0.1 m at `z`, no ground. */
function lonelyBox(
	z: number,
	options: Parameters<SceneBuilder["addBody"]>[0] = {},
): { builder: SceneBuilder; box: number } {
	const builder = new SceneBuilder({ fps: 60 });
	const box = builder.addBody({ xform: [0, 0, z, 0, 0, 0, 1], ...options });
	builder.addJointFree(box);
	builder.addShapeBox(box, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
	return { builder, box };
}

describe("run-time changes", () => {
	it("changes gravity from the next step", async () => {
		const { builder, box } = lonelyBox(5);
		const sim = await simOf(builder);
		sim.setGravity([0, 0, 0]);
		sim.step(30);
		expect(zOf((await sim.state()).bodyQ, box)).toBe(5);
		sim.setGravity([0, 0, 9.81]);
		sim.step(30);
		expect(zOf((await sim.state()).bodyQ, box)).toBeGreaterThan(6);
		sim.destroy();
	});

	it("scales gravity per body, from the builder and at run time", async () => {
		const half = lonelyBox(5, { gravityScale: 0.5 });
		const full = lonelyBox(5);
		const [a, b] = [await simOf(half.builder), await simOf(full.builder)];
		a.step(30);
		b.step(30);
		const fallHalf = 5 - zOf((await a.state()).bodyQ, half.box);
		const fallFull = 5 - zOf((await b.state()).bodyQ, full.box);
		expect(fallHalf / fallFull).toBeCloseTo(0.5, 4);
		a.setBodyExtension(half.box, { gravityScale: 0 });
		const z = zOf((await a.state()).bodyQ, half.box);
		const vz = (await a.state()).bodyQd[half.box * 6 + 2];
		a.step(30);
		// Coasting at its velocity: no more gravity.
		expect(zOf((await a.state()).bodyQ, half.box)).toBeCloseTo(z + vz * 0.5, 3);
		a.destroy();
		b.destroy();
	});

	it("damps linear velocity", async () => {
		const { builder, box } = lonelyBox(0, {
			gravity: false,
			linearDamping: 2,
			twist: [1, 0, 0, 0, 0, 0],
		});
		const sim = await simOf(builder);
		sim.step(60);
		const vx = (await sim.state()).bodyQd[box * 6];
		// (1 - 2 dt)^n per substep, about e^-2 over a second.
		expect(vx).toBeGreaterThan(0.1);
		expect(vx).toBeLessThan(0.16);
		sim.destroy();
	});

	it("locks a planar body to its xy plane", async () => {
		const { builder, box } = lonelyBox(1, {
			planar: true,
			twist: [0.5, 0, 3, 2, 2, 1],
		});
		const sim = await simOf(builder);
		sim.step(30);
		const { bodyQ, bodyQd } = await sim.state();
		expect(zOf(bodyQ, box)).toBe(1);
		expect(bodyQ[box * 7]).toBeCloseTo(0.25, 3);
		// Turned about z only.
		expect(bodyQ[box * 7 + 3]).toBe(0);
		expect(bodyQ[box * 7 + 4]).toBe(0);
		expect(Math.abs(bodyQ[box * 7 + 5])).toBeGreaterThan(0.2);
		expect(bodyQd[box * 6 + 2]).toBe(0);
		sim.destroy();
	});

	it("locks rotation about a body's axes", async () => {
		const { builder, box } = lonelyBox(0, { gravity: false });
		const sim = await simOf(builder);
		sim.lockBodyRotation(box, [true, true, false]);
		sim.setBodyWrench(box, [0, 0, 0], [0.01, 0.01, 0.01]);
		sim.step(30);
		const { bodyQ, bodyQd } = await sim.state();
		expect(bodyQd[box * 6 + 3]).toBe(0);
		expect(bodyQd[box * 6 + 4]).toBe(0);
		expect(bodyQd[box * 6 + 5]).toBeGreaterThan(0);
		expect(bodyQ[box * 7 + 3]).toBe(0);
		sim.destroy();
	});

	it("damps angular velocity as the builder says", async () => {
		const spin = async (angularDamping: number) => {
			const { builder, box } = lonelyBox(0, {
				gravity: false,
				angularDamping,
				twist: [0, 0, 0, 0, 0, 4],
			});
			const sim = await simOf(builder);
			sim.step(60);
			const w = (await sim.state()).bodyQd[box * 6 + 5];
			sim.destroy();
			return w;
		};
		expect(await spin(0)).toBeCloseTo(4, 4);
		expect(await spin(1)).toBeLessThan(1.6);
	});

	it("changes a body's mass", async () => {
		const { builder, box } = lonelyBox(0, { gravity: false });
		const sim = await simOf(builder);
		const m = sim.bodyMass(box);
		sim.setBodyMass(box, 2 * m);
		expect(sim.bodyMass(box)).toBe(2 * m);
		sim.setBodyWrench(box, [m, 0, 0], [0, 0, 0]);
		sim.step(60);
		// F = m over one second on twice the mass: half a meter per second.
		expect((await sim.state()).bodyQd[box * 6]).toBeCloseTo(0.5, 3);
		sim.destroy();
	});

	it("takes a body out of the world and puts it back", async () => {
		const { builder, box } = lonelyBox(5);
		const sim = await simOf(builder);
		sim.setBodyEnabled(box, false);
		sim.step(30);
		expect(zOf((await sim.state()).bodyQ, box)).toBe(5);
		sim.setBodyEnabled(box, true);
		sim.step(30);
		expect(zOf((await sim.state()).bodyQ, box)).toBeLessThan(4);
		sim.destroy();
	});

	it("turns a body's collisions off and on", async () => {
		const a = boxOnPlane(0.5);
		const through = await simOf(a.builder);
		through.setBodyCollisions(a.box, false);
		through.step(60);
		expect(zOf((await through.state()).bodyQ, a.box)).toBeLessThan(-1);
		through.destroy();
		const b = boxOnPlane(0.5);
		const held = await simOf(b.builder);
		held.setBodyCollisions(b.box, false);
		held.setBodyCollisions(b.box, true);
		held.step(60);
		expect(zOf((await held.state()).bodyQ, b.box)).toBeCloseTo(0.1, 2);
		held.destroy();
	});
});

describe("snapshots", () => {
	it("continues bit for bit from a snapshot, in the same Sim and a new one", async () => {
		const scene = () => {
			const builder = new SceneBuilder({ fps: 60 });
			builder.addGroundPlane();
			for (let i = 0; i < 4; i++) {
				const b = builder.addBody({
					xform: [i * 0.05, 0, 0.3 + i * 0.25, 0, 0, 0.2 * i, 1],
				});
				builder.addJointFree(b);
				builder.addShapeBox(b, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
			}
			return builder;
		};
		const sim = await simOf(scene());
		sim.step(40);
		sim.setGravity([0, 0, -5]);
		const snap = await sim.snapshot();
		sim.step(40);
		const first = await sim.state();
		sim.restore(snap);
		sim.step(40);
		const again = await sim.state();
		expect(Buffer.from(again.bodyQ.buffer)).toEqual(
			Buffer.from(first.bodyQ.buffer),
		);
		const other = await simOf(scene());
		other.restore(snap);
		other.step(40);
		const elsewhere = await other.state();
		expect(Buffer.from(elsewhere.bodyQ.buffer)).toEqual(
			Buffer.from(first.bodyQ.buffer),
		);
		expect(Buffer.from(elsewhere.bodyQd.buffer)).toEqual(
			Buffer.from(first.bodyQd.buffer),
		);
		sim.destroy();
		other.destroy();
	});

	it("refuses a snapshot of another scene", async () => {
		const a = await simOf(boxOnPlane(1).builder);
		const b = await simOf(lonelyBox(1).builder);
		expect(() => b.restore(new Uint8Array(0))).toThrow();
		expect(() => b.restore(new Uint8Array(0))).toThrow();
		const snap = await a.snapshot();
		expect(() => b.restore(snap)).toThrow("another scene");
		a.destroy();
		b.destroy();
	});
});

describe("contacts", () => {
	it("reads the contacts of a box resting on the ground", async () => {
		const { builder, box } = boxOnPlane(0.2);
		const sim = await simOf(builder);
		expect(await sim.contacts()).toEqual([]);
		sim.step(90);
		const contacts = await sim.contacts();
		expect(contacts.length).toBeGreaterThanOrEqual(4);
		for (const c of contacts) {
			expect([c.a, c.b]).toEqual([-1, box]);
			expect(Math.abs(c.phi)).toBeLessThan(1e-3);
			expect(c.point[2]).toBeCloseTo(0, 2);
			// From a (the ground) toward b.
			expect(c.normal[2]).toBeCloseTo(1, 4);
		}
		sim.destroy();
	});
});
