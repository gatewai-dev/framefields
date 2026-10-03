import { describe, expect, it } from "vitest";
import { FbxLoader, fbxEulerToQuat } from "./fbx-loader.js";
import type { NodeAnimationTrack3D } from "./types.js";

const K = FbxLoader.FBX_KTIME; // ticks per second

/** An AnimationCurve object with keys at the given seconds. */
function curve(id: number, seconds: number[], values: number[]): string {
	return `
	AnimationCurve: ${id}, "AnimCurve::", "" {
		Default: 0
		KeyVer: 4009
		KeyTime: *${seconds.length} {
			a: ${seconds.map((s) => s * K).join(",")}
		}
		KeyValueFloat: *${values.length} {
			a: ${values.join(",")}
		}
	}`;
}

function curveNode(id: number, name: string): string {
	return `
	AnimationCurveNode: ${id}, "AnimCurveNode::${name}", "" {
		Properties70:  {
			P: "d|X", "Number", "", "A",0
			P: "d|Y", "Number", "", "A",0
			P: "d|Z", "Number", "", "A",0
		}
	}`;
}

/**
 * One model "Cube" (RotationOrder XYZ, rest translation z = 5) animated over
 * 0..2 s. The translation curve node has a junk name ("rs") so only its
 * "Lcl Translation" connection property identifies it.
 */
function animatedCubeFbx(rotationOrder = 0): string {
	return `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXVersion: 7400
}
Objects:  {
	Model: 1001, "Model::Cube", "Mesh" {
		Properties70:  {
			P: "RotationOrder", "enum", "", "",${rotationOrder}
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,5
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
		}
	}
	AnimationStack: 5001, "AnimStack::Take 001", "" {
	}
	AnimationLayer: 5002, "AnimLayer::BaseLayer", "" {
	}${curveNode(2001, "rs")}${curveNode(2002, "R")}${curveNode(2003, "S")}${curve(3001, [0, 1, 2], [0, 10, 20])}${curve(3002, [0, 2], [0, 4])}${curve(3003, [0, 1, 2], [0, 90, 180])}${curve(3004, [0, 1, 2], [1, 2, 3])}${curve(3005, [0, 2], [1, 5])}${curve(3006, [0, 2], [1, 1])}
}
Connections:  {
	C: "OO", 5002, 5001
	C: "OO", 2001, 5002
	C: "OO", 2002, 5002
	C: "OO", 2003, 5002
	C: "OP", 2001, 1001, "Lcl Translation"
	C: "OP", 2002, 1001, "Lcl Rotation"
	C: "OP", 2003, 1001, "Lcl Scaling"
	C: "OP", 3002, 2001, "d|Y"
	C: "OP", 3001, 2001, "d|X"
	C: "OP", 3003, 2002, "d|Z"
	C: "OP", 3004, 2003, "d|X"
	C: "OP", 3005, 2003, "d|Y"
	C: "OP", 3006, 2003, "d|Z"
}
`;
}

function trackWith(
	tracks: NodeAnimationTrack3D[],
	field: "translations" | "rotations" | "scales",
): NodeAnimationTrack3D {
	const matches = tracks.filter((t) => t[field]);
	expect(matches).toHaveLength(1);
	return matches[0]!;
}

function expectClose(actual: ArrayLike<number>, expected: number[]): void {
	expect(actual).toHaveLength(expected.length);
	expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 5));
}

/** Rotates v by the [x, y, z, w] quaternion q. */
function rotate(q: number[], v: number[]): number[] {
	const [x, y, z, w] = q as [number, number, number, number];
	const [vx, vy, vz] = v as [number, number, number];
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

describe("FBX animation import", () => {
	const model = FbxLoader.parse(animatedCubeFbx());
	const clip = model.animations[0]!;

	it("merges X/Y/Z curves into one track per transform", () => {
		expect(clip.name).toBe("Take 001");
		expect(clip.duration).toBeCloseTo(2, 5);
		expect(clip.tracks).toHaveLength(3);
		for (const track of clip.tracks) {
			expect(track.nodeName).toBe("Cube");
			expectClose(track.times, [0, 1, 2]);
		}
	});

	it("translates with vec3 keys, interpolating sparse channels and keeping the static value", () => {
		const t = trackWith(clip.tracks, "translations");
		expect(t.rotations).toBeUndefined();
		expect(t.scales).toBeUndefined();
		// Mid key (1 s): X keyed, Y interpolated between 0 and 4, Z from Lcl Translation.
		expectClose(t.translations!.subarray(3, 6), [10, 2, 5]);
		expectClose(t.translations!.subarray(6, 9), [20, 4, 5]);
	});

	it("rotates with quaternion keys converted from Euler degrees", () => {
		const r = trackWith(clip.tracks, "rotations");
		expect(r.rotations).toHaveLength(12);
		const s = Math.SQRT1_2;
		expectClose(r.rotations!.subarray(0, 4), [0, 0, 0, 1]);
		// Mid key: 90° about Z.
		expectClose(r.rotations!.subarray(4, 8), [0, 0, s, s]);
		expectClose(rotate(Array.from(r.rotations!.subarray(4, 8)), [1, 0, 0]), [0, 1, 0]);
		// 180° about Z, kept in the same hemisphere as the previous key.
		expectClose(r.rotations!.subarray(8, 12), [0, 0, 1, 0]);
	});

	it("scales with vec3 keys", () => {
		const sc = trackWith(clip.tracks, "scales");
		expectClose(sc.scales!.subarray(3, 6), [2, 3, 1]);
		expectClose(sc.scales!.subarray(6, 9), [3, 5, 1]);
	});
});

describe("fbxEulerToQuat", () => {
	it("applies axes in FBX RotationOrder", () => {
		// XYZ: X first, then Y. (1,0,0) is fixed by X 90°, then Y 90° sends it to (0,0,-1).
		expectClose(rotate(fbxEulerToQuat([90, 90, 0], "XYZ"), [1, 0, 0]), [0, 0, -1]);
		// YXZ: Y first sends (1,0,0) to (0,0,-1), then X 90° sends that to (0,1,0).
		expectClose(rotate(fbxEulerToQuat([90, 90, 0], "YXZ"), [1, 0, 0]), [0, 1, 0]);
	});

	it("uses the model's RotationOrder enum when importing", () => {
		const fbx = animatedCubeFbx(5) // ZYX
			.replace('"Lcl Rotation", "", "A",0,0,0', '"Lcl Rotation", "", "A",90,0,0');
		const r = trackWith(FbxLoader.parse(fbx).animations[0]!.tracks, "rotations");
		expectClose(r.rotations!.subarray(4, 8), fbxEulerToQuat([90, 0, 90], "ZYX"));
		expect(fbxEulerToQuat([90, 0, 90], "ZYX")).not.toEqual(fbxEulerToQuat([90, 0, 90], "XYZ"));
	});
});
