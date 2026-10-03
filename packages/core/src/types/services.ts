import type { FileData } from "./index.js";

/**
 * Interface for media processing and handling.
 */
export interface MediaService {
	getImageDimensions: (
		buffer: Buffer,
	) =>
		| Promise<{ width: number; height: number }>
		| { width: number; height: number };

	getImageBuffer: (imageInput: FileData) => Promise<Buffer>;

	resolveFileDataUrl: (
		data: FileData | null,
	) => string | Promise<string | null> | null;
}

/**
 * Interface for storage operations.
 */
export interface StorageService {
	uploadToStorage: (
		buffer: Buffer,
		key: string,
		contentType?: string,
		bucketName?: string,
	) => Promise<void>;

	uploadFileToStorage: (
		filePath: string,
		key: string,
		contentType?: string,
		bucketName?: string,
	) => Promise<void>;

	getFromStorage?: (key: string, bucketName?: string) => Promise<Buffer>;

	deleteFromStorage?: (key: string, bucketName?: string) => Promise<void>;

	getPublicUrl?: (key: string, bucketName?: string) => string;
}
