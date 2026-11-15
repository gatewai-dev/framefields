import type { SceneBuilder } from './builder.js';
import type { Transform } from './sceneTypes.js';

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

export type MeshLoader = (url: string) => Promise<MeshData>;

export interface RobotOptions {
  baseUrl?: string;
  xform?: Transform;
  material?: Record<string, unknown>;
  loadMesh?: MeshLoader;
}

/** Bodies and joints added by a robot loader, keyed by link and joint name. */
export interface LoadedRobot {
  bodies: Map<string, number>;
  joints: Map<string, number>;
  /** URDF: the root link's body. */
  root?: number;
  /** MJCF: first Newton dof per joint name, valid after `finalize()`. */
  dofs?: Map<string, number>;
}

export declare const quatRpy: (roll: number, pitch: number, yaw: number) => [number, number, number, number];
export declare function parseSTL(data: ArrayBuffer | ArrayBufferView): MeshData;
export declare function parseOBJ(text: string): MeshData;
export declare function fetchMesh(url: string): Promise<MeshData>;
export declare function loadURDF(
  builder: SceneBuilder,
  text: string,
  options?: RobotOptions & { packages?: Record<string, string>; floating?: boolean; density?: number },
): Promise<LoadedRobot>;
export declare function loadMJCF(builder: SceneBuilder, text: string, options?: RobotOptions): Promise<LoadedRobot>;
export declare function parseUSDA(text: string): unknown;
export declare function loadUSDA(builder: SceneBuilder, text: string, options?: { xform?: Transform }): LoadedRobot;
