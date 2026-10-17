const isNodeEnv = () =>
	(typeof process !== "undefined" && Boolean(process.versions?.node)) ||
	Boolean((globalThis as any).__IS_HEADLESS_RENDERER__);

import type { FileAsset, FileData, VirtualMediaData } from "@framefields/core";

/**
 * Resolve the actual playable URL from a VirtualMediaData.
 * Walks down the tree to find the 'source' operation.
 */
function normalizeLocalBrowserUrl(url: string | undefined): string | undefined {
	if (!url || isNodeEnv() || typeof window === "undefined") return url;
	const clean = url.replace(/^file:\/\//, "");
	if (
		clean.startsWith("/") &&
		!clean.startsWith("/@fs/") &&
		!clean.startsWith("/api/")
	) {
		return `/@fs${clean}`;
	}
	return url;
}

export function resolveMediaSourceUrl(
	vv: VirtualMediaData | undefined | null,
): string | undefined {
	if (!vv) return undefined;

	if ((vv as any)?.sourceUrl && typeof (vv as any).sourceUrl === "string") {
		return normalizeLocalBrowserUrl((vv as any).sourceUrl);
	}
	if ((vv as any)?.url && typeof (vv as any).url === "string") {
		return normalizeLocalBrowserUrl((vv as any).url);
	}

	const directEntity = (vv as any)?.entity;
	if (directEntity) {
		if (typeof directEntity === "string")
			return normalizeLocalBrowserUrl(directEntity);
		if (directEntity.url && typeof directEntity.url === "string")
			return normalizeLocalBrowserUrl(directEntity.url);
		return GetAssetEndpoint(directEntity);
	}

	// New structure: leaf source node
	if (vv.operation?.op === "source") {
		const source = (vv.operation as any).source;
		if (typeof source === "string") return normalizeLocalBrowserUrl(source);
		if (source?.url && typeof source.url === "string")
			return normalizeLocalBrowserUrl(source.url);
		if (source?.entity) {
			return GetAssetEndpoint(source.entity);
		}
		if (
			(vv.operation as any).sourceUrl &&
			typeof (vv.operation as any).sourceUrl === "string"
		) {
			return normalizeLocalBrowserUrl((vv.operation as any).sourceUrl);
		}
		if (
			(vv.operation as any).url &&
			typeof (vv.operation as any).url === "string"
		) {
			return normalizeLocalBrowserUrl((vv.operation as any).url);
		}
		const srtText = (vv.operation as any).srtText;
		if (srtText) {
			const base64 =
				typeof Buffer !== "undefined"
					? Buffer.from(srtText).toString("base64")
					: btoa(unescape(encodeURIComponent(srtText)));
			return `data:text/srt;base64,${base64}`;
		}
		const svgContent = (vv.operation as any).svgContent;
		if (svgContent) {
			const base64 =
				typeof Buffer !== "undefined"
					? Buffer.from(svgContent).toString("base64")
					: btoa(unescape(encodeURIComponent(svgContent)));
			return `data:image/svg+xml;base64,${base64}`;
		}
	}

	const svgDataUrl = (vv.operation as any)?.svgDataUrl;
	if (svgDataUrl && typeof svgDataUrl === "string") {
		return svgDataUrl;
	}

	const svgContent = (vv.operation as any)?.svgContent;
	if (svgContent && typeof svgContent === "string") {
		const base64 =
			typeof Buffer !== "undefined"
				? Buffer.from(svgContent).toString("base64")
				: btoa(unescape(encodeURIComponent(svgContent)));
		return `data:image/svg+xml;base64,${base64}`;
	}

	const lutUrl = (vv.operation as any)?.lutUrl;
	if (lutUrl && typeof lutUrl === "string") {
		return lutUrl;
	}

	if (vv.operation?.op === "ExtractLUT") {
		return undefined;
	}

	// Recursively search children (e.g. Blur, Adjust, LUT, Compositor wrapping a media source)
	if (Array.isArray(vv.children)) {
		for (const child of vv.children) {
			const found = resolveMediaSourceUrl(child);
			if (found) return found;
		}
	}

	// Recursively search connected inputs
	const inputs = (vv.operation as any)?.inputs;
	if (inputs && typeof inputs === "object") {
		for (const entry of Object.values(inputs as Record<string, any>)) {
			if (
				entry?.outputItem?.data &&
				typeof entry.outputItem.data === "object"
			) {
				const found = resolveMediaSourceUrl(
					entry.outputItem.data as VirtualMediaData,
				);
				if (found) return found;
			}
		}
	}

	return undefined;
}

/**
 * Appends a file extension hint to the URL.
 */
export function GetAssetEndpoint(fileAsset: Pick<FileAsset, "id" | "key">) {
	if (!fileAsset) return "";
	if ((fileAsset as any).url && typeof (fileAsset as any).url === "string") {
		const u = (fileAsset as any).url as string;
		if (typeof window !== "undefined" && !isNodeEnv()) {
			const cleanPath = u.replace(/^file:\/\//, "");
			if (
				cleanPath.startsWith("/") &&
				!cleanPath.startsWith("/@fs/") &&
				!cleanPath.startsWith("/api/")
			) {
				return `/@fs${cleanPath}`;
			}
		}
		return u;
	}

	const { id, key } = fileAsset;

	if (
		key &&
		(key.startsWith("file://") ||
			key.startsWith("/") ||
			key.startsWith("http://") ||
			key.startsWith("https://"))
	) {
		if (typeof window !== "undefined" && !isNodeEnv()) {
			const cleanPath = key.replace(/^file:\/\//, "");
			if (
				cleanPath.startsWith("/") &&
				!cleanPath.startsWith("/@fs/") &&
				!cleanPath.startsWith("/api/")
			) {
				return `/@fs${cleanPath}`;
			}
		}
		return key.startsWith("/") ? `file://${key}` : key;
	}

	// An asset known only by id: the asset API path on the page's own origin.
	const extension = key.includes(".") ? key.split(".").pop() : null;
	const suffix = extension ? `.${extension}` : "";

	return `/api/v1/assets/${id}${suffix}`;
}

/** Conventional path of a font that wasn't registered with a file. */
export function GetFontAssetUrl(name: string) {
	return `assets/fonts/${name}.ttf`;
}

export function getDataTypeFromMime(mimeType: string, filename?: string) {
	if (filename) {
		const ext = filename.toLowerCase().split(".").pop();
		if (ext === "cube") return "LUT";
	}
	if (!mimeType) return null;
	if (mimeType === "image/svg+xml") return "SVG";
	if (mimeType.startsWith("image/")) return "Image";
	if (mimeType === "application/json") return "Lottie";
	if (mimeType.startsWith("video/")) return "Video";
	if (mimeType.startsWith("audio/")) return "Audio";
	if (mimeType === "text/srt" || mimeType === "application/x-subrip")
		return "Caption";
	if (mimeType === "text/plain") return "Text";

	return null;
}

export const isFileData = (data: unknown): data is FileData => {
	return typeof data === "object" && data !== null && "entity" in data;
};

export function ResolveFileDataUrl(data: FileData) {
	if (!data) return null;
	if (data.entity) return GetAssetEndpoint(data.entity);
	return null;
}
