import { getEnv, resolveMediaSourceUrl } from "@gitframes/client-utils";
import {
	getActiveMediaMetadata,
	resolveMediaMimeType,
	type VirtualMediaData,
} from "@gitframes/core";

export type CropRegion = {
	leftPct: number;
	topPct: number;
	widthPct: number;
	heightPct: number;
};

export type RenderParams = {
	sourceUrl: string | undefined;
	trimStartSec: number;
	trimEndSec: number | null;
	speed: number;
	cropRegion: CropRegion | null;
	flipH: boolean;
	flipV: boolean;
	rotation: number;
	effectiveDurationSec: number;
	mimeType: string | null;
};

const BASE_URL = getEnv("BASE_URL") as string;
const CDN_DOMAIN = getEnv("R2_CUSTOM_DOMAIN") as string;

export function getFontUrl(name: string) {
	if (CDN_DOMAIN) {
		return `https://${CDN_DOMAIN}/fonts/${name}/font_file.ttf`;
	}
	return `${BASE_URL}/api/v1/fonts/load/${name}`;
}

/**
 * Compute render parameters for the CURRENT node only — does NOT recurse into
 * children. Each node in the VirtualMedia tree is responsible for exactly its
 * own operation; `SingleClipComposition` drives traversal via React recursion.
 *
 * This is the correct function to use inside the renderer.
 */
export function computeRenderParams(vv: VirtualMediaData): RenderParams {
	const op = vv.operation;
	const baseMeta = getActiveMediaMetadata(vv);

	const params: RenderParams = {
		sourceUrl: undefined,
		trimStartSec: 0,
		trimEndSec: null,
		speed: 1.0,
		cropRegion: null,
		flipH: false,
		flipV: false,
		rotation: 0,
		effectiveDurationSec: 0,
		mimeType: resolveMediaMimeType(vv) || null,
	};

	switch (op.op) {
		case "text":
			// Rendered as a DOM element by the caller; no media URL needed.
			params.sourceUrl = undefined;
			break;
		default:
			params.sourceUrl = resolveMediaSourceUrl(vv);
			break;
	}

	const sourceDurationSec = (baseMeta?.durationMs ?? 0) / 1000;
	params.effectiveDurationSec =
		((params.trimEndSec ?? sourceDurationSec) - params.trimStartSec) /
		params.speed;

	return params;
}
