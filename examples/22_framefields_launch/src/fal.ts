/**
 * Minimal fal.ai queue client (after examples/21_full_circle): submit, poll,
 * fetch the result. Each call is priced from the model's published unit price
 * so a run reports what it cost.
 */
import fs from "node:fs/promises";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USD per unit, from https://api.fal.ai/v1/models/pricing (October 2026). */
export const PRICING = {
	"fal-ai/elevenlabs/music/v2.5": { usd: 0.00007, per: "compute second" },
	"fal-ai/elevenlabs/speech-to-text/scribe-v2": { usd: 0.008, per: "minute" },
	"fal-ai/demucs": { usd: 0.0007, per: "second" },
	"fal-ai/flux-2-pro": { usd: 0.03, per: "megapixel" },
} as const;

export type FalModel = keyof typeof PRICING;

export class FalClient {
	private spent = 0;

	constructor(private readonly key: string) {}

	get totalUsd(): number {
		return this.spent;
	}

	async run<T>(
		model: FalModel,
		input: Record<string, unknown>,
		units: number,
	): Promise<T> {
		const headers = {
			Authorization: `Key ${this.key}`,
			"Content-Type": "application/json",
		};
		const submit = await request(`https://queue.fal.run/${model}`, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		if (!submit.ok)
			throw new Error(
				`${model} submit → ${submit.status} ${await submit.text()}`,
			);
		const { status_url, response_url } = (await submit.json()) as {
			status_url: string;
			response_url: string;
		};
		for (;;) {
			await sleep(3000);
			const res = await request(status_url, { headers });
			const { status } = (await res.json()) as { status: string };
			if (status === "COMPLETED") break;
			if (status !== "IN_QUEUE" && status !== "IN_PROGRESS")
				throw new Error(`${model} → ${status}`);
		}
		const result = await request(response_url, { headers });
		if (!result.ok)
			throw new Error(
				`${model} result → ${result.status} ${await result.text()}`,
			);
		this.spent += PRICING[model].usd * units;
		return (await result.json()) as T;
	}
}

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
