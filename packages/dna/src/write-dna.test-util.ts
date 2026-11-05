/**
 * Writes small DNA files for tests, in the layout `readDna` reads (file
 * versions 2.1 and 2.8). Tests only: it covers the layers the reader reads.
 */
import type {
	DnaBehavior,
	DnaDefinition,
	DnaDescriptor,
	DnaMesh,
	LodMapping,
	Vec3Array,
} from "./read.js";

class ByteWriter {
	private chunks: number[] = [];
	private readonly view = new DataView(new ArrayBuffer(8));

	get offset(): number {
		return this.chunks.length;
	}

	private put(n: number) {
		for (let i = 0; i < n; i++) this.chunks.push(this.view.getUint8(i));
	}
	u8(v: number) {
		this.chunks.push(v & 255);
	}
	u16(v: number) {
		this.view.setUint16(0, v);
		this.put(2);
	}
	u32(v: number) {
		this.view.setUint32(0, v >>> 0);
		this.put(4);
	}
	i32(v: number) {
		this.view.setInt32(0, v);
		this.put(4);
	}
	f32(v: number) {
		this.view.setFloat32(0, v);
		this.put(4);
	}
	chars(s: string) {
		for (const b of new TextEncoder().encode(s)) this.chunks.push(b);
	}
	string(s: string) {
		const b = new TextEncoder().encode(s);
		this.u32(b.length);
		for (const x of b) this.chunks.push(x);
	}
	u16s(a: ArrayLike<number>) {
		this.u32(a.length);
		for (let i = 0; i < a.length; i++) this.u16(a[i] as number);
	}
	u32s(a: ArrayLike<number>) {
		this.u32(a.length);
		for (let i = 0; i < a.length; i++) this.u32(a[i] as number);
	}
	f32s(a: ArrayLike<number>) {
		this.u32(a.length);
		for (let i = 0; i < a.length; i++) this.f32(a[i] as number);
	}
	list<T>(items: readonly T[], each: (w: ByteWriter, item: T) => void) {
		this.u32(items.length);
		for (const item of items) each(this, item);
	}
	patchU32(at: number, v: number) {
		this.view.setUint32(0, v >>> 0);
		for (let i = 0; i < 4; i++) this.chunks[at + i] = this.view.getUint8(i);
	}
	bytes(): Uint8Array {
		return Uint8Array.from(this.chunks);
	}
}

const AXES = ["left", "right", "up", "down", "front", "back"];
const SEQUENCES = ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"];

export interface TestDna {
	descriptor: DnaDescriptor;
	definition: DnaDefinition;
	behavior: DnaBehavior;
	meshes: DnaMesh[];
}

function descriptor(w: ByteWriter, d: DnaDescriptor) {
	w.string(d.name);
	w.u16(d.archetype);
	w.u16(d.gender);
	w.u16(d.age);
	w.list(d.metadata, (x, [k, v]) => {
		x.string(k);
		x.string(v);
	});
	w.u16(d.translationUnit === "m" ? 1 : 0);
	w.u16(d.rotationUnit === "radians" ? 1 : 0);
	for (const a of d.coordinateSystem) w.u16(AXES.indexOf(a));
	w.u16(d.lodCount);
	w.u16(d.maxLOD);
	w.string(d.complexity);
	w.string(d.dbName);
}

function descriptorExt(w: ByteWriter, d: DnaDescriptor) {
	w.u32(SEQUENCES.indexOf(d.rotationSequence));
	for (const s of d.rotationSign) w.i32(s);
	w.u8(d.faceWindingOrder === "cw" ? 1 : 0);
}

function lodMapping(w: ByteWriter, m: LodMapping) {
	w.u16s(m.lods);
	w.list(m.indices, (x, row) => x.u16s(row));
}

function vec3s(w: ByteWriter, v: Vec3Array) {
	w.f32s(v.xs);
	w.f32s(v.ys);
	w.f32s(v.zs);
}

function definition(w: ByteWriter, d: DnaDefinition) {
	lodMapping(w, d.lodJointMapping);
	lodMapping(w, d.lodBlendShapeMapping);
	lodMapping(w, d.lodAnimatedMapMapping);
	lodMapping(w, d.lodMeshMapping);
	for (const names of [
		d.guiControlNames,
		d.rawControlNames,
		d.jointNames,
		d.blendShapeChannelNames,
		d.animatedMapNames,
		d.meshNames,
	])
		w.list(names, (x, s) => x.string(s));
	w.u16s(d.meshBlendShapeChannelMapping.from);
	w.u16s(d.meshBlendShapeChannelMapping.to);
	w.u16s(d.jointHierarchy);
	vec3s(w, d.neutralJointTranslations);
	vec3s(w, d.neutralJointRotations);
}

function conditional(
	w: ByteWriter,
	c: DnaBehavior["controls"]["conditionals"],
) {
	w.u16s(c.inputIndices);
	w.u16s(c.outputIndices);
	w.f32s(c.fromValues);
	w.f32s(c.toValues);
	w.f32s(c.slopeValues);
	w.f32s(c.cutValues);
}

function controls(w: ByteWriter, b: DnaBehavior) {
	w.u16(b.controls.psdCount);
	conditional(w, b.controls.conditionals);
	w.u16s(b.controls.psds.rows);
	w.u16s(b.controls.psds.columns);
	w.f32s(b.controls.psds.values);
}
function joints(w: ByteWriter, b: DnaBehavior) {
	w.u16(b.joints.rowCount);
	w.u16(b.joints.colCount);
	w.list(b.joints.jointGroups, (x, g) => {
		x.u16s(g.lods);
		x.u16s(g.inputIndices);
		x.u16s(g.outputIndices);
		x.f32s(g.values);
		x.u16s(g.jointIndices);
	});
}
function blendShapes(w: ByteWriter, b: DnaBehavior) {
	w.u16s(b.blendShapeChannels.lods);
	w.u16s(b.blendShapeChannels.inputIndices);
	w.u16s(b.blendShapeChannels.outputIndices);
}
function animatedMaps(w: ByteWriter, b: DnaBehavior) {
	w.u16s(b.animatedMaps.lods);
	conditional(w, b.animatedMaps.conditionals);
}

function meshBody(w: ByteWriter, m: DnaMesh) {
	vec3s(w, m.positions);
	w.f32s(m.uvs.us);
	w.f32s(m.uvs.vs);
	vec3s(w, m.normals);
	w.u32s(m.layouts.positions);
	w.u32s(m.layouts.uvs);
	w.u32s(m.layouts.normals);
	w.list(m.faces, (x, f) => x.u32s(f));
	w.u16(m.maximumInfluencePerVertex);
	w.list(m.skinWeights, (x, s) => {
		x.f32s(s.weights);
		x.u16s(s.jointIndices);
	});
	w.list(m.blendShapeTargets, (x, t) => {
		vec3s(x, t.deltas);
		x.u32s(t.vertexIndices);
		x.u16(t.channel);
	});
}

const sid = (s: string) =>
	((s.charCodeAt(0) << 24) |
		(s.charCodeAt(1) << 16) |
		(s.charCodeAt(2) << 8) |
		s.charCodeAt(3)) >>>
	0;

/** A 2.8 file: the layer index, then descriptor, extension, definition, behavior and geometry layers. */
export function writeDna28(dna: TestDna): Uint8Array {
	const w = new ByteWriter();
	w.chars("DNA");
	w.u16(2);
	w.u16(8);
	const layers: [string, number, (x: ByteWriter) => void][] = [
		["desc", 0x10001, (x) => descriptor(x, dna.descriptor)],
		["defn", 0x10001, (x) => definition(x, dna.definition)],
		[
			"bhvr",
			0x10001,
			(x) => {
				controls(x, dna.behavior);
				joints(x, dna.behavior);
				blendShapes(x, dna.behavior);
				animatedMaps(x, dna.behavior);
			},
		],
		[
			"geom",
			0x10001,
			(x) =>
				x.list(dna.meshes, (y, m) => {
					const sizeAt = y.offset;
					y.u32(0);
					const base = y.offset;
					meshBody(y, m);
					y.patchU32(sizeAt, y.offset - base);
				}),
		],
		// A layer the reader skips: no twists, no swings.
		[
			"twsw",
			0x10000,
			(x) => {
				x.u32(0);
				x.u32(0);
			},
		],
		["dsce", 0x10000, (x) => descriptorExt(x, dna.descriptor)],
	];
	w.u32(layers.length);
	const slots = layers.map(([id, version]) => {
		w.u32(sid(id));
		w.u32(version);
		const at = w.offset;
		w.u32(0);
		w.u32(0);
		return at;
	});
	layers.forEach(([, , body], i) => {
		const start = w.offset;
		body(w);
		w.patchU32(slots[i] as number, start);
		w.patchU32((slots[i] as number) + 4, w.offset - start);
	});
	return w.bytes();
}

/** A 2.1 file: the section table, then the sections, then the closing signature. */
export function writeDna21(dna: TestDna): Uint8Array {
	const w = new ByteWriter();
	w.chars("DNA");
	w.u16(2);
	w.u16(1);
	const table = w.offset;
	for (let i = 0; i < 8; i++) w.u32(0);
	const section = (k: number, body: () => void) => {
		w.patchU32(table + k * 4, w.offset);
		body();
	};
	section(0, () => descriptor(w, dna.descriptor));
	section(1, () => definition(w, dna.definition));
	section(2, () => {});
	section(3, () => controls(w, dna.behavior));
	section(4, () => joints(w, dna.behavior));
	section(5, () => blendShapes(w, dna.behavior));
	section(6, () => animatedMaps(w, dna.behavior));
	section(7, () =>
		w.list(dna.meshes, (y, m) => {
			const endAt = y.offset;
			y.u32(0);
			meshBody(y, m);
			y.patchU32(endAt, y.offset);
		}),
	);
	w.chars("AND");
	return w.bytes();
}
