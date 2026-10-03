/**
 * Minimal fal.ai queue client: submit, poll, fetch the result, download files.
 * Every call is priced up front from the model's published unit price so the
 * pipeline can print what a run cost.
 */
import fs from "node:fs/promises";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USD per unit, from https://api.fal.ai/v1/models/pricing (October 2026). */
export const PRICING = {
	"fal-ai/z-image/turbo": { usd: 0.005, per: "megapixel" },
	"minimax/h3-max-turbo/image-to-video": { usd: 0.015, per: "second" },
	"minimax/h3-max/image-to-video": { usd: 0.03, per: "second" },
	"minimax/music-3": { usd: 0.002, per: "second" },
} as const;

export type FalModel = keyof typeof PRICING;

export const estimate = (model: FalModel, units: number) =>
	PRICING[model].usd * units;

export class FalClient {
	private spent = 0;

	constructor(private readonly key: string) {}

	get totalUsd(): number {
		return this.spent;
	}

	/** Submits to the fal queue, polls until done, returns the JSON result. */
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
		this.spent += estimate(model, units);
		return (await result.json()) as T;
	}
}

/** fetch that rides out transient network failures (long polls drop connections). */
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
