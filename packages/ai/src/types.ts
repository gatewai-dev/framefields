/** Model input or output when its shape isn't declared. Pass a type argument to name it. */
export type ModelData = Record<string, unknown>;

/** What a finished call returns: the model's output and the gateway's id for the request. */
export interface Result<Output = ModelData> {
	data: Output;
	requestId: string;
}

export interface RunOptions<Input = ModelData> {
	/** The model input. `Blob`s anywhere in it are uploaded first and replaced by URLs. */
	readonly input?: Input;
	/** Stops waiting. A queued job keeps running; cancel it with `ai.queue.cancel`. */
	readonly abortSignal?: AbortSignal;
}

export interface RequestLog {
	message: string;
	level?: string;
	source?: string;
	timestamp: string;
}

export interface Metrics {
	inference_time: number | null;
}

interface BaseQueueStatus {
	status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
	request_id: string;
}

export interface InQueueQueueStatus extends BaseQueueStatus {
	status: "IN_QUEUE";
	queue_position: number;
}

export interface InProgressQueueStatus extends BaseQueueStatus {
	status: "IN_PROGRESS";
	logs: RequestLog[];
}

export interface CompletedQueueStatus extends BaseQueueStatus {
	status: "COMPLETED";
	logs: RequestLog[];
	metrics?: Metrics;
}

export type QueueStatus =
	| InQueueQueueStatus
	| InProgressQueueStatus
	| CompletedQueueStatus;

export type SubmitOptions<Input = ModelData> = RunOptions<Input>;

export interface RequestOptions {
	/** The `request_id` returned by `ai.queue.submit`. */
	readonly requestId: string;
	readonly abortSignal?: AbortSignal;
}

export interface StatusOptions extends RequestOptions {
	/** Include the model's log lines in the status. */
	readonly logs?: boolean;
}

export interface SubscribeOptions<Input = ModelData>
	extends SubmitOptions<Input> {
	/** Milliseconds between status checks. Default 500. */
	readonly pollInterval?: number;
	/** Include the model's log lines in each `onQueueUpdate`. */
	readonly logs?: boolean;
	/** Called once with the request id, as soon as the job is queued. */
	readonly onEnqueue?: (requestId: string) => void;
	/** Called after every status check. */
	readonly onQueueUpdate?: (status: QueueStatus) => void;
}
