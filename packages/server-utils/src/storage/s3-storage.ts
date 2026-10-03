import fs from "node:fs/promises";
import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { inject, injectable, postConstruct } from "inversify";
import { TOKENS } from "../di/tokens.js";
import type { EnvConfig } from "../env-schema.js";
import type { StorageService } from "./interface.js";

@injectable()
export class S3StorageService implements StorageService {
	private client?: S3Client;
	private defaultBucket: string = "gitframes-renders";
	private customDomain?: string;

	constructor(@inject(TOKENS.ENV) private env: EnvConfig) {}

	@postConstruct()
	public init(): void {
		const endpoint = this.env.R2_S3_API_ENDPOINT;
		const accessKeyId = this.env.R2_ACCESS_KEY_ID;
		const secretAccessKey = this.env.R2_SECRET_ACCESS_KEY;
		this.defaultBucket = this.env.R2_ASSETS_BUCKET || "gitframes-renders";
		this.customDomain = this.env.R2_CUSTOM_DOMAIN;

		if (endpoint && accessKeyId && secretAccessKey) {
			this.client = new S3Client({
				region: "auto",
				endpoint,
				credentials: {
					accessKeyId,
					secretAccessKey,
				},
			});
		}
	}

	async uploadToStorage(
		buffer: Buffer,
		key: string,
		contentType: string = "application/octet-stream",
		bucketName?: string,
	): Promise<void> {
		if (!this.client) {
			throw new Error("S3 storage client is not configured");
		}
		const bucket = bucketName || this.defaultBucket;
		await this.client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: buffer,
				ContentType: contentType,
			}),
		);
	}

	async uploadFileToStorage(
		filePath: string,
		key: string,
		contentType: string = "application/octet-stream",
		bucketName?: string,
	): Promise<void> {
		const buffer = await fs.readFile(filePath);
		await this.uploadToStorage(buffer, key, contentType, bucketName);
	}

	async getFromStorage(key: string, bucketName?: string): Promise<Buffer> {
		if (!this.client) {
			throw new Error("S3 storage client is not configured");
		}
		const bucket = bucketName || this.defaultBucket;
		const res = await this.client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
		if (!res.Body) {
			throw new Error(`Empty body returned for storage key: ${key}`);
		}
		const bytes = await res.Body.transformToByteArray();
		return Buffer.from(bytes);
	}

	getPublicUrl(key: string, bucketName?: string): string {
		if (this.customDomain) {
			return `https://${this.customDomain}/${key}`;
		}
		return `/${bucketName || this.defaultBucket}/${key}`;
	}
}

export { S3StorageService as R2StorageService };
