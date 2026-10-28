declare module "draco3dgltf" {
	interface DracoArray {
		size(): number;
		GetValue(index: number): number;
	}
	interface DracoBuffer {
		Init(data: Int8Array, size: number): void;
	}
	interface DracoMesh {
		num_points(): number;
		num_faces(): number;
	}
	interface DracoStatus {
		ok(): boolean;
		error_msg(): string;
	}
	interface DracoDecoder {
		GetEncodedGeometryType(buffer: DracoBuffer): number;
		DecodeBufferToMesh(buffer: DracoBuffer, mesh: DracoMesh): DracoStatus;
		GetAttributeByUniqueId(mesh: DracoMesh, id: number): object | null;
		GetAttributeFloatForAllPoints(
			mesh: DracoMesh,
			attribute: object,
			array: DracoArray,
		): boolean;
		GetFaceFromMesh(mesh: DracoMesh, face: number, array: DracoArray): boolean;
	}
	interface DracoModule {
		Decoder: new () => DracoDecoder;
		DecoderBuffer: new () => DracoBuffer;
		Mesh: new () => DracoMesh;
		DracoFloat32Array: new () => DracoArray;
		DracoInt32Array: new () => DracoArray;
		TRIANGULAR_MESH: number;
		destroy(value: object): void;
	}
	const draco: { createDecoderModule(options: object): Promise<DracoModule> };
	export default draco;
}
