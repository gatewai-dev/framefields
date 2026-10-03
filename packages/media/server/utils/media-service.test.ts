import type { FileData } from "@gitframes/core";
import {
	type EnvConfig,
	GetAssetEndpointBackend,
} from "@gitframes/server-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerMediaService } from "./media-service.js";

// Mock sharp
vi.mock("sharp", () => {
	const metadata = vi.fn().mockResolvedValue({ width: 1920, height: 1080 });
	const sharpMock = vi.fn(() => ({
		metadata,
	}));
	return { default: sharpMock };
});

// Mock server-utils
vi.mock("@gitframes/server-utils", () => ({
	GetAssetEndpointBackend: vi.fn(),
	TOKENS: {
		ENV: Symbol.for("ENV"),
	},
}));

describe("ServerMediaService", () => {
	let service: ServerMediaService;
	const mockEnv: EnvConfig = {
		BASE_URL: "https://api.test.com",
	} as unknown as EnvConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new ServerMediaService();
		// Manually inject dependencies since we are unit testing the class
		Object.assign(service, { env: mockEnv });
		service.init();
	});

	describe("getImageDimensions", () => {
		it("should return width and height from sharp metadata", async () => {
			const buffer = Buffer.from("fake-image-data");
			const dimensions = await service.getImageDimensions(buffer);

			expect(dimensions).toEqual({ width: 1920, height: 1080 });
			const sharp = (await import("sharp")).default;
			expect(sharp).toHaveBeenCalledWith(buffer);
		});
	});

	describe("getImageBuffer", () => {
		it("should fetch image and return buffer", async () => {
			const mockFileData: FileData = {
				entity: { id: "asset-1", key: "assets/1.png" },
			} as unknown as FileData;
			const mockUrl = "https://api.test.com/api/v1/assets/asset-1.png";
			const mockArrayBuffer = new ArrayBuffer(8);

			vi.mocked(GetAssetEndpointBackend).mockReturnValue(mockUrl);

			const mockResponse = {
				arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
				ok: true,
			};
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

			const result = await service.getImageBuffer(mockFileData);

			expect(GetAssetEndpointBackend).toHaveBeenCalledWith(
				mockEnv.BASE_URL,
				mockFileData.entity,
			);
			expect(global.fetch).toHaveBeenCalledWith(mockUrl);
			expect(result).toBeInstanceOf(Buffer);
			expect(result.length).toBe(8);
		});

		it("should throw error if no URL is found", async () => {
			const mockFileData: FileData = { entity: null } as unknown as FileData;
			vi.mocked(GetAssetEndpointBackend).mockReturnValue(
				null as unknown as string,
			);

			await expect(service.getImageBuffer(mockFileData)).rejects.toThrow(
				"No URL found in FileData",
			);
		});
	});

	describe("resolveFileDataUrl", () => {
		it("should return null if data is null", () => {
			expect(service.resolveFileDataUrl(null)).toBeNull();
		});

		it("should return null if data has no entity", () => {
			expect(service.resolveFileDataUrl({} as unknown as FileData)).toBeNull();
		});

		it("should return URL if data has entity", () => {
			const mockFileData: FileData = {
				entity: { id: "asset-1", key: "assets/1.png" },
			} as unknown as FileData;
			const mockUrl = "https://api.test.com/api/v1/assets/asset-1.png";
			vi.mocked(GetAssetEndpointBackend).mockReturnValue(mockUrl);

			const result = service.resolveFileDataUrl(mockFileData);

			expect(result).toBe(mockUrl);
			expect(GetAssetEndpointBackend).toHaveBeenCalledWith(
				mockEnv.BASE_URL,
				mockFileData.entity,
			);
		});
	});
});
