import { type Queue, queue, subscribe } from "./queue.js";
import { type Storage, storage } from "./storage.js";
import { type ModelStream, stream } from "./stream.js";
import { gatewayJson, setApiKey } from "./transport.js";
import type {
	ModelData,
	Result,
	RunOptions,
	SubscribeOptions,
} from "./types.js";

export interface AiConfig {
	/** A framefields API key (`ff_live_…`). Defaults to `process.env.FRAMEFIELDS_API_KEY`. */
	apiKey?: string;
}

/**
 * AI models (images, video, music, voice, …) through the framefields AI gateway, billed to
 * the framefields account that owns the API key. Models are named by their catalog id,
 * e.g. `ai.subscribe("flux/schnell", { input })`; https://framefields.dev/models lists them.
 */
export interface Ai {
	/** Set the API key in code instead of `FRAMEFIELDS_API_KEY`. */
	config(options: AiConfig): void;
	/** Runs a model and waits for its output in one request. Best for fast models. */
	run<Output = ModelData, Input = ModelData>(
		model: string,
		options: RunOptions<Input>,
	): Promise<Result<Output>>;
	/** Queues a job, polls until it finishes, and returns its output. Use for slow models. */
	subscribe<Output = ModelData, Input = ModelData>(
		model: string,
		options: SubscribeOptions<Input>,
	): Promise<Result<Output>>;
	/** Runs a model that streams partial output. */
	stream<Output = ModelData, Input = ModelData>(
		model: string,
		options: RunOptions<Input>,
	): Promise<ModelStream<Output>>;
	/** Submit jobs and collect them later, by request id. */
	readonly queue: Queue;
	/** Upload local files for use as model input. */
	readonly storage: Storage;
}

async function run<Output, Input>(
	model: string,
	{ input, abortSignal }: RunOptions<Input>,
): Promise<Result<Output>> {
	return gatewayJson<Output>({
		service: "run",
		path: model,
		body: (await storage.transformInput(input)) ?? {},
		signal: abortSignal,
	});
}

export const ai: Ai = {
	config(options) {
		setApiKey(options.apiKey);
	},
	run,
	subscribe,
	stream,
	queue,
	storage,
};

export {
	ApiError,
	ValidationError,
	type ValidationErrorInfo,
} from "./errors.js";
export type { Queue, WaitOptions } from "./queue.js";
export type { Storage } from "./storage.js";
export type { ModelStream } from "./stream.js";
export { FRAMEFIELDS_AI_PROXY_URL } from "./transport.js";
export type {
	CompletedQueueStatus,
	InProgressQueueStatus,
	InQueueQueueStatus,
	ModelData,
	QueueStatus,
	RequestLog,
	RequestOptions,
	Result,
	RunOptions,
	StatusOptions,
	SubmitOptions,
	SubscribeOptions,
} from "./types.js";
