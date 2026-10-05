import type { FileData, MediaService } from "@framefields/core";
import {
	type EnvConfig,
	GetAssetEndpointBackend,
	TOKENS,
} from "@framefields/server-utils";
import { inject, injectable, postConstruct } from "inversify";
import sharp from "sharp";

@injectable()
export class ServerMediaService implements MediaService {
	private baseUrl!: string;

	@inject(TOKENS.ENV)
	private env!: EnvConfig;

	@postConstruct()
	init() {
		this.baseUrl = this.env.BASE_URL;
	}

	async getImageDimensions(
		buffer: Buffer,
	): Promise<{ width: number; height: number }> {
		const metadata = await sharp(buffer).metadata();
		return { width: metadata.width, height: metadata.height };
	}

	async getImageBuffer(imageInput: FileData): Promise<Buffer> {
		const urlToUse = imageInput?.entity
			? GetAssetEndpointBackend(this.baseUrl, imageInput.entity)
			: null;

		if (!urlToUse) {
			throw new Error("No URL found in FileData");
		}

		const response = await fetch(urlToUse);
		return Buffer.from(await response.arrayBuffer());
	}

	resolveFileDataUrl(data: FileData | null): string | null {
		if (!data) return null;

		if (data.entity) {
			const fileAsset = data.entity;
			return GetAssetEndpointBackend(this.baseUrl, fileAsset);
		}

		return null;
	}
}
