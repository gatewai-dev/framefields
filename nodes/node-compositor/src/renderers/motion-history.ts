/**
 * What each 3D draw looked like one frame earlier, for shutter motion blur.
 * A scene records every mesh and plane (by a key stable across frames) and
 * its camera as it renders frame f; frame f + 1 reads them back. Instance
 * records and deformed vertices (morph targets, audio deformation) are
 * copied on the GPU, where they are made, into a pair of buffers by frame
 * parity so rendering a frame again still finds f - 1.
 * A frame whose predecessor is not recorded (a seek) renders f - 1 first
 * (`needsPrevious`), so every frame comes out the same in any order.
 */
import type {
	Camera3DPose,
	Mat4,
	MeshMotionPrev,
	MeshWind,
	SlugGlyphBatch,
} from "@framefields/webgpu-renderers";

export interface MeshMotionState {
	kind: "mesh";
	modelMatrix: Mat4;
	skinning?: Float32Array;
	/** Byte size of the instance records copied for this frame. */
	instanceBytes?: number;
	/** Byte size of the deformed vertices copied for this frame. */
	vertexBytes?: number;
	windTime?: number;
	crowdTime?: number;
}

export interface QuadMotionState {
	kind: "quad";
	modelMatrix: Mat4;
}

/** A text plane: its matrix and its glyph batches (records copied). */
export interface SlugMotionState {
	kind: "slug";
	modelMatrix: Mat4;
	batches: SlugGlyphBatch[];
}

type MotionState = MeshMotionState | QuadMotionState | SlugMotionState;

/** Two frames of one value: the latest and the one before it. */
class Slots<T> {
	frame = Number.NaN;
	value?: T;
	prevFrame = Number.NaN;
	prevValue?: T;

	write(frame: number, value: T): void {
		if (frame !== this.frame) {
			this.prevFrame = this.frame;
			this.prevValue = this.value;
		}
		this.frame = frame;
		this.value = value;
	}

	/** The value at `frame`, if it is one of the two held. */
	at(frame: number): T | undefined {
		if (frame === this.frame) return this.value;
		if (frame === this.prevFrame) return this.prevValue;
		return undefined;
	}
}

export class MotionHistory {
	private readonly states = new Map<string, Slots<MotionState>>();
	private readonly instances: GpuPairs;
	private readonly vertices: GpuPairs;
	private readonly camera = new Slots<Camera3DPose>();
	/** Frames recorded, latest last (two kept). */
	private readonly frames = new Slots<true>();

	constructor(device: GPUDevice) {
		this.instances = new GpuPairs(device, "Instances");
		this.vertices = new GpuPairs(device, "Vertices");
	}

	/** Whether rendering `frame` must render `frame - 1` first to know its motion. */
	needsPrevious(frame: number): boolean {
		return frame > 0 && this.frames.at(frame - 1) === undefined;
	}

	previousCamera(frame: number): Camera3DPose | undefined {
		return this.camera.at(frame - 1);
	}

	/** A mesh's state at `frame - 1`, shaped for the velocity pass. */
	previousMesh(
		key: string,
		frame: number,
		now: {
			skinning?: Float32Array;
			instanceBuffer?: GPUBuffer;
			/** Byte size of this frame's deformed vertices, when the GPU deforms the mesh. */
			vertexBytes?: number;
			wind?: MeshWind;
			crowd?: MeshMotionPrev["crowd"];
		},
	): MeshMotionPrev | undefined {
		const prev = this.states.get(key)?.at(frame - 1);
		if (prev?.kind !== "mesh") return undefined;
		const out: MeshMotionPrev = { modelMatrix: prev.modelMatrix };
		// A mesh that changed shape (other joints, other instance count) has
		// no comparable past: it moves by its matrix alone.
		if (now.skinning && prev.skinning?.length === now.skinning.length) {
			out.skinningMatrices = prev.skinning;
		}
		const copy = this.instances.at(key, frame - 1);
		if (
			now.instanceBuffer &&
			copy &&
			prev.instanceBytes === now.instanceBuffer.size
		) {
			out.instanceBuffer = copy;
		}
		const vertices = this.vertices.at(key, frame - 1);
		if (now.vertexBytes && vertices && prev.vertexBytes === now.vertexBytes) {
			out.vertexBuffer = vertices;
		}
		if (now.wind && prev.windTime !== undefined) {
			out.wind = { ...now.wind, time: prev.windTime };
		}
		if (now.crowd && prev.crowdTime !== undefined) {
			out.crowd = { ...now.crowd, time: prev.crowdTime };
		}
		return out;
	}

	previousQuad(key: string, frame: number): Mat4 | undefined {
		const prev = this.states.get(key)?.at(frame - 1);
		return prev?.kind === "quad" ? prev.modelMatrix : undefined;
	}

	/**
	 * Records a mesh at `frame`; its instance records and deformed vertices
	 * (when the GPU deforms it) are copied in `encoder`.
	 */
	recordMesh(
		encoder: GPUCommandEncoder,
		key: string,
		frame: number,
		state: Omit<MeshMotionState, "kind" | "instanceBytes" | "vertexBytes">,
		buffers: {
			instanceBuffer?: GPUBuffer;
			/** Deformed vertices and their byte size (the buffer may be pooled and larger). */
			vertices?: { buffer: GPUBuffer; bytes: number };
		},
	): void {
		const { instanceBuffer, vertices } = buffers;
		if (instanceBuffer) {
			this.instances.copy(
				encoder,
				key,
				frame,
				instanceBuffer,
				instanceBuffer.size,
				GPUBufferUsage.STORAGE,
			);
		}
		if (vertices) {
			this.vertices.copy(
				encoder,
				key,
				frame,
				vertices.buffer,
				vertices.bytes,
				GPUBufferUsage.VERTEX,
			);
		}
		this.slots(key).write(frame, {
			kind: "mesh",
			...state,
			...(state.skinning && { skinning: state.skinning.slice() }),
			instanceBytes: instanceBuffer?.size,
			vertexBytes: vertices?.bytes,
		});
	}

	previousSlug(
		key: string,
		frame: number,
	): Omit<SlugMotionState, "kind"> | undefined {
		const prev = this.states.get(key)?.at(frame - 1);
		return prev?.kind === "slug" ? prev : undefined;
	}

	/** Records a text plane at `frame`; glyph records are copied (batches are rebuilt each frame). */
	recordSlug(
		key: string,
		frame: number,
		modelMatrix: Mat4,
		batches: SlugGlyphBatch[],
	): void {
		this.slots(key).write(frame, {
			kind: "slug",
			modelMatrix,
			batches: batches.map((b) => ({
				...b,
				instances: b.instances.slice(0, b.instanceCount * 24),
			})),
		});
	}

	recordQuad(key: string, frame: number, modelMatrix: Mat4): void {
		this.slots(key).write(frame, { kind: "quad", modelMatrix });
	}

	recordFrame(frame: number, camera: Camera3DPose): void {
		this.camera.write(frame, camera);
		this.frames.write(frame, true);
	}

	private slots(key: string): Slots<MotionState> {
		let s = this.states.get(key);
		if (!s) {
			s = new Slots();
			this.states.set(key, s);
		}
		return s;
	}
}

/** GPU copies of a buffer per key, one per frame parity. */
class GpuPairs {
	private readonly pairs = new Map<string, [GPUBuffer?, GPUBuffer?]>();

	constructor(
		private readonly device: GPUDevice,
		private readonly label: string,
	) {}

	at(key: string, frame: number): GPUBuffer | undefined {
		return this.pairs.get(key)?.[frame & 1];
	}

	copy(
		encoder: GPUCommandEncoder,
		key: string,
		frame: number,
		source: GPUBuffer,
		bytes: number,
		usage: GPUBufferUsageFlags,
	): void {
		const pair = this.pairs.get(key) ?? [];
		const slot = frame & 1;
		let copy = pair[slot];
		if (!copy || copy.size !== bytes) {
			copy?.destroy();
			copy = this.device.createBuffer({
				label: `MotionHistory${this.label}:${key}`,
				size: bytes,
				usage: usage | GPUBufferUsage.COPY_DST,
			});
			pair[slot] = copy;
			this.pairs.set(key, pair);
		}
		encoder.copyBufferToBuffer(source, 0, copy, 0, bytes);
	}
}

const histories = new Map<string, MotionHistory>();

/** The motion history of one composition render (by render id). */
export function motionHistory(
	device: GPUDevice,
	renderId: string,
): MotionHistory {
	let h = histories.get(renderId);
	if (!h) {
		if (histories.size > 64) histories.clear();
		h = new MotionHistory(device);
		histories.set(renderId, h);
	}
	return h;
}
