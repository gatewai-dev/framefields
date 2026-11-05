/** The subset of the Khronos glTF validator's API the tests use. */
declare module "gltf-validator" {
	export interface ValidationMessage {
		code: string;
		message: string;
		/** 0 error, 1 warning, 2 info, 3 hint. */
		severity: number;
		pointer?: string;
	}
	export interface ValidationReport {
		issues: {
			numErrors: number;
			numWarnings: number;
			messages: ValidationMessage[];
		};
	}
	export function validateBytes(
		data: Uint8Array,
		options?: { maxIssues?: number; uri?: string },
	): Promise<ValidationReport>;
}
