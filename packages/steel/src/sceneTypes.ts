export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
/** Position then quaternion (x, y, z, w). */
export type Transform = [...Vec3, ...Quat];

export interface BinRange {
  off: number;
  n: number;
}

export interface HullRef {
  verts: BinRange;
  face_start: BinRange;
  face_verts: BinRange;
  /** framefields: the hull's vertex count (the builder writes it). */
  nv: number;
  nf: number;
}

/** A visual mesh stored in scene.bin. */
export interface BinMeshRef {
  v: BinRange;
  i: BinRange;
  uv?: BinRange;
  texture?: string;
  file?: undefined;
  crease?: boolean;
}

/**
 * A visual mesh in a shared file (path relative to the scene folder), stored once by content: `nv` float32 positions,
 * then `ni` indices, then, 4-byte aligned, `nv` float32 UV pairs when `uv` is set.
 */
export interface FileMeshRef {
  file: string;
  nv: number;
  ni: number;
  index: 'u16' | 'u32';
  uv: boolean;
  texture?: string;
  /** Vertices are shared across hard edges, so normals split at creases. */
  crease?: boolean;
}

export type MeshRef = BinMeshRef | FileMeshRef;

export interface VisualMeshData {
  pos: Float32Array;
  idx: Uint16Array | Uint32Array;
  uv: Float32Array | null;
}

export interface VisualJson {
  body: number;
  mesh?: MeshRef;
  hull?: HullRef;
  color: Vec3;
  xf: Transform;
}

export interface ShapeJson {
  body: number;
  xf: Transform;
  color: Vec3;
  hull?: HullRef;
  plane?: unknown;
  visible?: boolean;
}

export interface CompareJson {
  option: string;
  off: unknown;
  label: string;
}

export interface SceneInfoJson {
  camera?: { eye: Vec3; target: Vec3 };
  compare?: CompareJson;
  pile_bin_bounds?: [Vec3, Vec3];
}

export interface SceneJson {
  demo: string;
  fps: number;
  bodies: { count: number; com: Vec3[]; q: Transform[] };
  visuals: VisualJson[];
  shapes: ShapeJson[];
  info: SceneInfoJson;
  /** False when the mouse spring may pull nothing in this scene. */
  mouse_drag?: boolean;
}

export interface LoadedScene {
  json: SceneJson;
  base: string;
  bin: ArrayBuffer;
  f32(range: BinRange): Float32Array;
  u32(range: BinRange): Uint32Array;
  /** A visual mesh's positions, indices and UVs, from scene.bin or its shared file. */
  mesh(ref: MeshRef): VisualMeshData;
}

export interface SceneEntry {
  name: string;
  title: string;
  about: string;
  /** The gallery and picker group the scene under this heading. */
  category?: string;
  /** A one-line description for gallery cards. */
  short?: string;
}
