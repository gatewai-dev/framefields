import {
	mediaSourceTime,
	type ResolvedMediaTimeRemap,
	Signal,
	type VirtualMediaData,
} from "@framefields/core";
import { describe, expect, it } from "vitest";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";
import {
	collectLayersOnClock,
	compositorToProgram,
	isScene3D,
} from "./to-virtual-media.js";

const doc = {
	width: 1920,
	height: 1080,
	fps: 30,
	backgroundColor: "#101014",
	mode: "Video",
	layout: [
		{
			id: "hero",
			kind: "flex",
			dir: "column",
			gap: 24,
			children: [
				{ id: "title", kind: "text", text: "Big Title", fontSize: 96 },
				{
					id: "badges",
					kind: "flex",
					dir: "row",
					gap: 16,
					children: [
						{ id: "avatarImg", kind: "media", inputHandleId: "h_avatar" },
						{ id: "heroImg", kind: "media", inputHandleId: "h_hero" },
					],
				},
			],
		},
	],
} as unknown as CompositorProgramConfig;

const mediaVM = (id: string): VirtualMediaData =>
	({
		metadata: { width: 100, height: 100, durationMs: 2000 },
		operation: { op: "source", dataType: "Image", source: { entity: { id } } },
		children: [],
	}) as unknown as VirtualMediaData;

describe("compositorToProgram", () => {
	it("preserves the remapped layer duration when the resolved source is shorter", () => {
		const video = {
			metadata: { durationMs: 1000 },
			operation: { op: "source", dataType: "Video" },
			children: [],
		} as unknown as VirtualMediaData;
		const config = {
			width: 64,
			height: 64,
			fps: 30,
			mode: "Video",
			layout: [
				{
					id: "slow",
					kind: "media",
					inputHandleId: "source",
					dataType: "Video",
					durationFrames: 60,
					timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
				},
			],
		} as unknown as CompositorProgramConfig;
		const vm = compositorToProgram(config, {
			isVideoMode: true,
			fps: 30,
			resolveMedia: () => video,
		});
		expect(vm.children[0].operation.durationFrames).toBe(60);
		expect(vm.children[0].metadata.durationMs).toBe(2000);
	});
	it("resolves signal time remaps on the composition clock", () => {
		const video = {
			metadata: { durationMs: 10000 },
			operation: { op: "source", dataType: "Video" },
			children: [],
		} as unknown as VirtualMediaData;
		const layer = (timeRemap: unknown) => ({
			width: 64,
			height: 64,
			fps: 4,
			mode: "Video",
			layout: [
				{
					id: "wrap",
					kind: "box",
					startFrame: 2,
					children: [
						{
							id: "clip",
							kind: "media",
							inputHandleId: "source",
							dataType: "Video",
							startFrame: 1,
							durationFrames: 4,
							timeRemap,
						},
					],
				},
			],
		});
		const remapOf = (vm: VirtualMediaData) =>
			(
				vm.children[0].children[0].operation as unknown as {
					timeRemap: ResolvedMediaTimeRemap;
				}
			).timeRemap;
		const options = {
			isVideoMode: true,
			fps: 4,
			durationMs: 2500,
			resolveMedia: () => video,
		};
		const instance = compositorToProgram(
			layer({
				kind: "signal",
				mode: "source-time",
				signal: Signal.builder({ type: "custom", fn: (ctx) => ctx.time }),
			}) as unknown as CompositorProgramConfig,
			options,
		);
		// The layer starts at composition frame 3: its frame 1 reads frame 4.
		expect(mediaSourceTime(remapOf(instance), 1, 4)).toBe(1);
		const named = compositorToProgram(
			layer({
				kind: "signal",
				mode: "speed",
				signal: "pace",
				sourceStartSec: 2,
			}) as unknown as CompositorProgramConfig,
			{ ...options, signals: { pace: [0, 0, 0, 2, 2, 2, 2, 2] } },
		);
		expect(mediaSourceTime(remapOf(named), 4, 4)).toBe(4);
		expect(() =>
			compositorToProgram(
				layer({
					kind: "signal",
					mode: "speed",
					signal: "missing",
				}) as unknown as CompositorProgramConfig,
				options,
			),
		).toThrow(/not a composition signal/);
		expect(() =>
			compositorToProgram(
				layer({
					kind: "signal",
					mode: "source-time",
					signal: "pace",
					sourceStartSec: 1,
				}) as unknown as CompositorProgramConfig,
				{ ...options, signals: { pace: [0] } },
			),
		).toThrow(/only to speed signals/);
	});
	it("builds the render tree 1:1 from the document", () => {
		const vm = compositorToProgram(doc, { isVideoMode: true, fps: 30 });
		const op = vm.operation as any;
		expect(op.op).toBe("Compositor");
		expect(op.width).toBe(1920);
		expect(op.layout).toEqual(doc.layout); // doc embedded verbatim (debug-only snapshot, L7)
		expect(op.volume).toBe(1); // master gain always carried on the root op (L1)
		expect(vm.children).toHaveLength(1);

		const hero = vm.children![0];
		expect((hero.operation as any).op).toBe("CompositorLayer");
		expect((hero.operation as any).kind).toBe("flex");
		expect(hero.children).toHaveLength(2);
		expect((hero.children![1].operation as any).kind).toBe("flex");
	});

	it("binds media nodes to resolved graph sources", () => {
		const vm = compositorToProgram(doc, {
			isVideoMode: true,
			fps: 30,
			resolveMedia: (handleId) =>
				handleId === "h_avatar" ? mediaVM("avatar") : undefined,
		});
		const badges = vm.children![0].children![1];
		const avatar = badges.children![0];
		expect(avatar.children).toHaveLength(1);
		expect((avatar.children![0].operation as any).source.entity.id).toBe(
			"avatar",
		);
		// unresolved media keeps no content child — renderer skips it
		const heroImg = badges.children![1];
		expect(heroImg.children).toHaveLength(0);
	});

	it("carries animation tracks and timing on the node ops", () => {
		const heroNode: LayoutNode = {
			...doc.layout[0],
			animation: {
				tracks: [
					{
						id: "t1",
						prop: "opacity",
						keyframes: [
							{ id: "k1", frame: 0, value: 0 },
							{ id: "k2", frame: 15, value: 1 },
						],
					},
				],
			},
		};
		const vm = compositorToProgram(
			{ ...doc, layout: [heroNode] },
			{ isVideoMode: true, fps: 30 },
		);
		const heroOp = vm.children![0].operation as any;
		expect(heroOp.animation.tracks[0].prop).toBe("opacity");
	});

	it("converts kind: 'shape' nodes into CompositorLayer operations with all vector properties", () => {
		const shapeNode: LayoutNode = {
			id: "star-1",
			kind: "shape",
			shapeType: "star",
			starPoints: 5,
			starInnerRadiusRatio: 0.4,
			width: 250,
			height: 250,
			fillType: "solid",
			fillColor: "#e11d48",
			strokeColor: "#ffffff",
			strokeWidth: 6,
			trimStart: 0.1,
			trimEnd: 0.85,
			trimOffset: 90,
			startFrame: 0,
			durationFrames: 60,
		};

		const vm = compositorToProgram(
			{ ...doc, layout: [shapeNode] },
			{ isVideoMode: true, fps: 30 },
		);

		expect(vm.children).toHaveLength(1);
		const layer = vm.children![0];
		const op = layer.operation as any;
		expect(op.op).toBe("CompositorLayer");
		expect(op.kind).toBe("shape");
		expect(op.shapeType).toBe("star");
		expect(op.starPoints).toBe(5);
		expect(op.starInnerRadiusRatio).toBe(0.4);
		expect(op.fillColor).toBe("#e11d48");
		expect(op.strokeWidth).toBe(6);
		expect(op.trimStart).toBe(0.1);
		expect(op.trimEnd).toBe(0.85);
		expect(op.trimOffset).toBe(90);
		expect(op.dataType).toBe("Image");
		expect(layer.children).toHaveLength(0);
	});

	it("automatically resolves direct URL sources without resolveMedia callback", () => {
		const docWithUrls: CompositorProgramConfig = {
			width: 1920,
			height: 1080,
			fps: 60,
			backgroundColor: "#000",
			mode: "Video",
			layout: [
				{
					id: "clip-1",
					kind: "media",
					inputHandleId: "https://example.com/footage.mp4",
					dataType: "Video",
				},
			],
		} as any;

		const vm = compositorToProgram(docWithUrls, { isVideoMode: true, fps: 60 });
		expect(vm.children).toHaveLength(1);
		const layer = vm.children![0];
		expect(layer.children).toHaveLength(1);
		const sourceNode = layer.children![0];
		expect(sourceNode.operation.op).toBe("source");
		expect((sourceNode.operation as any).url).toBe(
			"https://example.com/footage.mp4",
		);
	});

	it("inherits parent container startFrame for child nodes with explicit startFrame", () => {
		const sceneDoc: CompositorProgramConfig = {
			width: 1280,
			height: 720,
			fps: 30,
			mode: "Video",
			layout: [
				{
					id: "scene-2",
					kind: "box",
					startFrame: 105,
					durationFrames: 120,
					children: [
						{
							id: "callout-1",
							kind: "box",
							startFrame: 15,
							durationFrames: 105,
						},
					],
				},
			],
		} as any;

		const vm = compositorToProgram(sceneDoc, { isVideoMode: true, fps: 30 });
		const scene = vm.children![0];
		expect((scene.operation as any).startFrame).toBe(105);
		const callout = scene.children![0];
		// Child startFrame must be 105 + 15 = 120, NOT 15!
		expect((callout.operation as any).startFrame).toBe(120);
		expect((callout.operation as any).durationFrames).toBe(105);
	});

	it("keeps an untimed container on its parent's clock when its children start later", () => {
		const doc: CompositorProgramConfig = {
			width: 1280,
			height: 720,
			fps: 30,
			mode: "Video",
			layout: [
				{
					id: "scene",
					kind: "box",
					startFrame: 450,
					durationFrames: 144,
					children: [
						{
							id: "card",
							kind: "box",
							children: [
								{
									id: "clip",
									kind: "box",
									startFrame: 40,
									durationFrames: 104,
								},
							],
						},
					],
				},
			],
		} as any;

		const vm = compositorToProgram(doc, { isVideoMode: true, fps: 30 });
		const card = vm.children![0].children![0];
		// The card's keyframes are authored against the scene, so its clock must not
		// jump to its first child's start (490).
		expect((card.operation as any).startFrame).toBe(450);
		expect((card.operation as any).durationFrames).toBe(144);
		expect((card.children![0].operation as any).startFrame).toBe(490);
	});

	it("resolves .json and .lottie files as direct media sources with Lottie dataType", () => {
		const doc: CompositorProgramConfig = {
			width: 1920,
			height: 1080,
			fps: 30,
			mode: "Video",
			layout: [
				{
					id: "lottie1",
					kind: "media",
					inputHandleId: "animation.json",
					dataType: "Lottie",
				},
				{
					id: "lottie2",
					kind: "media",
					inputHandleId: "animation.lottie",
					dataType: "Lottie",
				},
			],
		} as any;

		const vm = compositorToProgram(doc, { isVideoMode: true, fps: 30 });
		expect(vm.children).toHaveLength(2);

		const layer1 = vm.children![0];
		expect(layer1.children).toHaveLength(1);
		expect((layer1.children![0].operation as any).op).toBe("source");
		expect((layer1.children![0].operation as any).dataType).toBe("Lottie");
		expect((layer1.children![0].operation as any).url).toBe("animation.json");

		const layer2 = vm.children![1];
		expect(layer2.children).toHaveLength(1);
		expect((layer2.children![0].operation as any).op).toBe("source");
		expect((layer2.children![0].operation as any).dataType).toBe("Lottie");
		expect((layer2.children![0].operation as any).url).toBe("animation.lottie");
	});

	it("preserves effects on non-media layers as CompositorLayer lop.effects", () => {
		const docWithEffects = {
			width: 1920,
			height: 1080,
			fps: 30,
			mode: "Video" as const,
			layout: [
				{
					id: "box-fx",
					kind: "box" as const,
					width: 200,
					height: 200,
					background: "#ff0000",
					effects: [{ op: "Blur", radius: 10 }],
				},
				{
					id: "text-fx",
					kind: "text" as const,
					text: "Hello World",
					fontSize: 48,
					effects: [{ op: "FilmGrain", strength: 0.1 }],
				},
			],
		};

		const vm = compositorToProgram(docWithEffects, {
			isVideoMode: true,
			fps: 30,
		});
		expect(vm.children).toHaveLength(2);

		const boxLayer = vm.children?.[0];
		const boxOp = boxLayer?.operation as Record<string, unknown> | undefined;
		expect(boxOp?.op).toBe("CompositorLayer");
		expect(boxOp?.kind).toBe("box");
		expect(boxOp?.effects).toEqual([{ op: "Blur", radius: 10 }]);

		const textLayer = vm.children?.[1];
		const textOp = textLayer?.operation as Record<string, unknown> | undefined;
		expect(textOp?.op).toBe("CompositorLayer");
		expect(textOp?.kind).toBe("text");
		expect(textOp?.effects).toEqual([{ op: "FilmGrain", strength: 0.1 }]);
	});
});

describe("compositorToProgram: 3D scenes", () => {
	const scene = (id: string, startFrame: number): LayoutNode =>
		({
			id,
			kind: "box",
			position: "absolute",
			width: 1080,
			height: 1920,
			background: "#202020",
			startFrame,
			durationFrames: 60,
			children: [
				{ id: `${id}-cam`, kind: "camera", z: -800 },
				{
					id: `${id}-cube`,
					kind: "box",
					is3D: true,
					width: 100,
					height: 100,
					startFrame: 10,
				},
			],
		}) as unknown as LayoutNode;
	const ramp = [0, 1, 2];
	const program = compositorToProgram(
		{
			width: 1080,
			height: 1920,
			fps: 30,
			mode: "Video",
			layout: [scene("a", 0), scene("b", 50)],
			signals: { ramp },
		} as unknown as CompositorProgramConfig,
		{ isVideoMode: true, fps: 30, durationMs: 4000 },
	);
	const [a, b] = program.children as VirtualMediaData[];

	it("places a container holding a camera as media whose content is its own composition", () => {
		const op = b.operation as Record<string, unknown>;
		expect(op.kind).toBe("media");
		expect(op.startFrame).toBe(50);
		expect(op.background).toBeUndefined();
		const nested = b.children?.[0];
		expect(nested?.operation.op).toBe("Compositor");
		expect((nested?.operation as Record<string, unknown>).backgroundColor).toBe(
			"#202020",
		);
		expect((nested?.operation as Record<string, unknown>).signals).toEqual({
			ramp,
		});
	});
	it("runs a scene's effects over its finished composition, once", () => {
		const fx = compositorToProgram(
			{
				width: 1080,
				height: 1920,
				fps: 30,
				mode: "Video",
				layout: [
					{
						...(scene("fx", 0) as unknown as Record<string, unknown>),
						effects: [{ op: "Vignette", strength: 80 }],
					} as unknown as LayoutNode,
				],
			} as unknown as CompositorProgramConfig,
			{ isVideoMode: true, fps: 30, durationMs: 4000 },
		);
		const layer = (fx.children as VirtualMediaData[])[0];
		// The placed picture carries no effects of its own...
		expect(
			(layer?.operation as Record<string, unknown>).effects,
		).toBeUndefined();
		// ...they wrap the nested composition, once.
		const pass = layer?.children?.[0];
		expect(pass?.operation.op).toBe("Vignette");
		expect(pass?.children?.[0]?.operation.op).toBe("Compositor");
	});
	it("keeps a windowless scene for its parent's whole window", () => {
		const fx = compositorToProgram(
			{
				width: 1080,
				height: 1920,
				fps: 30,
				mode: "Video",
				layout: [
					{
						kind: "box",
						id: "act",
						width: 1080,
						height: 1920,
						startFrame: 282,
						durationFrames: 341,
						children: [
							{
								...(scene("inner", 0) as unknown as Record<string, unknown>),
								startFrame: undefined,
								durationFrames: undefined,
							} as unknown as LayoutNode,
						],
					} as unknown as LayoutNode,
				],
			} as unknown as CompositorProgramConfig,
			{ isVideoMode: true, fps: 30, durationMs: 30000 },
		);
		const act = (fx.children as VirtualMediaData[])[0];
		const inner = act?.children?.[0]?.operation as Record<string, unknown>;
		expect(inner.startFrame).toBe(282);
		expect(inner.durationFrames).toBe(341);
	});
	it("puts a scene's layers on the composition's clock", () => {
		const fx = compositorToProgram(
			{
				width: 1080,
				height: 1920,
				fps: 30,
				mode: "Video",
				layout: [
					{
						kind: "box",
						id: "act",
						width: 1080,
						height: 1920,
						startFrame: 200,
						durationFrames: 300,
						children: [
							{
								...(scene("inner", 40) as unknown as Record<string, unknown>),
								durationFrames: 200,
							} as unknown as LayoutNode,
						],
					} as unknown as LayoutNode,
				],
			} as unknown as CompositorProgramConfig,
			{ isVideoMode: true, fps: 30, durationMs: 30000 },
		);
		const starts = new Map(
			collectLayersOnClock(fx.children as VirtualMediaData[]).map(
				({ vm, startFrame }) => [
					(vm.operation as { id?: string }).id,
					startFrame,
				],
			),
		);
		expect(starts.get("act")).toBe(200);
		expect(starts.get("inner")).toBe(240);
		// The cube starts 10 frames into the scene, on the scene's clock.
		expect(starts.get("inner-cube")).toBe(250);
	});
	it("leaves a box holding only a camera as a shot over the shared world", () => {
		expect(
			isScene3D({
				id: "shot",
				kind: "box",
				width: 1080,
				height: 1920,
				children: [{ id: "shot-cam", kind: "camera" }],
			} as unknown as LayoutNode),
		).toBe(false);
	});
	it("keeps the scene's layers on the scene's own clock", () => {
		const layers = b.children?.[0].children ?? [];
		const cube = layers.find(
			(l) => (l.operation as { id?: string }).id === "b-cube",
		);
		expect(cube?.operation.startFrame).toBe(10);
		expect(a.children?.[0].children?.length).toBe(2);
	});
});
