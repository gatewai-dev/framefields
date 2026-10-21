import { ApiError } from "./errors.js";
import { storage } from "./storage.js";
import { gatewayJson } from "./transport.js";
import type {
	CompletedQueueStatus,
	InQueueQueueStatus,
	ModelData,
	QueueStatus,
	RequestOptions,
	Result,
	StatusOptions,
	SubmitOptions,
	SubscribeOptions,
} from "./types.js";

/** Statuses worth asking again for: rate limits and a gateway or model service hiccup. */
const TRANSIENT = new Set([429, 502, 503, 504]);
const READ_TRIES = 4;

export interface Queue {
	/** Queues a job and returns at once with its `request_id`. Billed when it runs. */
	submit<Input = ModelData>(
		model: string,
		options: SubmitOptions<Input>,
	): Promise<InQueueQueueStatus>;
	status(model: string, options: StatusOptions): Promise<QueueStatus>;
	/** The output of a finished job. Fetching it again does not run or bill the model again. */
	result<Output = ModelData>(
		model: string,
		options: RequestOptions,
	): Promise<Result<Output>>;
	cancel(model: string, options: RequestOptions): Promise<void>;
	/** Resolves when the job is `COMPLETED`, calling `onQueueUpdate` after each check. */
	subscribeToStatus(
		model: string,
		options: WaitOptions,
	): Promise<CompletedQueueStatus>;
}

export type WaitOptions = StatusOptions &
	Pick<SubscribeOptions, "pollInterval" | "onQueueUpdate">;

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		signal?.throwIfAborted();
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});

/** Reads (status, result) are free and idempotent, so transient failures are retried. */
async function read<T>(
	run: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (err) {
			const transient = err instanceof ApiError && TRANSIENT.has(err.status);
			if (!transient || attempt >= READ_TRIES) throw err;
			await sleep(500 * 2 ** attempt, signal);
		}
	}
}

const requestPath = (model: string, requestId: string, suffix = "") =>
	`${model}/requests/${encodeURIComponent(requestId)}${suffix}`;

async function submit<Input>(
	model: string,
	{ input, abortSignal }: SubmitOptions<Input>,
): Promise<InQueueQueueStatus> {
	const { data } = await gatewayJson<InQueueQueueStatus>({
		service: "queue",
		path: model,
		body: (await storage.transformInput(input)) ?? {},
		signal: abortSignal,
	});
	return data;
}

function status(
	model: string,
	{ requestId, logs, abortSignal }: StatusOptions,
): Promise<QueueStatus> {
	return read(async () => {
		const { data } = await gatewayJson<QueueStatus>({
			service: "queue",
			path: requestPath(model, requestId, "/status"),
			query: { logs: logs ? "1" : undefined },
			signal: abortSignal,
		});
		return data;
	}, abortSignal);
}

function result<Output>(
	model: string,
	{ requestId, abortSignal }: RequestOptions,
): Promise<Result<Output>> {
	return read(async () => {
		const { data } = await gatewayJson<Output>({
			service: "queue",
			path: requestPath(model, requestId),
			signal: abortSignal,
		});
		return { data, requestId };
	}, abortSignal);
}

async function cancel(
	model: string,
	{ requestId, abortSignal }: RequestOptions,
): Promise<void> {
	await gatewayJson<unknown>({
		service: "queue",
		path: requestPath(model, requestId, "/cancel"),
		method: "PUT",
		signal: abortSignal,
	});
}

async function subscribeToStatus(
	model: string,
	options: WaitOptions,
): Promise<CompletedQueueStatus> {
	const interval = options.pollInterval ?? 500;
	for (;;) {
		const current = await status(model, options);
		options.onQueueUpdate?.(current);
		if (current.status === "COMPLETED") return current;
		await sleep(interval, options.abortSignal);
	}
}

export const queue: Queue = {
	submit,
	status,
	result,
	cancel,
	subscribeToStatus,
};

/** Queues the job, waits for it, and returns its output. */
export async function subscribe<Output = ModelData, Input = ModelData>(
	model: string,
	options: SubscribeOptions<Input>,
): Promise<Result<Output>> {
	const { request_id: requestId } = await submit(model, options);
	options.onEnqueue?.(requestId);
	await subscribeToStatus(model, { ...options, requestId });
	return result<Output>(model, {
		requestId,
		abortSignal: options.abortSignal,
	});
}
