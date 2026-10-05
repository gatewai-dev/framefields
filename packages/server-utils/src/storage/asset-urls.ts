import type { FileAsset, FileData } from "@framefields/core";

export function GetAssetEndpointBackend(
	baseUrl: string,
	fileAsset: FileAsset,
): string {
	if (fileAsset.url) {
		return fileAsset.url;
	}
	if (fileAsset.key) {
		if (
			fileAsset.key.startsWith("http://") ||
			fileAsset.key.startsWith("https://") ||
			fileAsset.key.startsWith("file://")
		) {
			return fileAsset.key;
		}
		if (fileAsset.key.startsWith("/")) {
			return `file://${fileAsset.key}`;
		}
	}
	if (baseUrl) {
		const basePath = baseUrl.replace(/\/+$/, "");
		return `${basePath}/${fileAsset.key || fileAsset.id}`;
	}
	return fileAsset.key || fileAsset.id;
}

export function ResolveFileDataUrl(
	baseUrl: string,
	data: FileData,
): string | null {
	if (!data?.entity) return null;
	return GetAssetEndpointBackend(baseUrl, data.entity);
}
