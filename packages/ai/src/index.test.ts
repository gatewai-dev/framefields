import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	ai,
	FRAMEFIELDS_AI_PROXY_URL,
	type QueueStatus,
	ValidationError,
} from "./index.js";

interface Call {
	url: string;
	method: string;
	target: string | null;
	headers: Headers;
	body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

const calls: Call[] = [];
let handler: Handler;

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...init.headers },
	});

async function readBody(init: RequestInit): Promise<unknown> {
	if (typeof init.body === "string") return JSON.parse(init.body);
	return init.body;
}

beforeEach(() => {
	ai.config({ apiKey: "ff_test_123" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit = {}) => {
			const headers = new Headers(init.headers);
			const call: Call = {
				url,
				method: init.method ?? "GET",
				target: headers.get("x-framefields-target"),
				headers,
				body: await readBody(init),
			};
			calls.push(call);
			return handler(call);
		}),
	);
});

afterEach(() => {
	calls.length = 0;
	ai.config({ apiKey: undefined });
	delete process.env.FRAMEFIELDS_API_KEY;
	vi.unstubAllGlobals();
});

describe("ai.run", () => {
	it("sends one call to the gateway, naming the target in our own header", async () => {
		handler = () =>
			json(
				{ images: [{ url: "u" }] },
				{ headers: { "x-framefields-request-id": "req_1" } },
			);
		const result = await ai.run<{ images: { url: string }[] }>("flux/schnell", {
			input: { prompt: "x" },
		});
		expect(result).toEqual({
			data: { images: [{ url: "u" }] },
			requestId: "req_1",
		});
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call.url).toBe(FRAMEFIELDS_AI_PROXY_URL);
		expect(call.method).toBe("POST");
		expect(call.target).toBe("run/flux/schnell");
		expect(call.body).toEqual({ prompt: "x" });
		expect(call.headers.get("authorization")).toBe("Key ff_test_123");
		expect([...call.headers.keys()].sort()).toEqual([
			"accept",
			"authorization",
			"content-type",
			"x-framefields-target",
		]);
	});

	it("works with fal-ai/ prefixed model names as well as short model names", async () => {
		handler = () => json({ ok: true });
		await ai.run("fal-ai/flux/schnell", { input: { prompt: "hi" } });
		expect(calls[0].target).toBe("run/fal-ai/flux/schnell");
	});

	it("reads FRAMEFIELDS_API_KEY from the environment", async () => {
		ai.config({ apiKey: undefined });
		process.env.FRAMEFIELDS_API_KEY = "ff_env";
		handler = () => json({});
		await ai.run("flux/schnell", { input: { prompt: "x" } });
		expect(calls[0].headers.get("authorization")).toBe("Key ff_env");
	});

	it("fails before any request when no key is set", async () => {
		ai.config({ apiKey: undefined });
		await expect(ai.run("flux/schnell", { input: {} })).rejects.toThrow(
			/FRAMEFIELDS_API_KEY/,
		);
		expect(calls).toHaveLength(0);
	});
});

describe("errors", () => {
	it("exposes the gateway's error type", async () => {
		handler = () =>
			json(
				{
					error: {
						type: "insufficient_credits",
						message: "Insufficient credits",
					},
				},
				{ status: 402 },
			);
		const err = await ai.run("flux/schnell", { input: {} }).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(402);
		expect(err.type).toBe("insufficient_credits");
		expect(err.message).toBe("Insufficient credits");
	});

	it("turns a 422 with field details into a ValidationError", async () => {
		handler = () =>
			json(
				{
					detail: [
						{ loc: ["body", "prompt"], msg: "field required", type: "missing" },
					],
				},
				{ status: 422 },
			);
		const err = await ai.run("flux/schnell", { input: {} }).catch((e) => e);
		expect(err).toBeInstanceOf(ValidationError);
		expect(err.getFieldErrors("prompt")).toHaveLength(1);
		expect(err.message).toBe("field required (body.prompt)");
	});
});

describe("ai.subscribe", () => {
	it("submits, polls until completed, then fetches the result", async () => {
		const statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
		handler = ({ target }) => {
			if (target === "queue/flux/schnell") {
				return json({
					status: "IN_QUEUE",
					request_id: "r1",
					queue_position: 0,
				});
			}
			if (target?.startsWith("queue/flux/schnell/requests/r1/status")) {
				return json({ status: statuses.shift(), request_id: "r1", logs: [] });
			}
			if (target === "queue/flux/schnell/requests/r1")
				return json({ ok: true });
			return json({}, { status: 404 });
		};
		const updates: QueueStatus["status"][] = [];
		const onEnqueue = vi.fn();
		const result = await ai.subscribe("flux/schnell", {
			input: { prompt: "x" },
			pollInterval: 1,
			logs: true,
			onEnqueue,
			onQueueUpdate: (s) => updates.push(s.status),
		});
		expect(result).toEqual({ data: { ok: true }, requestId: "r1" });
		expect(onEnqueue).toHaveBeenCalledWith("r1");
		expect(updates).toEqual(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]);
		expect(calls[1].target).toBe(
			"queue/flux/schnell/requests/r1/status?logs=1",
		);
	});

	it("retries a status check that hit a transient error", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout"] });
		let failures = 1;
		handler = () =>
			failures-- > 0
				? json(
						{ error: { type: "upstream_error", message: "busy" } },
						{ status: 503 },
					)
				: json({ status: "COMPLETED", request_id: "r1", logs: [] });
		const pending = ai.queue.status("flux/schnell", { requestId: "r1" });
		await vi.runAllTimersAsync();
		await expect(pending).resolves.toMatchObject({ status: "COMPLETED" });
		expect(calls).toHaveLength(2);
		vi.useRealTimers();
	});

	it("cancels with PUT", async () => {
		handler = () => json({ status: "CANCELLATION_REQUESTED" });
		await ai.queue.cancel("flux/schnell", { requestId: "r1" });
		expect(calls[0]).toMatchObject({
			method: "PUT",
			target: "queue/flux/schnell/requests/r1/cancel",
		});
	});
});

describe("ai.storage", () => {
	it("uploads Blobs found in the input and passes their URLs", async () => {
		handler = ({ target, url }) => {
			if (target === "storage/upload/initiate") {
				return json({
					upload_url: "https://upload.test/put",
					file_url: "https://cdn.test/a.png",
				});
			}
			if (url === "https://upload.test/put")
				return new Response(null, { status: 200 });
			return json({ done: true });
		};
		const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
		await ai.run("upscale", { input: { images: [{ image }], scale: 2 } });

		expect(calls.map((c) => c.target ?? c.url)).toEqual([
			"storage/upload/initiate",
			"https://upload.test/put",
			"run/upscale",
		]);
		expect(calls[0].body).toMatchObject({ content_type: "image/png" });
		expect(calls[1].headers.get("authorization")).toBeNull();
		expect(calls[2].body).toEqual({
			images: [{ image: "https://cdn.test/a.png" }],
			scale: 2,
		});
	});
});

describe("ai.stream", () => {
	it("yields each event across chunk boundaries and resolves done() with the last", async () => {
		const encoder = new TextEncoder();
		const chunks = [
			'data: {"n":1}\n\nda',
			'ta: {"n":2}\r\n\r\n',
			'data: {"n":3}\n\n',
		];
		handler = () =>
			new Response(
				new ReadableStream({
					start(controller) {
						for (const c of chunks) controller.enqueue(encoder.encode(c));
						controller.close();
					},
				}),
				{
					headers: {
						"content-type": "text/event-stream",
						"x-framefields-request-id": "s1",
					},
				},
			);
		const stream = await ai.stream<{ n: number }>("chat", {
			input: { prompt: "x" },
		});
		expect(calls[0]).toMatchObject({
			target: "run/chat/stream",
			method: "POST",
		});
		expect(calls[0].headers.get("accept")).toBe("text/event-stream");
		expect(stream.requestId).toBe("s1");

		const seen: number[] = [];
		for await (const event of stream) {
			seen.push(event.n);
			if (event.n === 2) break;
		}
		expect(seen).toEqual([1, 2]);
		await expect(stream.done()).resolves.toEqual({ n: 2 });
	});
});
