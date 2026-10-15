// Generates the assets that aren't copied media: a glTF model, a Lottie
// animation and captions. Run with `npm run assets`; the outputs are
// committed, so the renderer never runs this.
import fs from "node:fs/promises";
import path from "node:path";

const ASSETS = path.resolve(import.meta.dirname, "../assets");

// ─── model.glb: a faceted gem (flat normals, PBR material) ──────────────────

/** An elongated octahedron with a bevelled girdle, radius `r`, height `h`. */
function gem(r, h, sides = 8) {
	const top = [0, -h / 2, 0];
	const bottom = [0, h / 2, 0];
	const ring = Array.from({ length: sides }, (_, i) => {
		const a = (i / sides) * Math.PI * 2;
		return [Math.cos(a) * r, -h * 0.12, Math.sin(a) * r];
	});
	const faces = [];
	for (let i = 0; i < sides; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % sides];
		faces.push([top, b, a], [bottom, a, b]);
	}
	const positions = [];
	const normals = [];
	for (const [p0, p1, p2] of faces) {
		const u = p1.map((v, k) => v - p0[k]);
		const v = p2.map((w, k) => w - p0[k]);
		const n = [
			u[1] * v[2] - u[2] * v[1],
			u[2] * v[0] - u[0] * v[2],
			u[0] * v[1] - u[1] * v[0],
		];
		const len = Math.hypot(...n) || 1;
		for (const p of [p0, p1, p2]) {
			positions.push(...p);
			normals.push(...n.map((c) => c / len));
		}
	}
	// Planar UVs: some GPU drivers need every attribute the shader reads.
	const uvs = [];
	for (let i = 0; i < positions.length; i += 3) {
		uvs.push(positions[i] / (2 * r) + 0.5, positions[i + 1] / h + 0.5);
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
	};
}

function glb(json, chunks) {
	let offset = 0;
	const bufferViews = [];
	const parts = [];
	for (const data of chunks) {
		const pad = (4 - (offset % 4)) % 4;
		if (pad) {
			parts.push(Buffer.alloc(pad));
			offset += pad;
		}
		const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
		parts.push(buf);
		offset += buf.length;
	}
	const bin = Buffer.concat(parts);
	const doc = Buffer.from(
		JSON.stringify({
			asset: { version: "2.0", generator: "framefields smoke" },
			...json,
			buffers: [{ byteLength: bin.length }],
			bufferViews,
		}),
	);
	const pad4 = (b, fill) =>
		Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
	const docP = pad4(doc, 0x20);
	const binP = pad4(bin, 0);
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + docP.length + 8 + binP.length, 8);
	const chunk = (data, type) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(data.length, 0);
		h.writeUInt32LE(type, 4);
		return Buffer.concat([h, data]);
	};
	return Buffer.concat([
		header,
		chunk(docP, 0x4e4f534a),
		chunk(binP, 0x004e4942),
	]);
}

const g = gem(160, 300);
const count = g.positions.length / 3;
const min = [0, 1, 2].map((k) =>
	Math.min(...g.positions.filter((_, i) => i % 3 === k)),
);
const max = [0, 1, 2].map((k) =>
	Math.max(...g.positions.filter((_, i) => i % 3 === k)),
);
await fs.writeFile(
	path.join(ASSETS, "model.glb"),
	glb(
		{
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0, name: "gem" }],
			meshes: [
				{
					name: "gem",
					primitives: [
						{
							attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
							material: 0,
						},
					],
				},
			],
			materials: [
				{
					name: "amber",
					pbrMetallicRoughness: {
						baseColorFactor: [1, 0.42, 0.12, 1],
						metallicFactor: 0.3,
						roughnessFactor: 0.25,
					},
				},
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
				{ bufferView: 1, componentType: 5126, count, type: "VEC3" },
				{ bufferView: 2, componentType: 5126, count, type: "VEC2" },
			],
		},
		[g.positions, g.normals, g.uvs],
	),
);

// ─── badge.json: a Lottie animation (spinning star, pulsing ring) ───────────

const ease = (n) => ({
	i: { x: Array(n).fill(0.4), y: Array(n).fill(1) },
	o: { x: Array(n).fill(0.6), y: Array(n).fill(0) },
});
const transform = (extra = {}) => ({
	o: { a: 0, k: 100 },
	r: { a: 0, k: 0 },
	p: { a: 0, k: [200, 200, 0] },
	a: { a: 0, k: [0, 0, 0] },
	s: { a: 0, k: [100, 100, 100] },
	...extra,
});
const groupTransform = {
	ty: "tr",
	p: { a: 0, k: [0, 0] },
	a: { a: 0, k: [0, 0] },
	s: { a: 0, k: [100, 100] },
	r: { a: 0, k: 0 },
	o: { a: 0, k: 100 },
};
const lottie = {
	v: "5.7.4",
	fr: 30,
	ip: 0,
	op: 90,
	w: 400,
	h: 400,
	nm: "badge",
	ddd: 0,
	assets: [],
	layers: [
		{
			ddd: 0,
			ind: 1,
			ty: 4,
			nm: "star",
			sr: 1,
			ks: transform({
				r: {
					a: 1,
					k: [
						{ t: 0, s: [0], ...ease(1) },
						{ t: 90, s: [360] },
					],
				},
				s: {
					a: 1,
					k: [
						{ t: 0, s: [40, 40, 100], ...ease(3) },
						{ t: 24, s: [100, 100, 100] },
					],
				},
			}),
			ao: 0,
			shapes: [
				{
					ty: "gr",
					nm: "star",
					it: [
						{
							ty: "sr",
							sy: 1,
							d: 1,
							nm: "star",
							pt: { a: 0, k: 5 },
							p: { a: 0, k: [0, 0] },
							r: { a: 0, k: 0 },
							ir: { a: 0, k: 55 },
							is: { a: 0, k: 0 },
							or: { a: 0, k: 130 },
							os: { a: 0, k: 0 },
						},
						{
							ty: "fl",
							nm: "fill",
							c: { a: 0, k: [1, 0.35, 0.12, 1] },
							o: { a: 0, k: 100 },
							r: 1,
						},
						{
							ty: "st",
							nm: "stroke",
							c: { a: 0, k: [1, 1, 1, 1] },
							o: { a: 0, k: 100 },
							w: { a: 0, k: 8 },
							lc: 2,
							lj: 2,
						},
						groupTransform,
					],
				},
			],
			ip: 0,
			op: 90,
			st: 0,
			bm: 0,
		},
		{
			ddd: 0,
			ind: 2,
			ty: 4,
			nm: "ring",
			sr: 1,
			ks: transform({
				o: {
					a: 1,
					k: [
						{ t: 0, s: [100], ...ease(1) },
						{ t: 45, s: [0], ...ease(1) },
						{ t: 90, s: [100] },
					],
				},
				s: {
					a: 1,
					k: [
						{ t: 0, s: [80, 80, 100], ...ease(3) },
						{ t: 45, s: [120, 120, 100], ...ease(3) },
						{ t: 90, s: [80, 80, 100] },
					],
				},
			}),
			ao: 0,
			shapes: [
				{
					ty: "gr",
					nm: "ring",
					it: [
						{
							ty: "el",
							nm: "circle",
							d: 1,
							p: { a: 0, k: [0, 0] },
							s: { a: 0, k: [330, 330] },
						},
						{
							ty: "st",
							nm: "stroke",
							c: { a: 0, k: [0.39, 0.4, 0.95, 1] },
							o: { a: 0, k: 100 },
							w: { a: 0, k: 10 },
							lc: 2,
							lj: 2,
						},
						groupTransform,
					],
				},
			],
			ip: 0,
			op: 90,
			st: 0,
			bm: 0,
		},
	],
};
await fs.writeFile(
	path.join(ASSETS, "badge.json"),
	JSON.stringify(lottie, null, "\t"),
);

// ─── captions.srt ───────────────────────────────────────────────────────────

await fs.writeFile(
	path.join(ASSETS, "captions.srt"),
	[
		"1\n00:00:00,000 --> 00:00:01,500\nRendered by the framefields worker.\n",
		"2\n00:00:01,500 --> 00:00:03,000\nFrom git, on a GPU, in one job.\n",
	].join("\n"),
);

// ─── teal-orange.cube: a 3D LUT (teal shadows, warm highlights) ─────────────

const SIZE = 17;
const lines = ['TITLE "teal-orange"', `LUT_3D_SIZE ${SIZE}`];
// .cube order: red varies fastest, then green, then blue.
for (let b = 0; b < SIZE; b++) {
	for (let g = 0; g < SIZE; g++) {
		for (let r = 0; r < SIZE; r++) {
			const [R, G, B] = [r, g, b].map((v) => v / (SIZE - 1));
			const luma = 0.2126 * R + 0.7152 * G + 0.0722 * B;
			// Shadows lean teal, highlights lean orange; a gentle S-curve on luma.
			const warm = Math.max(0, luma - 0.5) * 2;
			const cool = Math.max(0, 0.5 - luma) * 2;
			const s = luma * luma * (3 - 2 * luma) - luma;
			const out = [
				R + s + 0.08 * warm - 0.06 * cool,
				G + s + 0.02 * warm + 0.03 * cool,
				B + s - 0.08 * warm + 0.07 * cool,
			].map((v) => Math.min(1, Math.max(0, v)).toFixed(6));
			lines.push(out.join(" "));
		}
	}
}
await fs.writeFile(
	path.join(ASSETS, "teal-orange.cube"),
	`${lines.join("\n")}\n`,
);

console.log(
	"assets written:",
	["model.glb", "badge.json", "captions.srt", "teal-orange.cube"].join(", "),
);
