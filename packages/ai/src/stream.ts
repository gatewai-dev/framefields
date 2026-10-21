import { ApiError } from "./errors.js";
import { storage } from "./storage.js";
import { gatewayFetch } from "./transport.js";
import type { ModelData, RunOptions } from "./types.js";

/**
 * A model's streamed output. Iterate it for each partial result as it arrives; `done()`
 * resolves with the last one (and drains the stream if nobody iterates it).
 */
export interface ModelStream<Output = ModelData> extends AsyncIterable<Output> {
	readonly requestId: string;
	done(): Promise<Output>;
	abort(): void;
}

/** Yields each `data:` payload of a server-sent event stream, joined across lines. */
async function* serverSentEvents(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of body) {
		buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
		let end = buffer.indexOf("\n\n");
		while (end !== -1) {
			const block = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const parsed = parseBlock(block);
			if (parsed) yield parsed;
			end = buffer.indexOf("\n\n");
		}
	}
	const last = parseBlock(buffer);
	if (last) yield last;
}

function parseBlock(block: string): { event: string; data: string } | null {
	let event = "message";
	const data: string[] = [];
	for (const line of block.split("\n")) {
		if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		else if (line.startsWith("event:")) event = line.slice(6).trim();
	}
	return data.length ? { event, data: data.join("\n") } : null;
}

async function* outputs<Output>(
	body: ReadableStream<Uint8Array>,
	requestId: string,
): AsyncGenerator<Output> {
	for await (const { event, data } of serverSentEvents(body)) {
		const payload = JSON.parse(data) as Output;
		if (event === "error") {
			throw new ApiError({
				message: "The model stream ended with an error",
				status: 500,
				body: payload,
				requestId,
			});
		}
		yield payload;
	}
}

/** Runs a streaming model; resolves once the stream is open. */
export async function stream<Output = ModelData, Input = ModelData>(
	model: string,
	{ input, abortSignal }: RunOptions<Input>,
): Promise<ModelStream<Output>> {
	const controller = new AbortController();
	const signal = abortSignal
		? AbortSignal.any([abortSignal, controller.signal])
		: controller.signal;
	const response = await gatewayFetch({
		service: "run",
		path: `${model}/stream`,
		body: (await storage.transformInput(input)) ?? {},
		accept: "text/event-stream",
		signal,
	});
	const requestId = response.headers.get("x-framefields-request-id") ?? "";
	if (!response.body) {
		throw new ApiError({ message: "Empty stream", status: 502, requestId });
	}
	const source = outputs<Output>(response.body, requestId);

	let last: Output | undefined;
	let finished: Promise<Output> | undefined;
	async function* tracked(): AsyncGenerator<Output> {
		for await (const value of source) {
			last = value;
			yield value;
		}
	}
	const iterator = tracked();
	const drain = async (): Promise<Output> => {
		let step = await iterator.next();
		while (!step.done) step = await iterator.next();
		if (last === undefined) {
			throw new ApiError({
				message: "Stream had no output",
				status: 502,
				requestId,
			});
		}
		return last;
	};

	return {
		requestId,
		[Symbol.asyncIterator]: () => iterator,
		done: () => {
			finished ??= drain();
			return finished;
		},
		abort: () => controller.abort(),
	};
}
