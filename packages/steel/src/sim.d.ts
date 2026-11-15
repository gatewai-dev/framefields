import type { LoadedScene, Vec3 } from './sceneTypes.js';

export { SceneBuilder, convexHull, MAX_HULL_VERTICES } from './builder.js';
export { fetchMesh, loadMJCF, loadURDF, loadUSDA, parseOBJ, parseSTL, parseUSDA, quatRpy } from './loaders.js';

export declare const KERNELS: readonly ['shapes', 'broad', 'args', 'narrow', 'csort', 'prepare', 'solve'];

export declare function loadScene(base: string): Promise<LoadedScene>;

/** Newton's SolverSteel options; unset fields keep the scene's own values. */
export interface SimOptions {
  substeps?: number;
  iterations?: number;
  /** Steel's dimensionless contact regularization g. */
  regularization?: number;
  warmStart?: number;
  /** Solver block overrides, e.g. `{ enable_sleeping: true }`. */
  solver?: Record<string, unknown>;
}

/** A body being pulled toward a world point by the mouse spring. */
export interface DragState {
  body: number;
  /** Grab point in the body frame. */
  local: number[];
  /** World point the spring pulls toward. */
  target: number[];
}

export interface SimStats {
  maxContacts: number;
  maxColors: number;
  maxUnits: number;
  maxPairs: number;
  contacts: number;
  colors: number;
  maxDense: number;
  asleep: number;
  /** Buffers that filled up at some point and dropped work. */
  overflow: string[];
  /** Physics GPU time of the last timestamped frame. */
  gpuFrameMs?: number;
}

/** Newton State: body origin poses (7 per body), body twists (6 per body) and joint coordinates. */
export interface SimState {
  bodyQ: Float32Array;
  bodyQd: Float32Array;
  jointQ: Float32Array;
  jointQd: Float32Array;
}

export declare class Sim {
  constructor(device: GPUDevice, scene: LoadedScene, opts?: SimOptions);
  /** Like `new Sim`, but compiles the kernels in parallel off the main thread. */
  static create(device: GPUDevice, scene: LoadedScene, opts?: SimOptions): Promise<Sim>;
  readonly device: GPUDevice;
  readonly scene: LoadedScene;
  readonly opts: Required<Pick<SimOptions, 'substeps' | 'iterations' | 'regularization'>> & SimOptions;
  readonly solver: Record<string, unknown> & { enable_sleeping?: boolean };
  /** Simulated seconds since the last reset. */
  readonly time: number;
  readonly frame: number;
  /** Number of bodies. */
  readonly NB: number;
  /** Per body: 0 static, 1 loose (draggable), 2 articulated or kinematic. */
  readonly bodyKind: readonly number[];
  /** Per body: whether the mouse spring may pull it (free bodies and links of undriven articulations; none when the scene sets `mouse_drag` false). */
  readonly draggable: readonly boolean[];
  /** Poses: per body COM position (vec4) then quaternion x, y, z, w (vec4). */
  readonly buffers: { poses: GPUBuffer } & Record<string, GPUBuffer>;
  readonly initial: { bodyPose: Float32Array };
  readonly hasTimestamps: boolean;
  pick: DragState | null;
  destroy(): void;
  reset(): void;
  /** Encodes and submits `frames` frames; `timestamps` records physics GPU time for `stats()`. */
  step(frames?: number, timestamps?: boolean): void;
  run(frames: number, onFrame?: (sim: Sim, frame: number) => unknown): Promise<void>;
  setJointTarget(newtonDof: number, pos: number, vel?: number): void;
  setJointTargets(pos: ArrayLike<number>, vel?: ArrayLike<number> | null, first?: number): void;
  setJointForce(newtonDof: number, value: number): void;
  setBodyWrench(body: number, force: ArrayLike<number>, torque: ArrayLike<number>): void;
  setBodyPose(body: number, com: ArrayLike<number>, quat: ArrayLike<number>): void;
  setBodyTwist(body: number, twist: ArrayLike<number>): void;
  state(): Promise<SimState>;
  /** framefields: the state and the last substep's contacts, in one GPU copy. */
  state(options: { contacts: true }): Promise<SimState & { contacts: SimContact[] }>;
  read(name: string, bytes: number, offset?: number): Promise<ArrayBuffer>;
  poses(): Promise<Float32Array>;
  /** Pose readback through a small staging-buffer pool; resolves with a copy. */
  readPosesPooled(): Promise<Float32Array>;
  stats(): Promise<SimStats>;

  // framefields: run-time changes, snapshots and contacts.
  /** Gravity (m/s², world frame) from the next step on. */
  setGravity(gravity: ArrayLike<number>): void;
  /** Gravity now. */
  readonly gravity: Vec3;
  /** A body's mass (kg) as the solver has it now. */
  bodyMass(body: number): number;
  /** A free body's mass (kg); its inertia scales with it. */
  setBodyMass(body: number, mass: number): void;
  /** A body's gravity scale, and a free body's linear damping (1/s) and planar lock. */
  setBodyExtension(body: number, extension: BodyExtension): void;
  /** Locks a free body's turning about its own x, y and/or z axes. */
  lockBodyRotation(body: number, axes: [boolean, boolean, boolean]): void;
  /** Takes a free body out of the world (it neither moves nor touches anything), or puts it back. */
  setBodyEnabled(body: number, on: boolean): void;
  /** Whether a body's shapes touch anything. */
  setBodyCollisions(body: number, on: boolean): void;
  /** The whole state as bytes; `restore` on a Sim of the same scene continues bit for bit. */
  snapshot(): Promise<Uint8Array>;
  restore(snapshot: Uint8Array): void;
  /** The contacts of the last substep. */
  contacts(): Promise<SimContact[]>;
}

/** framefields: what `setBodyExtension` changes; fields left out keep their value. */
export interface BodyExtension {
  /** Multiplies gravity on the body (default 1). */
  gravityScale?: number;
  /** Linear velocity damping, 1/s (free bodies; default 0). */
  linearDamping?: number;
  /** Moves in its world xy plane only, turning about z (free bodies). */
  planar?: boolean;
}

/** framefields: a contact of the last substep. */
export interface SimContact {
  /** The bodies, a < b; -1 is the world. */
  a: number;
  b: number;
  /** World frame. */
  point: Vec3;
  /** Unit, world frame, pointing from a toward b. */
  normal: Vec3;
  /** Signed gap, m (below 0: overlapping). */
  phi: number;
}
