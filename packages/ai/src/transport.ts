import { errorFromResponse } from "./errors.js";

/** The framefields AI gateway. Every request goes here, authenticated with a framefields key. */
export const FRAMEFIELDS_AI_PROXY_URL =
	"https://api.framefields.dev/v1/ai/proxy";

/** The gateway service a call goes to: model runs, the job queue, or file storage. */
export type Service = "run" | "queue" | "storage";

export interface GatewayRequest {
	service: Service;
	/** Path under the service, e.g. `seedance/2.5` or `seedance/2.5/requests/<id>/status`. */
	path: string;
	method?: "GET" | "POST" | "PUT";
	body?: unknown;
	accept?: string;
	query?: Record<string, string | undefined>;
	signal?: AbortSignal;
}

let configuredKey: string | undefined;

const env = (name: string): string | undefined =>
	typeof process !== "undefined" ? process.env?.[name] : undefined;

export function setApiKey(key: string | undefined): void {
	configuredKey = key;
}

function apiKey(): string {
	const key = configuredKey ?? env("FRAMEFIELDS_API_KEY");
	if (!key) {
		throw new Error(
			"framefields ai: no API key. Set FRAMEFIELDS_API_KEY or call ai.config({ apiKey }). " +
				"Create a key at https://framefields.dev/dashboard/keys",
		);
	}
	return key;
}

function targetOf({ service, path, query }: GatewayRequest): string {
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined) params.set(name, value);
	}
	const search = params.size ? `?${params}` : "";
	return `${service}/${path.replace(/^\/+/, "")}${search}`;
}

/**
 * Sends one call through the gateway and returns the response, or throws `ApiError` /
 * `ValidationError` for a non-2xx answer. The key is checked before anything is sent.
 */
export async function gatewayFetch(request: GatewayRequest): Promise<Response> {
	const headers: Record<string, string> = {
		Authorization: `Key ${apiKey()}`,
		Accept: request.accept ?? "application/json",
		"x-framefields-target": targetOf(request),
	};
	const hasBody = request.body !== undefined;
	if (hasBody) headers["Content-Type"] = "application/json";
	const response = await fetch(
		env("FRAMEFIELDS_AI_PROXY_URL") ?? FRAMEFIELDS_AI_PROXY_URL,
		{
			method: request.method ?? (hasBody ? "POST" : "GET"),
			headers,
			body: hasBody ? JSON.stringify(request.body) : undefined,
			signal: request.signal,
		},
	);
	if (!response.ok) throw await errorFromResponse(response);
	return response;
}

/** `gatewayFetch` for JSON answers, with the gateway's request id alongside. */
export async function gatewayJson<T>(
	request: GatewayRequest,
): Promise<{ data: T; requestId: string }> {
	const response = await gatewayFetch(request);
	const data = (await response.json()) as T;
	return {
		data,
		requestId: response.headers.get("x-framefields-request-id") ?? "",
	};
}
