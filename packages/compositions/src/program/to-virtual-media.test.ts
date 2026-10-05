import type { VirtualMediaData } from "@framefields/core";
import { describe, expect, it } from "vitest";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";
import { compositorToProgram } from "./to-virtual-media.js";

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
});
