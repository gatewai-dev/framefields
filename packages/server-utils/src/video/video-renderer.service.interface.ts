import type { ExtendedLayer, VirtualMediaData } from "@gitframes/core";

export type RenderMediaProgress = {
	renderedFrames: number;
	encodedFrames: number;
	encodedDoneIn: number | null;
	renderedDoneIn: number | null;
	renderEstimatedTime: number;
	progress: number;
};

export interface SceneProps {
	layers?: ExtendedLayer[];
	viewportWidth: number;
	viewportHeight: number;
	containerWidth?: number;
	containerHeight?: number;
	src?: string;
	isAudio?: boolean;
	type?: "Video" | "Audio" | "Image" | "SVG" | "Text" | string;
	data?: unknown;
	virtualMedia?: VirtualMediaData;
	durationInMS?: number;
	backgroundColor?: string;
	[key: string]: unknown;
}

export type RenderMediaOnProgress = (progress: RenderMediaProgress) => void;

export interface MediaRenderOptions {
	compositionId: string;
	inputProps: SceneProps;
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	durationSeconds?: number;
	codec?:
		| "h264"
		| "h265"
		| "vp8"
		| "vp9"
		| "mp3"
		| "wav"
		| "aac"
		| "opus"
		| "gif"
		| "cube";
	imageFormat?: "png" | "jpeg";
	pixelFormat?: "yuv420p" | "yuva420p";
	audioCodec?: "aac" | "opus" | "mp3";
	/** Render from this time (inclusive). Omit to start from beginning. */
	startMS?: number;
	/** Render up to this time (exclusive). Omit to render until end. */
	endMS?: number;
	onProgress?:
		| RenderMediaOnProgress
		| ((progress: {
				totalSize: number;
				downloaded: number;
				percent: number;
		  }) => unknown);
	envVariables?: Record<string, string>;
	// Required for lambda
	fileKey?: string;
	userId?: string;
	/** The specific frame number to render for still image compositions */
	frame?: number;
	timeMs?: number;
}

export interface IMediaRendererResult {
	fileKey?: string;
	filePath?: string;
	/** Render fingerprint (version-aware hash of VirtualMediaData) */
	fingerprint?: string;
	/** True when result was served from cache */
	cached?: boolean;
	assetId?: string;
	metadata?: {
		width?: number;
		height?: number;
		durationMs?: number;
		fps?: number;
	};
}

export interface IMediaRendererService {
	renderComposition(options: MediaRenderOptions): Promise<IMediaRendererResult>;
	renderVirtualMedia(
		media: VirtualMediaData,
		type: "Video" | "Audio" | "Image" | "GIF" | "LUT",
		options?: Partial<MediaRenderOptions>,
	): Promise<IMediaRendererResult>;

	renderStillComposition(
		options: MediaRenderOptions,
	): Promise<IMediaRendererResult>;

	renderVirtualImage(
		media: VirtualMediaData,
		options?: Partial<MediaRenderOptions> & { frame?: number; timeMs?: number },
	): Promise<IMediaRendererResult>;

	renderVirtualAudio(
		media: VirtualMediaData,
		options?: Partial<MediaRenderOptions>,
	): Promise<IMediaRendererResult>;
}
