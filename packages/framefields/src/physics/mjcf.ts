/**
 * What an MJCF file says that Steel's loader leaves out: its `<camera>`s.
 * Each one is fixed to its body (or the world) with MuJoCo's semantics:
 * it looks along its local -z with +y up, its pose given by `pos` and one
 * of `quat`, `axisangle`, `xyaxes`, `zaxis` or `euler` (in the compiler's
 * `angle` units and `eulerseq`), and `fovy` is its vertical field of view
 * in degrees.
 */
import type { Quat, Vec3 } from "./backend.js";
import { ensureXmlParser } from "./xml.js";

export interface MjcfCamera {
	name: string;
	/** The body it rides; `null` for the world. */
	body: string | null;
	/** In the body's frame, m. */
	position: Vec3;
	/** In the body's frame, x, y, z, w. */
	quaternion: Quat;
	/** Vertical field of view, degrees. */
	fovy: number;
}

const numbers = (el: XmlNode, attr: string): number[] | null => {
	const text = el.getAttribute(attr);
	return text === null ? null : text.trim().split(/\s+/).map(Number);
};

const normalize = (v: number[]): number[] => {
	const l = Math.hypot(...v) || 1;
	return v.map((x) => x / l);
};

const cross = (a: number[], b: number[]): number[] => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

const qmul = (a: Quat, b: Quat): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const axisAngle = (axis: number[], angle: number): Quat => {
	const [x, y, z] = normalize(axis);
	const s = Math.sin(angle / 2);
	return [x * s, y * s, z * s, Math.cos(angle / 2)];
};

/** The rotation whose columns are the orthonormal frame `x`, `y`, `z`. */
function fromAxes(x: number[], y: number[], z: number[]): Quat {
	const [m00, m10, m20] = x;
	const [m01, m11, m21] = y;
	const [m02, m12, m22] = z;
	const trace = m00 + m11 + m22;
	if (trace > 0) {
		const s = 2 * Math.sqrt(trace + 1);
		return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
	}
	if (m00 > m11 && m00 > m22) {
		const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
		return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
	}
	if (m11 > m22) {
		const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
		return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
	}
	const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
	return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

/** MuJoCo's `xyaxes`: x, then y made orthogonal to it; z = x × y. */
function fromXyAxes(v: number[]): Quat {
	const x = normalize(v.slice(0, 3));
	const y0 = v.slice(3, 6);
	const d = y0[0] * x[0] + y0[1] * x[1] + y0[2] * x[2];
	const y = normalize([y0[0] - d * x[0], y0[1] - d * x[1], y0[2] - d * x[2]]);
	return fromAxes(x, y, cross(x, y));
}

/** MuJoCo's `zaxis`: the shortest turn from +z onto it. */
function fromZAxis(v: number[]): Quat {
	const z = normalize(v);
	const d = z[2];
	if (d < -0.999999) return [1, 0, 0, 0];
	const c = cross([0, 0, 1], z);
	const w = 1 + d;
	const l = Math.hypot(c[0], c[1], c[2], w);
	return [c[0] / l, c[1] / l, c[2] / l, w / l];
}

interface Compiler {
	/** Radians per unit of an angle in the file. */
	unit: number;
	eulerseq: string;
}

/** MuJoCo's `euler`: turns about `eulerseq`'s axes, lower case moving with the frame. */
function fromEuler(v: number[], compiler: Compiler): Quat {
	let q: Quat = [0, 0, 0, 1];
	[...compiler.eulerseq].forEach((c, k) => {
		const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[c.toLowerCase()];
		if (!axis) throw new Error(`MJCF: bad eulerseq "${compiler.eulerseq}".`);
		const turn = axisAngle(axis, v[k] * compiler.unit);
		q = c === c.toLowerCase() ? qmul(q, turn) : qmul(turn, q);
	});
	return q;
}

function orientation(el: XmlNode, compiler: Compiler): Quat {
	const quat = numbers(el, "quat");
	if (quat) {
		const [w, x, y, z] = normalize(quat);
		return [x, y, z, w];
	}
	const aa = numbers(el, "axisangle");
	if (aa) return axisAngle(aa.slice(0, 3), aa[3] * compiler.unit);
	const xy = numbers(el, "xyaxes");
	if (xy) return fromXyAxes(xy);
	const z = numbers(el, "zaxis");
	if (z) return fromZAxis(z);
	const euler = numbers(el, "euler");
	if (euler) return fromEuler(euler, compiler);
	return [0, 0, 0, 1];
}

/** The slice of an XML element (DOM or the Node shim) this module reads. */
interface XmlNode {
	readonly tagName: string;
	readonly children: ArrayLike<XmlNode>;
	getAttribute(name: string): string | null;
}

/** The `<camera>`s of an MJCF document, in document order. */
export function mjcfCameras(xml: string): MjcfCamera[] {
	ensureXmlParser();
	const root = new DOMParser().parseFromString(xml, "text/xml")
		.documentElement as unknown as XmlNode;
	const kids = (n: XmlNode) => Array.from(n.children);
	const compilerEl = kids(root).find((n) => n.tagName === "compiler");
	const compiler: Compiler = {
		unit: compilerEl?.getAttribute("angle") === "radian" ? 1 : Math.PI / 180,
		eulerseq: compilerEl?.getAttribute("eulerseq") ?? "xyz",
	};
	const cameras: MjcfCamera[] = [];
	// <default> classes describe cameras without placing one: only <worldbody> places them.
	const walk = (node: XmlNode, body: string | null, inFrame: boolean) => {
		for (const el of kids(node)) {
			if (el.tagName === "body") {
				const name = el.getAttribute("name");
				walk(el, name ?? "", inFrame);
			} else if (el.tagName === "frame") walk(el, body, true);
			else if (el.tagName === "camera")
				cameras.push(camera(el, body, inFrame, cameras.length, compiler));
		}
	};
	for (const wb of kids(root).filter((n) => n.tagName === "worldbody"))
		walk(wb, null, false);
	return cameras;
}

function camera(
	el: XmlNode,
	body: string | null,
	inFrame: boolean,
	index: number,
	compiler: Compiler,
): MjcfCamera {
	const name = el.getAttribute("name") ?? `camera${index}`;
	const mode = el.getAttribute("mode") ?? "fixed";
	if (mode !== "fixed")
		throw new Error(
			`MJCF: camera "${name}" has mode="${mode}"; only fixed cameras are supported.`,
		);
	if (inFrame)
		throw new Error(
			`MJCF: camera "${name}" sits in a <frame>, which is not supported.`,
		);
	if (body === "")
		throw new Error(`MJCF: camera "${name}" is on a body without a name.`);
	const pos = numbers(el, "pos") ?? [0, 0, 0];
	return {
		name,
		body,
		position: [pos[0], pos[1], pos[2]],
		quaternion: orientation(el, compiler),
		fovy: Number(el.getAttribute("fovy") ?? 45),
	};
}
