/** One field a model rejected: where (`loc`), why (`msg`) and the rule (`type`). */
export interface ValidationErrorInfo {
	msg: string;
	loc: Array<string | number>;
	type: string;
}

export interface ApiErrorArgs {
	message: string;
	status: number;
	body?: unknown;
	requestId?: string;
	type?: string;
}

/**
 * A non-2xx answer from the gateway or the model. `type` is the gateway's error code
 * (`insufficient_credits`, `rate_limited`, `key_limit_reached`, …) when the gateway refused
 * the call; it is unset when the model itself failed.
 */
export class ApiError<Body = unknown> extends Error {
	readonly status: number;
	readonly body: Body;
	readonly requestId: string;
	readonly type?: string;

	constructor({ message, status, body, requestId, type }: ApiErrorArgs) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.body = body as Body;
		this.requestId = requestId ?? "";
		this.type = type;
	}
}

export interface ValidationErrorBody {
	detail: ValidationErrorInfo[];
}

/** A `422`: the input did not match the model's schema. `fieldErrors` says which fields. */
export class ValidationError extends ApiError<ValidationErrorBody> {
	constructor(args: ApiErrorArgs) {
		super(args);
		this.name = "ValidationError";
	}

	get fieldErrors(): ValidationErrorInfo[] {
		return Array.isArray(this.body?.detail) ? this.body.detail : [];
	}

	getFieldErrors(field: string): ValidationErrorInfo[] {
		return this.fieldErrors.filter((e) => e.loc[e.loc.length - 1] === field);
	}
}

interface ErrorBody {
	error?: { type?: string; message?: string };
	detail?: unknown;
	message?: unknown;
}

function messageOf(body: ErrorBody | undefined, fallback: string): string {
	if (body?.error?.message) return body.error.message;
	if (typeof body?.detail === "string") return body.detail;
	if (Array.isArray(body?.detail)) {
		const first = body.detail[0] as Partial<ValidationErrorInfo> | undefined;
		if (first?.msg) return `${first.msg} (${(first.loc ?? []).join(".")})`;
	}
	if (typeof body?.message === "string") return body.message;
	return fallback;
}

/** Builds the error for a failed response; the body is read here, once. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
	const text = await response.text().catch(() => "");
	let body: unknown = text || undefined;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {}
	const parsed =
		typeof body === "object" && body !== null ? (body as ErrorBody) : undefined;
	const args: ApiErrorArgs = {
		message: messageOf(
			parsed,
			`${response.status} ${response.statusText}`.trim(),
		),
		status: response.status,
		body,
		requestId: response.headers.get("x-framefields-request-id") ?? undefined,
		type: parsed?.error?.type,
	};
	return response.status === 422 && Array.isArray(parsed?.detail)
		? new ValidationError(args)
		: new ApiError(args);
}
