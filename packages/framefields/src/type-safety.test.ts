import {
	CompositorProgramSchema,
	EffectSpecSchema,
} from "@framefields/compositions/program";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type AnimatableNode,
	type AnyAudioEffect,
	type AnyEffect,
	type AnyVisualEffect,
	AudioCompressor,
	AudioDelay,
	Blur,
	type CompatibleEffect,
	FilmGrain,
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
	Levels,
	type MediaNode,
	type Milliseconds,
	ms,
	type NodeCapability,
	type NodeId,
	type NodeOperation,
	type Normalized,
	nodeId,
	normalized,
	type Seconds,
	type SectionOptions,
	seconds,
	Vignette,
	type VirtualMediaData,
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
		expectTypeOf(video).toMatchTypeOf<AnimatableNode<MediaNode, "hybrid">>();

		// Verify apply method accepts typed Effect instances
		const withEff = video.apply(new Vignette({ strength: 10 }));
		expectTypeOf(withEff).toMatchTypeOf<AnimatableNode<MediaNode, "hybrid">>();
	});
});

describe("Discriminated Effects & Port Capabilities (Phase 2)", () => {
	it("distinguishes visual and audio effects by op and domain", () => {
		const blur = new Blur({ strength: 10 });
		expect(blur.op).toBe("Blur");
		expect(blur.domain).toBe("visual");
		expectTypeOf(blur.op).toEqualTypeOf<"Blur">();
		expectTypeOf(blur.domain).toEqualTypeOf<"visual">();

		const compressor = new AudioCompressor({ threshold: -18 });
		expect(compressor.op).toBe("AudioCompressor");
		expect(compressor.domain).toBe("audio");
		expectTypeOf(compressor.op).toEqualTypeOf<"AudioCompressor">();
		expectTypeOf(compressor.domain).toEqualTypeOf<"audio">();

		const levels = new Levels();
		expect(levels.op).toBe("Levels");
		expect(levels.domain).toBe("visual");
		expectTypeOf(levels.op).toEqualTypeOf<"Levels">();
		expectTypeOf(levels.domain).toEqualTypeOf<"visual">();
	});

	it("narrows effect instances within AnyEffect discriminated union", () => {
		const effect: AnyEffect = new AudioDelay({ delayTime: 0.12 });

		if (effect.domain === "audio") {
			expectTypeOf(effect).toMatchTypeOf<AnyAudioEffect>();
		} else {
			expectTypeOf(effect).toMatchTypeOf<AnyVisualEffect>();
		}

		if (effect.op === "AudioDelay") {
			expect(effect.delayTime).toBe(0.12);
		}
	});

	it("enforces capability-safe apply on layers", () => {
		expectTypeOf<NodeCapability>().toEqualTypeOf<
			"visual" | "audio" | "hybrid"
		>();

		const audioLayer = Layer.audio("soundtrack.mp3");
		expectTypeOf<Parameters<typeof audioLayer.apply>[0]>().toEqualTypeOf<
			CompatibleEffect<"audio">
		>();

		const imageLayer = Layer.image("banner.png");
		expectTypeOf<Parameters<typeof imageLayer.apply>[0]>().toEqualTypeOf<
			CompatibleEffect<"visual">
		>();

		const videoLayer = Layer.video("clip.mp4");
		expectTypeOf<Parameters<typeof videoLayer.apply>[0]>().toEqualTypeOf<
			CompatibleEffect<"hybrid">
		>();

		// Video accepts both visual and audio effects
		const v1 = videoLayer.apply(new Blur({ strength: 5 }));
		const v2 = v1.apply(new AudioCompressor({ threshold: -12 }));
		expect(v2.effects?.length).toBe(2);

		// Audio accepts audio effects
		const a1 = audioLayer.apply(new AudioCompressor());
		const a2 = a1.apply(new AudioDelay({ delayTime: 0.05 }));
		expect(a2.effects?.length).toBe(2);

		// Image accepts visual effects
		const img1 = imageLayer.apply(new FilmGrain({ strength: 10 }));
		const img2 = img1.apply(new Vignette({ strength: 40 }));
		expect(img2.effects?.length).toBe(2);
	});
});

describe("Schema & Pipeline Unification (Phase 3)", () => {
	it("strongly types NodeOperation from effect toOperation", () => {
		const blur = new Blur({ strength: 10 });
		const op = blur.toOperation();

		expect(op.op).toBe("Blur");
		expectTypeOf(op.op).toEqualTypeOf<"Blur">();
		expectTypeOf(op).toMatchTypeOf<NodeOperation<"Blur">>();
	});

	it("validates effects via EffectSpecSchema and CompositorProgramSchema", () => {
		// Valid Effect class instance
		const effectInstance = new FilmGrain({ strength: 12 });
		expect(EffectSpecSchema.safeParse(effectInstance).success).toBe(true);

		// Valid plain effect spec object
		const plainSpec = { op: "Blur", strength: 8 };
		expect(EffectSpecSchema.safeParse(plainSpec).success).toBe(true);

		// Invalid effect without op
		const invalidSpec = { strength: 8 };
		expect(EffectSpecSchema.safeParse(invalidSpec).success).toBe(false);

		// Valid compositor program with effects
		const programWithEffects = {
			width: 1920,
			height: 1080,
			fps: 30,
			layout: [
				{
					id: "hero",
					kind: "box",
					effects: [plainSpec, effectInstance],
				},
			],
			effects: [plainSpec],
		};
		expect(CompositorProgramSchema.safeParse(programWithEffects).success).toBe(
			true,
		);

		// Invalid compositor program with invalid effect
		const programWithBadEffect = {
			width: 1920,
			height: 1080,
			fps: 30,
			layout: [
				{
					id: "hero",
					kind: "box",
					effects: [invalidSpec],
				},
			],
		};
		expect(
			CompositorProgramSchema.safeParse(programWithBadEffect).success,
		).toBe(false);
	});

	it("propagates typed operations in VirtualMediaData without any", () => {
		type BlurMedia = VirtualMediaData<
			NodeOperation<"Blur", { strength: number }>
		>;
		expectTypeOf<BlurMedia["operation"]["op"]>().toEqualTypeOf<"Blur">();
		expectTypeOf<BlurMedia["operation"]["strength"]>().toEqualTypeOf<number>();
	});
});
