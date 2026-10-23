import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type AnimatableNode,
	type Fps,
	type FrameIndex,
	fps,
	frame,
	type HandleId,
	type HandleLabel,
	handleId,
	handleLabel,
	isFrameIndex,
	isNormalized,
	Layer,
	type MediaNode,
	type Milliseconds,
	ms,
	type NodeId,
	type Normalized,
	nodeId,
	normalized,
	type Seconds,
	type SectionOptions,
	seconds,
	Vignette,
} from "./index.js";

describe("Type Safety & Branded Types (Phase 1)", () => {
	it("re-exports all branded types and assertion helpers from core", () => {
		const f = frame(48);
		expect(f).toBe(48);
		expectTypeOf(f).toEqualTypeOf<FrameIndex>();

		const s = seconds(2.5);
		expect(s).toBe(2.5);
		expectTypeOf(s).toEqualTypeOf<Seconds>();

		const m = ms(100);
		expect(m).toBe(100);
		expectTypeOf(m).toEqualTypeOf<Milliseconds>();

		const rate = fps(30);
		expect(rate).toBe(30);
		expectTypeOf(rate).toEqualTypeOf<Fps>();

		const norm = normalized(0.8);
		expect(norm).toBe(0.8);
		expectTypeOf(norm).toEqualTypeOf<Normalized>();

		const hid = handleId("video-input-1");
		expect(hid).toBe("video-input-1");
		expectTypeOf(hid).toEqualTypeOf<HandleId>();

		const hlbl = handleLabel("Video Stream");
		expect(hlbl).toBe("Video Stream");
		expectTypeOf(hlbl).toEqualTypeOf<HandleLabel>();

		const nid = nodeId("hero-card");
		expect(nid).toBe("hero-card");
		expectTypeOf(nid).toEqualTypeOf<NodeId>();

		expect(isFrameIndex(10)).toBe(true);
		expect(isNormalized(0.5)).toBe(true);
	});

	it("enforces strict SectionOptions without unknown index signature", () => {
		const validOptions: SectionOptions = {
			id: "tracked-section",
			position: "absolute",
			padding: 10,
			opacity: 0.9,
			width: 1920,
			height: 1080,
			compositionWidth: 1920,
			compositionHeight: 1080,
			effects: [new Vignette({ strength: 20 })],
		};

		expect(validOptions.id).toBe("tracked-section");
		expect(validOptions.padding).toBe(10);

		type SectionOptionsKeys = keyof SectionOptions;
		expectTypeOf<"padding">().toMatchTypeOf<SectionOptionsKeys>();
		expectTypeOf<"opacity">().toMatchTypeOf<SectionOptionsKeys>();
		expectTypeOf<"effects">().toMatchTypeOf<SectionOptionsKeys>();
		expectTypeOf<"compositionWidth">().toMatchTypeOf<SectionOptionsKeys>();
	});

	it("preserves typed AnimatableNode without index signature", () => {
		const video = Layer.video("sample.mp4");
		expectTypeOf(video).toMatchTypeOf<AnimatableNode<MediaNode>>();

		// Verify apply method accepts typed Effect instances
		const withEff = video.apply(new Vignette({ strength: 10 }));
		expectTypeOf(withEff).toMatchTypeOf<AnimatableNode<MediaNode>>();
	});
});
