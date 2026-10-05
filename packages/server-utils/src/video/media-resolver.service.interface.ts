import type { FileData, VirtualMediaData } from "@framefields/core";

export interface MediaResolutionResult {
	buffer?: Buffer;
	mimeType?: string;
	fileKey?: string;
	assetId?: string;
	url?: string;
	virtualMedia?: VirtualMediaData | FileData;
}

export interface ResolveOptions {
	userId?: string;
	fileKey?: string;
	frame?: number;
	timeMs?: number;
	codec?:
		| "h264"
		| "h265"
		| "vp8"
		| "vp9"
		| "mp3"
		| "wav"
		| "aac"
		| "opus"
		| "gif";
	imageFormat?: "png" | "jpeg";
	pixelFormat?: "yuv420p" | "yuva420p";
	audioCodec?: "aac" | "opus" | "mp3";
}
export type ResolvedFileType =
	| "Video"
	| "Audio"
	| "Image"
	| "LUT"
	| "GIF"
	| "Caption";
export interface IMediaResolverService {
	resolveToBuffer(
		media: VirtualMediaData,
		type: ResolvedFileType,
		options?: ResolveOptions,
	): Promise<MediaResolutionResult>;

	resolveToUrl(
		media: VirtualMediaData,
		type: ResolvedFileType,
		options?: ResolveOptions,
	): Promise<MediaResolutionResult>;

	resolveToAsset(
		media: VirtualMediaData,
		type: ResolvedFileType,
		options?: ResolveOptions,
	): Promise<MediaResolutionResult>;
}
