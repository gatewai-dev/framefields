/**
 * AI gateway helpers: model pricing estimates, download, and file existence.
 */
import fs from "node:fs/promises";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USD per unit, from https://framefields.dev/models (October 2026). */
export const PRICING = {
	"fal-ai/z-image/turbo": { usd: 0.005, per: "megapixel" },
	"minimax/h3-max-turbo/image-to-video": { usd: 0.015, per: "second" },
	"minimax/h3-max/image-to-video": { usd: 0.03, per: "second" },
	"minimax/music-3": { usd: 0.002, per: "second" },
} as const;

export type GatewayModel = keyof typeof PRICING;

export const estimate = (model: GatewayModel, units: number) =>
	PRICING[model].usd * units;

/** fetch that rides out transient network failures. */
async function request(url: string, init?: RequestInit): Promise<Response> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fetch(url, init);
		} catch (err) {
			if (attempt === 5) throw err;
			await sleep(2000 * attempt);
		}
	}
}

export async function download(url: string, dest: string): Promise<void> {
	const res = await request(url);
	if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

export const exists = (p: string) =>
	fs.access(p).then(
		() => true,
		() => false,
	);
