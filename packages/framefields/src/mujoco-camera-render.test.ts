/**
 * MuJoCo cameras and tendons through the real renderer: a model's
 * `<camera>`s see what MuJoCo's would (right, up and roll as their axes
 * say, straight down too, riding a moving body), and a tendon draws along
 * its path.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, type LayoutNode, truthLabels } from "./index.js";
import { Physics } from "./physics/index.js";

const W = 160;
const H = 120;

// Red at +x, blue at +z, green at +y, around the origin; a tendon between
// two fixed sites above them; a body sliding along x carrying a camera.
const MJCF = `<mujoco>
  <option gravity="0 0 0"/>
  <worldbody>
    <geom name="red" type="sphere" size="0.04" pos="0.25 0 0" rgba="1 0 0 1"/>
    <geom name="blue" type="sphere" size="0.04" pos="0 0 0.25" rgba="0 0 1 1"/>
    <geom name="green" type="sphere" size="0.04" pos="0 0.25 0" rgba="0 1 0 1"/>
    <site name="a" pos="-0.3 0 -0.25"/>
    <site name="b" pos="0.3 0 -0.25"/>
    <camera name="front" pos="0 -1.2 0" xyaxes="1 0 0 0 0 1" fovy="45"/>
    <camera name="rolled" pos="0 -1.2 0" xyaxes="0 0 1 -1 0 0" fovy="45"/>
    <camera name="top" pos="0 0 1.2" xyaxes="1 0 0 0 1 0" fovy="45"/>
    <body name="cart" pos="-0.5 -1.2 0">
      <joint name="slide" type="slide" axis="1 0 0"/>
      <geom name="cart" type="box" size="0.01 0.01 0.01" mass="1" contype="0" conaffinity="0"/>
      <camera name="wrist" pos="0 0 0" xyaxes="1 0 0 0 0 1" fovy="45"/>
    </body>
  </worldbody>
  <tendon>
    <spatial name="cable" width="0.01" rgba="1 1 0 1">
      <site site="a"/>
      <site site="b"/>
    </spatial>
  </tendon>
  <actuator><motor joint="slide" gear="1"/></actuator>
</mujoco>`;

async function scene() {
	return Physics.mujoco({
		mjcf: MJCF,
		fps: 24,
		frames: 24,
		pixelsPerMeter: 400,
		control: () => [2],
	});
}

/** Where each named geom's pixels center, relative to the frame's center. */
async function seen(
	world: Awaited<ReturnType<typeof scene>>,
	camera: string,
	frame = 0,
) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 24,
		durationFrames: 24,
		backgroundColor: "#000000",
	});
	c.add([
		world.camera(camera),
		Layer.ambientLight("#ffffff", 1),
		...(world.layers().layers as LayoutNode[]),
	]);
	const truth = await c.renderTruth(frame);
	const out: Record<string, [number, number]> = {};
	for (const o of truthLabels(truth.scenes[0]).objects) {
		if (!o.layer || !o.box2d) continue;
		const [x0, y0, x1, y1] = o.box2d;
		out[o.layer.replace("mujoco:", "")] = [
			(x0 + x1) / 2 - W / 2,
			(y0 + y1) / 2 - H / 2,
		];
	}
	return out;
}

describe("MuJoCo cameras", () => {
	it("sees right, up and roll as the camera's axes say", async () => {
		const world = await scene();
		expect(world.cameraNames).toEqual(["front", "rolled", "top", "wrist"]);

		// Looking along +y, x right and z up: red right, blue above.
		const front = await seen(world, "front");
		expect(front.red[0]).toBeGreaterThan(15);
		expect(Math.abs(front.red[1])).toBeLessThan(3);
		expect(front.blue[1]).toBeLessThan(-15);
		expect(Math.abs(front.blue[0])).toBeLessThan(3);

		// The same eye turned a quarter: z is right, -x is up, so red is below.
		const rolled = await seen(world, "rolled");
		expect(rolled.blue[0]).toBeGreaterThan(15);
		expect(rolled.red[1]).toBeGreaterThan(15);
		expect(Math.abs(rolled.red[0])).toBeLessThan(3);

		// Straight down, x right and y up: red right, green above.
		const top = await seen(world, "top");
		expect(top.red[0]).toBeGreaterThan(15);
		expect(top.green[1]).toBeLessThan(-15);
		expect(Math.abs(top.green[0])).toBeLessThan(3);
	});

	it("rides its body: the wrist camera moves with the cart", async () => {
		const world = await scene();
		const before = await seen(world, "wrist", 0);
		const after = await seen(world, "wrist", 12);
		// The cart slides toward +x, so the spheres drift left in its view.
		expect(after.blue[0]).toBeLessThan(before.blue[0] - 10);
		expect(() => world.camera("nope")).toThrow('no camera "nope"');
	});

	it("draws a tendon along its path", async () => {
		const world = await scene();
		expect(world.tendonNames).toEqual(["cable"]);
		const front = await seen(world, "front");
		// The cable spans x from -0.3 to 0.3 m below the spheres: its segment
		// is centered under the origin.
		const cable = Object.entries(front).find(([k]) =>
			k.startsWith("tendon:cable:"),
		);
		expect(cable).toBeDefined();
		const [, [cx, cy]] = cable as [string, [number, number]];
		expect(Math.abs(cx)).toBeLessThan(3);
		expect(cy).toBeGreaterThan(15);
	});
});
