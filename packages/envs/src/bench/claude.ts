/**
 * Asks a Claude model the benchmark's questions: each item's images, then
 * its prompt, one request per item, a few at a time. Replies go to a JSONL
 * file as they arrive (with the parsed answer, tokens and stop reason), so
 * a run that stops resumes where it left off.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { BenchItem } from "./data.js";

export interface Reply {
	id: string;
	model: string;
	/** The JSON object the reply holds, or null when there is none. */
	answer: unknown;
	text: string;
	stopReason: string | null;
	inputTokens: number;
	outputTokens: number;
	/** The request failed for good (after the SDK's retries). */
	error?: string;
}

const SYSTEM = `You are taking a visual reasoning benchmark. Look at the images carefully, reason as much as you need, then reply with only the JSON object the question asks for (no prose, no code fences).`;

/** The first JSON object in a reply: the whole text, a fenced block, or its outermost braces. */
export function extractJson(text: string): unknown {
	const attempts = [
		text.trim(),
		/```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]?.trim(),
		text.includes("{")
			? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
			: undefined,
	];
	for (const a of attempts) {
		if (!a) continue;
		try {
			const v: unknown = JSON.parse(a);
			if (typeof v === "object" && v !== null) return v;
		} catch {
			// next attempt
		}
	}
	return null;
}

export interface RunOptions {
	/** The task folder the items' images are relative to. */
	dir: (item: BenchItem) => string;
	model: string;
	/** Effort (`output_config.effort`); default the model's. */
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	/** Replies file (JSONL), appended to. */
	out: string;
	concurrency?: number;
	onReply?: (reply: Reply, done: number, total: number) => void;
}

/** Ids already answered in a replies file (failed requests are asked again). */
export function answeredIds(file: string): Set<string> {
	if (!existsSync(file)) return new Set();
	return new Set(
		readFileSync(file, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Reply)
			.filter((r) => !r.error)
			.map((r) => r.id),
	);
}

async function ask(
	client: Anthropic,
	item: BenchItem,
	options: RunOptions,
): Promise<Reply> {
	const content: Anthropic.ContentBlockParam[] = item.images.map((file) => ({
		type: "image",
		source: {
			type: "base64",
			media_type: "image/png",
			data: readFileSync(path.join(options.dir(item), file)).toString("base64"),
		},
	}));
	content.push({ type: "text", text: item.prompt });
	try {
		const response = await client.messages.create({
			model: options.model,
			max_tokens: 16000,
			system: SYSTEM,
			...(options.effort && { output_config: { effort: options.effort } }),
			messages: [{ role: "user", content }],
		});
		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("\n");
		return {
			id: item.id,
			model: response.model,
			answer: extractJson(text),
			text,
			stopReason: response.stop_reason,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		};
	} catch (error) {
		if (error instanceof Anthropic.APIError)
			return {
				id: item.id,
				model: options.model,
				answer: null,
				text: "",
				stopReason: null,
				inputTokens: 0,
				outputTokens: 0,
				error: `${error.status ?? "connection"}: ${error.message}`,
			};
		throw error;
	}
}

/** Asks every item not answered yet; returns this run's replies. */
export async function runClaude(
	items: BenchItem[],
	options: RunOptions,
): Promise<Reply[]> {
	const client = new Anthropic({ maxRetries: 6 });
	const done = answeredIds(options.out);
	const todo = items.filter((i) => !done.has(i.id));
	const replies: Reply[] = [];
	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			const item = todo[next++];
			const reply = await ask(client, item, options);
			appendFileSync(options.out, `${JSON.stringify(reply)}\n`);
			replies.push(reply);
			options.onReply?.(reply, replies.length, todo.length);
		}
	};
	await Promise.all(
		Array.from({ length: options.concurrency ?? 8 }, () => worker()),
	);
	return replies;
}
