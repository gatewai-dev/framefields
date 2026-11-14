/**
 * A MuJoCo model through the real renderer: its geoms land where MuJoCo
 * puts them, turned the right way (not mirrored), and ground truth names
 * them by geom.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";
import { Physics } from "./physics/index.js";

const FPS = 30;
const W = 400;
const H = 300;
const PPM = 400;
const ORIGIN: [number, number, number] = [200, 200, 0];

const MJCF = `<mujoco>
  <worldbody>
    <geom name="floor" type="plane" size="2 2 0.1" rgba="0.5 0.5 0.5 1"/>
    <body name="box" pos="0.15 0 0.3">
      <freejoint/>
      <geom name="box" type="box" size="0.1 0.1 0.05" rgba="1 0 0 1"/>
    </body>
    <body name="arm" pos="-0.25 0 0.35">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="1"/>
      <geom name="link" type="capsule" fromto="0 0 0 0.3 0 0" size="0.03" rgba="0 0 1 1"/>
    </body>
  </worldbody>
  <actuator><position joint="hinge" kp="20"/></actuator>
</mujoco>`;

describe("MuJoCo render", () => {
	it("draws geoms where MuJoCo puts them, named in ground truth", async () => {
		const world = await Physics.mujoco({
			mjcf: MJCF,
			fps: FPS,
			frames: 60,
			pixelsPerMeter: PPM,
			origin: ORIGIN,
			control: () => [0.8],
		});
		const c = new Composition({
			width: W,
			height: H,
			fps: FPS,
			durationFrames: 60,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 200,
				y: 150,
				z: -900,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			...world.layers().layers,
		]);
		const truth = await c.renderTruth(59);
		const [s] = truth.scenes;
		const f = H / 2 / Math.tan((s.camera.fov * Math.PI) / 360);
		/** The pixel a scene point at depth z = 0 projects to (eye at z = -900). */
		const pixel = (x: number, y: number) =>
			Math.round(150 + ((y - 150) * f) / 900) * W +
			Math.round(200 + ((x - 200) * f) / 900);
		const geomAt = (x: number, y: number) =>
			s.objects.find((o) => o.id === s.object[pixel(x, y)])?.layer;

		// The box, wherever it came to rest (it lands and slides).
		const at = { frame: 59, fps: FPS } as never;
		const box = world.geom("box");
		const boxX = box.x.get(at) as number;
		const boxY = box.y.get(at) as number;
		expect(boxY).toBeCloseTo(200 - 0.05 * PPM, 0);
		expect(geomAt(boxX, boxY)).toBe("mujoco:box");
		// The arm at the hinge angle MuJoCo reached, turning +x toward -z
		// (right-hand rule about +y): down and to the right on screen.
		const hinge = world.qpos(59)[7];
		const mid = [
			200 + (-0.25 + 0.15 * Math.cos(hinge)) * PPM,
			200 - (0.35 - 0.15 * Math.sin(hinge)) * PPM,
		];
		const along = [Math.cos(hinge), Math.sin(hinge)];
		for (const t of [-40, 0, 40]) {
			expect(geomAt(mid[0] + along[0] * t, mid[1] + along[1] * t)).toBe(
				"mujoco:link",
			);
		}
		// Mirrored (turning up instead) its far end would be here: empty.
		const mirroredTip = [
			200 + (-0.25 + 0.25 * Math.cos(hinge)) * PPM,
			200 - (0.35 + 0.25 * Math.sin(hinge)) * PPM,
		];
		expect(geomAt(mirroredTip[0], mirroredTip[1])).toBeUndefined();
		// The picture shows them: red box, blue link.
		const rgb = (x: number, y: number) => {
			const i = pixel(x, y) * 4;
			return [truth.rgba[i], truth.rgba[i + 1], truth.rgba[i + 2]];
		};
		const [br, , bb] = rgb(boxX, boxY);
		expect(br).toBeGreaterThan(bb + 80);
		const [lr, , lb] = rgb(mid[0], mid[1]);
		expect(lb).toBeGreaterThan(lr + 80);
	});
});
