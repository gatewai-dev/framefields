import { Composition } from "gitframes";
import { describe, expect, it } from "vitest";
import { H, INK, registerFonts, W } from "../theme.js";
import { trackScene } from "./track.js";

describe("Example 19: Chapter 05 'Track it.' Scene", () => {
	it("assembles scene with neural tracking, ground perspective pulses, and pinned spatial elements", async () => {
		await registerFonts();

		const sceneNode = trackScene({ from: 0, to: 144 });
		expect(sceneNode).toBeDefined();
		expect(sceneNode.id).toBe("track");
		expect(sceneNode.children?.length).toBeGreaterThanOrEqual(6);

		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 144,
			backgroundColor: INK,
		});
		comp.add(sceneNode);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");
	});

	it("renders headless frame snapshot successfully", async () => {
		await registerFonts();

		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 60,
			backgroundColor: INK,
		});
		comp.add(trackScene({ from: 0, to: 60 }));

		const pngBuf = await comp.renderFrame({ frame: 12 });
		expect(pngBuf).toBeInstanceOf(Buffer);
		expect(pngBuf.length).toBeGreaterThan(0);
		// PNG magic header [0x89, 'P', 'N', 'G']
		expect(pngBuf[0]).toBe(0x89);
		expect(pngBuf[1]).toBe(0x50);
		expect(pngBuf[2]).toBe(0x4e);
		expect(pngBuf[3]).toBe(0x47);
	}, 30000);
});
