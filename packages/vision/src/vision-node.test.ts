import { describe, expect, it } from "vitest";
import { fakeStore, ScriptedProvider } from "./test-support.js";
import { enabledTasks, VisionNode } from "./vision-node.js";

describe("VisionNode (lazy + composition AST)", () => {
	it("constructor performs zero I/O and creates the signals bundle", () => {
		const node = new VisionNode("https://example.test/video.mp4", {
			enableDetection: true,
			enablePose: true,
		});
		expect(node.kind).toBe("vision");
		expect(node.config.enableDetection).toBe(true);
		expect(node.vision.objects).toBeDefined();
		expect(node.vision.poseLandmarks).toBeDefined();
		// runner not created until demanded
		expect(node["_runner"]).toBeUndefined();
	});

	it("toNode() + attach() produce a composition-ready AST with the same identity", () => {
		const node = new VisionNode("clip.mp4", { enableSegmentation: true });
		const ast = node.toNode();
		expect(ast.kind).toBe("vision");
		expect(ast.source).toBe("clip.mp4");
		expect(ast.config.enableSegmentation).toBe(true);

		const attached = VisionNode.attach("clip.mp4", {
			enableSegmentation: true,
		});
		expect(attached.node.kind).toBe("vision");
		expect(attached.node.source).toBe("clip.mp4");
		expect(typeof attached.ready).toBe("function");
		expect(typeof attached.runner).toBe("function");
		expect(typeof attached.close).toBe("function");
	});

	it("enabledTasks() defaults to detection", () => {
		expect(enabledTasks({})).toEqual(["detect"]);
		expect(enabledTasks({ enablePose: true, enableMatte: true })).toEqual([
			"pose",
			"matte",
		]);
	});

	it("ready() preloads only the enabled tasks' models", async () => {
		const { store, fetches } = fakeStore();
		const provider = new ScriptedProvider([]);
		const node = new VisionNode(
			"clip.mp4",
			{ enablePose: true, variant: "t" },
			{},
			{ provider, store },
		);
		const runner = await node.ready();
		expect(fetches).toHaveLength(1); // only the pose model
		expect(provider.created).toHaveLength(1);
		expect(runner.downloadStatus.get("rtmo-t")).toBe("ready");
		expect(runner.downloadStatus.get("rtmdet-ins-t")).toBe("pending");
		node.close();
		expect(node["_runner"]).toBeUndefined();
	});
});
