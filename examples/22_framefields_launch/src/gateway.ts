/**
 * AI gateway helpers: model pricing estimates, download, and file existence.
 */
import fs from "node:fs/promises";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USD per unit, from https://framefields.dev/models (October 2026). */
export const PRICING = {
	"fal-ai/elevenlabs/music/v2.5": { usd: 0.00007, per: "compute second" },
	"fal-ai/elevenlabs/speech-to-text/scribe-v2": { usd: 0.008, per: "minute" },
	"fal-ai/demucs": { usd: 0.0007, per: "second" },
	"fal-ai/flux-2-pro": { usd: 0.03, per: "megapixel" },
} as const;

export type GatewayModel = keyof typeof PRICING;

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
