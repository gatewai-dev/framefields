import { afterEach, describe, expect, it, vi } from "vitest";
import { compileLayerTimeline, compileTimeline } from "./compiler.js";

describe("Compositor GSAP Compiler", () => {
	it("should compile a 2-keyframe fromTo tween correctly", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 100,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 24,
											value: 200,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-1", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		// Seek to frame 0
		tl.seek(0);
		expect(stub.x).toBe(0);

		// Seek to frame 12 (halfway, linear)
		tl.seek(12 / 24);
		expect(stub.x).toBe(100);

		// Seek to frame 24 (end of tween)
		tl.seek(24 / 24);
		expect(stub.x).toBe(200);

		// Seek to frame 48 (should hold last value)
		tl.seek(48 / 24);
		expect(stub.x).toBe(200);
	});

	it("busts the compile cache when a layer fontSize changes", () => {
		// The compiled LayerStub carries fontSize, and both the layout measure
		// and the text draw prefer the stub's value over the live op — so a
		// fontSize edit MUST invalidate the LRU cache or the stale size is
		// used for the full TTL. Regression for the editor's
		// "font size doesn't re-render" bug.
		const makeMedia = (fontSize: number) => ({
			operation: { op: "Compositor", width: 1920, height: 1080 },
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "text-1",
						kind: "text",
						fontSize,
						startFrame: 0,
						durationFrames: 100,
					},
				},
			],
		});

		const { targetsById: first } = compileTimeline(
			"render-fontsize-cache",
			makeMedia(24),
			{ fps: 24, durationSec: 5 },
		);
		expect(first["text-1"]?.fontSize).toBe(24);

		// Same renderId, only fontSize changed: the cache key must change.
		const { targetsById: second } = compileTimeline(
			"render-fontsize-cache",
			makeMedia(48),
			{ fps: 24, durationSec: 5 },
		);
		expect(second["text-1"]?.fontSize).toBe(48);
	});

	it("should compile a 2-keyframe to tween correctly (when start matches base)", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 100,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 100 },
										{
											id: "kf-2",
											frame: 24,
											value: 200,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-2", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.x).toBe(100);

		tl.seek(12 / 24);
		expect(stub.x).toBe(150);

		tl.seek(24 / 24);
		expect(stub.x).toBe(200);
	});

	it("should compile a multi-keyframe track using keyframes array correctly", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 100,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 12,
											value: 100,
											ease: { name: "none" as const, dir: "out" as const },
										},
										{
											id: "kf-3",
											frame: 36,
											value: 300,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-3", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.x).toBe(0);

		// Frame 6 (halfway to frame 12, 0 -> 100)
		tl.seek(6 / 24);
		expect(stub.x).toBe(50);

		// Frame 12
		tl.seek(12 / 24);
		expect(stub.x).toBe(100);

		// Frame 24 (halfway from 12 -> 36, 100 -> 300)
		tl.seek(24 / 24);
		expect(stub.x).toBe(200);

		// Frame 36
		tl.seek(36 / 24);
		expect(stub.x).toBe(300);
	});

	it("should compile discrete properties hidden and muted correctly", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						hidden: false,
						muted: false,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-h",
									prop: "hidden" as const,
									keyframes: [
										{ id: "kf-h1", frame: 12, value: true },
										{ id: "kf-h2", frame: 24, value: false },
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-4", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.hidden).toBe(false);

		tl.seek(11 / 24);
		expect(stub.hidden).toBe(false);

		tl.seek(13 / 24);
		expect(stub.hidden).toBe(true);

		tl.seek(23 / 24);
		expect(stub.hidden).toBe(true);

		tl.seek(25 / 24);
		expect(stub.hidden).toBe(false);
	});

	it("should support repeat and yoyo settings on numeric tracks", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 0,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									repeat: 1,
									yoyo: true,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 12,
											value: 100,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-5", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		// Start (0s)
		tl.seek(0);
		expect(stub.x).toBe(0);

		// Peak of loop 1 (12f / 0.5s)
		tl.seek(12 / 24);
		expect(stub.x).toBe(100);

		// Loop 2 starts returning because of yoyo (18f / 0.75s)
		tl.seek(18 / 24);
		expect(stub.x).toBe(50);

		// Loop 2 finishes returning to 0 (24f / 1.0s)
		tl.seek(24 / 24);
		expect(stub.x).toBe(0);
	});

	it("should place tweens at absolute position based on layer startFrame", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 100,
						startFrame: 24, // starts at 1.0s
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 100 },
										{
											id: "kf-2",
											frame: 24,
											value: 200,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-6", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		// Seek before layer starts (e.g. 0.5s)
		tl.seek(12 / 24);
		expect(stub.x).toBe(100);

		// Seek at layer start (1.0s)
		tl.seek(24 / 24);
		expect(stub.x).toBe(100);

		// Seek during tween (1.5s / 36f absolute)
		tl.seek(36 / 24);
		expect(stub.x).toBe(150);

		// Seek at tween end (2.0s / 48f absolute)
		tl.seek(48 / 24);
		expect(stub.x).toBe(200);
	});

	it("should hold the correct base/pre-seeded values at limits", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 100,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 12, value: 200 },
										{
											id: "kf-2",
											frame: 24,
											value: 300,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-7", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		// Before first keyframe (at frame 6), should hold the layer base value 100
		tl.seek(6 / 24);
		expect(stub.x).toBe(100);

		// At first keyframe frame 12
		tl.seek(12 / 24);
		expect(stub.x).toBe(200);

		// During tween
		tl.seek(18 / 24);
		expect(stub.x).toBe(250);

		// At last keyframe
		tl.seek(24 / 24);
		expect(stub.x).toBe(300);

		// After last keyframe (at frame 48), should hold the last keyframe value
		tl.seek(48 / 24);
		expect(stub.x).toBe(300);
	});

	it("should support spring easing function solver", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 0,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 24,
											value: 100,
											ease: {
												name: "spring" as const,
												dir: "out" as const,
												params: [10, 100, 1],
											},
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("render-9", virtualMedia, {
			fps: 24,
			durationSec: 5,
		});
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.x).toBe(0);

		tl.seek(24 / 24);
		expect(stub.x).toBeCloseTo(100, 0);
	});

	it("should support spring easing function solver with custom FPS", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 0,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 60,
											value: 100,
											ease: {
												name: "spring" as const,
												dir: "out" as const,
												params: [10, 100, 1],
											},
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-9-fps-60",
			virtualMedia,
			{
				fps: 60,
				durationSec: 5,
			},
		);
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.x).toBe(0);

		tl.seek(60 / 60);
		expect(stub.x).toBeCloseTo(100, 0);
	});
});

describe("Compositor Layer Timeline Compiler", () => {
	it("should compile and interpolate volume keyframes correctly", () => {
		const animation = {
			tracks: [
				{
					id: "track-vol",
					prop: "volume" as const,
					keyframes: [
						{ id: "kf-1", frame: 0, value: 0.5 },
						{
							id: "kf-2",
							frame: 24,
							value: 1.0,
							ease: { name: "none" as const, dir: "out" as const },
						},
					],
				},
			],
		};

		const { tl, stub } = compileLayerTimeline(
			"layer-1",
			animation,
			0.5,
			false,
			24,
		);
		expect(stub).toBeDefined();

		// Seek to frame 0
		tl.seek(0);
		expect(stub.volume).toBe(0.5);

		// Seek to frame 12 (halfway, linear)
		tl.seek(12 / 24);
		expect(stub.volume).toBeCloseTo(0.75, 4);

		// Seek to frame 24
		tl.seek(24 / 24);
		expect(stub.volume).toBe(1.0);
	});

	it("should handle muted keyframes correctly", () => {
		const animation = {
			tracks: [
				{
					id: "track-mute",
					prop: "muted" as const,
					keyframes: [
						{ id: "kf-1", frame: 0, value: false },
						{ id: "kf-2", frame: 12, value: true },
						{ id: "kf-3", frame: 24, value: false },
					],
				},
			],
		};

		const { tl, stub } = compileLayerTimeline(
			"layer-1",
			animation,
			1.0,
			false,
			24,
		);

		tl.seek(0);
		expect(stub.muted).toBe(false);

		tl.seek(12 / 24);
		expect(stub.muted).toBe(true);

		tl.seek(24 / 24);
		expect(stub.muted).toBe(false);
	});

	it("should compile and interpolate fontSize keyframes correctly", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						fontSize: 40,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-fontsize",
									prop: "fontSize" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 40 },
										{
											id: "kf-2",
											frame: 24,
											value: 80,
											ease: { name: "none" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-fontsize",
			virtualMedia,
			{
				fps: 24,
				durationSec: 5,
			},
		);
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(stub.fontSize).toBe(40);

		// Seek to frame 12 (halfway, linear interpolation)
		tl.seek(12 / 24);
		expect(stub.fontSize).toBe(60);

		// Seek to frame 24 (end)
		tl.seek(24 / 24);
		expect(stub.fontSize).toBe(80);
	});

	it("should gracefully handle and clamp invalid spring easing parameters to prevent NaN output", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "layer-1",
						x: 0,
						startFrame: 0,
						durationFrames: 100,
						animation: {
							tracks: [
								{
									id: "track-1",
									prop: "x" as const,
									keyframes: [
										{ id: "kf-1", frame: 0, value: 0 },
										{
											id: "kf-2",
											frame: 24,
											value: 100,
											ease: {
												name: "spring" as const,
												dir: "out" as const,
												params: [0, -5, 0],
											},
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-invalid-spring",
			virtualMedia,
			{
				fps: 24,
				durationSec: 5,
			},
		);
		const stub = targetsById["layer-1"];
		expect(stub).toBeDefined();

		tl.seek(0);
		expect(Number.isNaN(stub.x)).toBe(false);

		tl.seek(12 / 24);
		expect(Number.isNaN(stub.x)).toBe(false);

		tl.seek(24 / 24);
		expect(Number.isNaN(stub.x)).toBe(false);
	});
});

describe("keyframe tail truncation (review M8)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const spyWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});

	const vmWithTrack = (
		keyframes: Array<{ frame: number; value: number }>,
		durationFrames: number,
	) => ({
		operation: { op: "Compositor", width: 1920, height: 1080 },
		children: [
			{
				operation: {
					op: "CompositorLayer",
					id: "layer-1",
					startFrame: 0,
					durationFrames,
					animation: {
						tracks: [
							{
								id: "track-1",
								prop: "x" as const,
								keyframes: keyframes.map((kf, i) => ({
									id: `kf-${i}`,
									...kf,
								})),
							},
						],
					},
				},
			},
		],
	});

	it("warns and holds the last playable value when keyframes exceed durationFrames", () => {
		const warn = spyWarn();
		const { tl, targetsById } = compileTimeline(
			"m8-truncate-tail",
			vmWithTrack(
				[
					{ frame: 0, value: 0 },
					{ frame: 12, value: 50 },
					{ frame: 48, value: 100 },
				],
				24,
			),
			{ fps: 24, durationSec: 5 },
		);
		const stub = targetsById["layer-1"];

		tl.seek(12 / 24);
		expect(stub.x).toBe(50); // tween to the last playable keyframe
		tl.seek(24 / 24);
		expect(stub.x).toBe(50); // tail beyond the clip holds — no jump to 100

		expect(warn).toHaveBeenCalledTimes(1);
		const msg = String(warn.mock.calls[0][0]);
		expect(msg).toContain("truncated");
		expect(msg).toContain("track-1");
		expect(msg).toContain("layer-1");
	});

	it("degrades to a static set when only the first keyframe survives", () => {
		const warn = spyWarn();
		const { tl, targetsById } = compileTimeline(
			"m8-static-degrade",
			vmWithTrack(
				[
					{ frame: 0, value: 10 },
					{ frame: 500, value: 90 },
				],
				100,
			),
			{ fps: 24, durationSec: 5 },
		);
		const stub = targetsById["layer-1"];

		tl.seek(100 / 24);
		expect(stub.x).toBe(10); // never animates — static set, now with a warning

		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain("1 keyframe(s)");
	});

	it("does not warn when all keyframes fit the clip window", () => {
		const warn = spyWarn();
		compileTimeline(
			"m8-no-truncation",
			vmWithTrack(
				[
					{ frame: 0, value: 0 },
					{ frame: 24, value: 100 },
				],
				24,
			),
			{ fps: 24, durationSec: 5 },
		);
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns only once per cache key (per-frame seeks reuse the cached timeline)", () => {
		const warn = spyWarn();
		const input = vmWithTrack(
			[
				{ frame: 0, value: 0 },
				{ frame: 30, value: 100 },
			],
			24,
		);
		compileTimeline("m8-dedupe", input, { fps: 24, durationSec: 5 });
		compileTimeline("m8-dedupe", input, { fps: 24, durationSec: 5 });
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("re-warns for a fresh cache key (a new render of the same broken doc)", () => {
		const warn = spyWarn();
		const input = vmWithTrack(
			[
				{ frame: 0, value: 0 },
				{ frame: 30, value: 100 },
			],
			24,
		);
		compileTimeline("m8-fresh-1", input, { fps: 24, durationSec: 5 });
		compileTimeline("m8-fresh-2", input, { fps: 24, durationSec: 5 });
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it("compiles and evaluates text reveal animation tracks accurately", () => {
		const virtualMedia = {
			operation: { op: "Compositor", width: 1920, height: 1080 },
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "text-layer-1",
						kind: "text",
						text: "Hello World",
						startFrame: 0,
						durationFrames: 60,
						animation: {
							tracks: [
								{
									id: "track-text-1",
									prop: "text" as const,
									keyframes: [
										{
											id: "kf-1",
											frame: 0,
											value: 0,
											presetType: "typewriter",
										},
										{
											id: "kf-2",
											frame: 24,
											value: 1,
											ease: { name: "none" as const, dir: "out" as const },
											presetType: "typewriter",
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-text-anim",
			virtualMedia,
			{
				fps: 24,
				durationSec: 5,
			},
		);

		const stub = targetsById["text-layer-1"];
		expect(stub).toBeDefined();

		// Frame 0: 0 progress
		tl.seek(0);
		expect(stub.text).toBe(0);

		// Frame 12: 0.5 progress
		tl.seek(12 / 24);
		expect(stub.text).toBeCloseTo(0.5, 2);

		// Frame 24: 1.0 progress
		tl.seek(24 / 24);
		expect(stub.text).toBe(1);

		// Frame 48: stays 1.0
		tl.seek(48 / 24);
		expect(stub.text).toBe(1);
	});

	it("busts timeline cache when text string changes", () => {
		const makeMedia = (text: string) => ({
			operation: { op: "Compositor", width: 1920, height: 1080 },
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "title-node",
						kind: "text",
						text,
						startFrame: 0,
						durationFrames: 60,
					},
				},
			],
		});

		const { targetsById: first } = compileTimeline(
			"render-text-cache",
			makeMedia("First Version"),
			{ fps: 24, durationSec: 5 },
		);
		expect(first["title-node"]?.text).toBe(1);

		const { targetsById: second } = compileTimeline(
			"render-text-cache",
			makeMedia("Second Version"),
			{ fps: 24, durationSec: 5 },
		);
		expect(second["title-node"]).toBeDefined();
	});

	it("compiles and evaluates cubic bezier and hold keyframe easing", () => {
		const virtualMedia = {
			operation: { op: "Compositor", width: 1920, height: 1080 },
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "cubic-node",
						x: 0,
						startFrame: 0,
						durationFrames: 60,
						animation: {
							tracks: [
								{
									id: "t_cubic",
									prop: "x" as const,
									keyframes: [
										{ id: "k1", frame: 0, value: 0 },
										{
											id: "k2",
											frame: 24,
											value: 100,
											ease: {
												name: "cubic" as const,
												dir: "out" as const,
												params: [0.25, 0.1, 0.25, 1.0],
											},
										},
									],
								},
								{
									id: "t_hold",
									prop: "y" as const,
									keyframes: [
										{ id: "k3", frame: 0, value: 0 },
										{
											id: "k4",
											frame: 24,
											value: 50,
											ease: {
												name: "hold" as const,
												dir: "out" as const,
											},
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-cubic-hold",
			virtualMedia,
			{ fps: 24, durationSec: 5 },
		);

		const stub = targetsById["cubic-node"];
		expect(stub).toBeDefined();

		// Check initial
		tl.seek(0);
		expect(stub.x).toBe(0);
		expect(stub.y).toBe(0);

		// Check mid-way (frame 12)
		tl.seek(12 / 24);
		expect(stub.x).toBeGreaterThan(0);
		expect(stub.x).toBeLessThan(100);
		// Hold stays at initial value until the keyframe
		expect(stub.y).toBe(0);

		// Check at destination (frame 24)
		tl.seek(24 / 24);
		expect(stub.x).toBeCloseTo(100, 0);
		expect(stub.y).toBe(50);
	});

	it("compiles and evaluates procedural wiggle and signal tracks", () => {
		const virtualMedia: any = {
			metadata: { width: 1920, height: 1080, durationMs: 2000 },
			operation: {
				op: "Compositor",
				signals: {
					audio_pulse: [0, 0.5, 1.0, 0.2, 0.0],
				},
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "proc-node",
						x: 50,
						scale: 1,
						durationFrames: 48,
						animation: {
							tracks: [
								{
									id: "t_wiggle",
									prop: "x" as const,
									source: {
										type: "wiggle" as const,
										frequency: 3,
										amplitude: 40,
										seed: 1234,
									},
								},
								{
									id: "t_signal",
									prop: "scale" as const,
									source: {
										type: "signal" as const,
										inputHandleId: "audio_pulse",
										multiplier: 0.5,
										offset: 1.0,
									},
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"render-procedural-test",
			virtualMedia,
			{ fps: 24, durationSec: 2 },
		);

		const stub = targetsById["proc-node"];
		expect(stub).toBeDefined();

		// Frame 0
		tl.seek(0);
		expect(stub.scale).toBe(1.0); // 0 * 0.5 + 1.0 = 1.0

		// Frame 2 (at 24fps = 2/24 sec) -> audio_pulse[2] is 1.0 -> 1.0 * 0.5 + 1.0 = 1.5
		tl.seek(2 / 24);
		expect(stub.scale).toBeCloseTo(1.5, 4);

		// Wiggle moves smoothly around baseline 50 +- 40
		expect(stub.x).toBeGreaterThanOrEqual(10);
		expect(stub.x).toBeLessThanOrEqual(90);
	});
});

