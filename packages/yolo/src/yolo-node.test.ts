import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	SessionProvider,
	YoloSession,
	YoloTensorInput,
} from "./runtime/session-provider.js";
import { YoloNode } from "./yolo-node.js";

/** Minimal fake session provider — keeps the node test fully offline. */
class FakeProvider implements SessionProvider {
	public readonly kind = "node" as const;
	public created = 0;
	async createSession(): Promise<YoloSession> {
		this.created++;
		return {
			run: async (_input: YoloTensorInput) => ({
				output0: { data: new Float32Array(0), dims: [1, 5, 0] },
			}),
			release: async () => {},
		};
	}
}

describe("YoloNode (lazy + composition AST)", () => {
	it("constructor performs zero I/O and creates the signals bundle", () => {
		const node = new YoloNode("https://example.test/video.mp4", {
			enableDetection: true,
			enablePose: true,
		});
		expect(node.kind).toBe("yolo");
		expect(node.config.enableDetection).toBe(true);
		expect(node.vision).toBeDefined();
		expect(node.vision.objects).toBeDefined();
		expect(node.vision.poseLandmarks).toBeDefined();
		// runner not created until demanded
		expect(node["_runner"]).toBeUndefined();
	});

	it("toNode() + attach() produce a composition-ready AST with the same identity", () => {
		const node = new YoloNode("clip.mp4", { enableSegmentation: true });
		const ast = node.toNode();
		expect(ast.kind).toBe("yolo");
		expect(ast.source).toBe("clip.mp4");
		expect(ast.config.enableSegmentation).toBe(true);

		const attached = YoloNode.attach("clip.mp4", { enableSegmentation: true });
		expect(attached.node.kind).toBe("yolo");
		expect(attached.node.source).toBe("clip.mp4");
		// lazy helpers are exposed on the bundle
		expect(typeof (attached as unknown as { ready?: unknown }).ready).toBe(
			"function",
		);
		expect(typeof (attached as unknown as { runner?: unknown }).runner).toBe(
			"function",
		);
	});

	it("ready() preloads only the enabled tasks' models", async () => {
		const provider = new FakeProvider();
		const node = new YoloNode(
			"clip.mp4",
			{ enablePose: true }, // only pose
			{},
			{ provider, modelsDir: mkdtempSync(join(tmpdir(), "yolo-node-")) },
		);
		let fetches = 0;
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			fetches++;
			return new Response(new Uint8Array(4096));
		}) as typeof fetch;
		try {
			const runner = await node.ready();
			expect(fetches).toBe(1); // only the pose model
			expect(provider.created).toBe(1);
			expect(runner.downloadStatus.get("yolo11n-pose")).toBe("ready");
			expect(runner.downloadStatus.get("yolo11n")).toBe("pending");
			node.close();
			expect(node["_runner"]).toBeUndefined();
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
