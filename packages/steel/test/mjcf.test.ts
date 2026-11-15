// @vitest-environment jsdom
/**
 * The MJCF loader: mesh hull caps (`maxhullvert` on a mesh asset or its
 * default class, as in MuJoCo; -1 for every vertex, unset for the builder's
 * cap, as Newton's import does) and actuator force limits.
 */
import { describe, expect, it } from "vitest";
import { loadMJCF, MAX_HULL_VERTICES, SceneBuilder } from "../src/index.js";

/** The scene's per-dof drive settings. */
type Dofs = { effort: number[]; ke: number[]; kd: number[] };

/** A ball mesh of n vertices, as a loader returns one. */
function ballMesh(n: number) {
	const vertices = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const z = 1 - (2 * (i + 0.5)) / n;
		const q = Math.sqrt(1 - z * z);
		const a = i * Math.PI * (3 - Math.sqrt(5));
		vertices.set(
			[0.05 * q * Math.cos(a), 0.05 * q * Math.sin(a), 0.05 * z],
			i * 3,
		);
	}
	return { vertices, indices: new Uint32Array(0) };
}

describe("MJCF maxhullvert", () => {
	it("caps each mesh's hull as its asset says", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		await loadMJCF(
			builder,
			`<mujoco>
			  <default><default class="coarse"><mesh maxhullvert="12"/></default></default>
			  <asset>
			    <mesh name="plain" file="a.stl"/>
			    <mesh name="full" file="b.stl" maxhullvert="-1"/>
			    <mesh name="few" file="c.stl" maxhullvert="20"/>
			    <mesh name="coarse" class="coarse" file="d.stl"/>
			  </asset>
			  <worldbody>
			    <body name="a"><freejoint/><geom type="mesh" mesh="plain"/></body>
			    <body name="b"><freejoint/><geom type="mesh" mesh="full"/></body>
			    <body name="c"><freejoint/><geom type="mesh" mesh="few"/></body>
			    <body name="d"><freejoint/><geom type="mesh" mesh="coarse"/></body>
			  </worldbody>
			</mujoco>`,
			{ baseUrl: "file:///models/", loadMesh: async () => ballMesh(500) },
		);
		const shapes = builder.finalize().json.shapes;
		expect(shapes.map((s) => s.hull?.nv)).toEqual([
			MAX_HULL_VERTICES,
			500,
			20,
			12,
		]);
	});

	it("caps a position actuator's drive at its forcerange, as MuJoCo clamps its force", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		await loadMJCF(
			builder,
			`<mujoco>
			  <default><default class="servo"><position kp="900" kv="3" forcerange="-2 2"/></default></default>
			  <worldbody>
			    <body name="a"><joint name="ja" type="hinge"/><geom type="sphere" size="0.05"/>
			      <body name="b" pos="0.2 0 0"><joint name="jb" type="hinge"/><geom type="sphere" size="0.05"/>
			        <body name="c" pos="0.2 0 0"><joint name="jc" type="hinge"/><geom type="sphere" size="0.05"/>
			          <body name="d" pos="0.2 0 0"><joint name="jd" type="hinge"/><geom type="sphere" size="0.05"/></body>
			        </body>
			      </body>
			    </body>
			  </worldbody>
			  <actuator>
			    <position class="servo" joint="ja"/>
			    <position class="servo" joint="jb" forcerange="-3.5 1"/>
			    <position class="servo" joint="jc" forcerange="-3 3" forcelimited="false"/>
			    <position joint="jd" kp="50"/>
			  </actuator>
			</mujoco>`,
		);
		const dofs = builder.finalize().json as unknown as { joints: Dofs };
		expect(dofs.joints.ke).toEqual([900, 900, 900, 50]);
		// The class's range, the actuator's own (its larger side), none when not limited, none when not given.
		expect(dofs.joints.effort).toEqual([2, 3.5, 1e6, 1e6]);
	});
});
