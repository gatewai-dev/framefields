import { describe, expect, it } from "vitest";
import {
	CompositorProgramSchema,
	EaseRefSchema,
	type FlexNode,
	type LayoutNode,
} from "./schema.js";
import {
	collectMediaBindings,
	collectNodeIds,
	parseProgram,
	validateLayoutProgram,
} from "./validate.js";

const heroConfig = {
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
			align: "center",
			padding: 80,
			width: "fill",
			height: "fill",
			animation: {
				tracks: [
					{
						id: "t1",
						prop: "opacity",
						keyframes: [
							{ id: "k1", frame: 0, value: 0 },
							{
								id: "k2",
								frame: 15,
								value: 1,
								ease: { name: "power2", dir: "out" },
							},
						],
					},
				],
			},
			children: [
				{
					id: "title",
					kind: "text",
					text: "Big Title",
					fontSize: 96,
					fontWeight: 900,
					fill: "#f4ead8",
				},
				{
					id: "subtitle",
					kind: "text",
					text: "Subtitle",
					fontSize: 40,
					fill: "#b8a88a",
				},
				{
					id: "badges",
					kind: "flex",
					dir: "row",
					gap: 16,
					children: [
						{ id: "chipA", kind: "box", width: "fit", background: "#3a2f1e" },
						{
							id: "avatarImg",
							kind: "media",
							inputHandleId: "handle_avatar",
						},
					],
				},
			],
		},
	],
} as const;

describe("CompositorProgramSchema (document v2)", () => {
	it("parses the spec hero example with defaults applied", () => {
		const parsed = CompositorProgramSchema.safeParse(heroConfig);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		const doc = parsed.data;
		expect(doc.width).toBe(1920);
		expect(doc.layout).toHaveLength(1);
		const hero = doc.layout[0] as FlexNode;
		expect(hero.kind).toBe("flex");
		expect(hero.position).toBe("relative"); // default
		expect(hero.zIndex).toBe(0);
		expect(hero.animation?.tracks).toHaveLength(1);
		if (hero.kind !== "flex") throw new Error("expected flex");
		expect(hero.justify).toBe("start"); // default
		expect(hero.children).toHaveLength(3);
		const title = hero.children![0];
		expect(title.kind).toBe("text");
	});

	it("round-trips a media-only tree with bindings intact", () => {
		const parsed = CompositorProgramSchema.safeParse(heroConfig);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(collectNodeIds(parsed.data.layout)).toEqual([
			"hero",
			"title",
			"subtitle",
			"badges",
			"chipA",
			"avatarImg",
		]);
		expect(collectMediaBindings(parsed.data.layout).get("handle_avatar")).toBe(
			"avatarImg",
		);
	});

	it("recursive children parse at any depth (lazy recursion works)", () => {
		const deepNode = (depth: number): LayoutNode => {
			if (depth === 0) {
				return { id: `n0`, kind: "text", text: "leaf" } as LayoutNode;
			}
			return {
				id: `n${depth}`,
				kind: "flex",
				children: [deepNode(depth - 1)],
			} as LayoutNode;
		};
		const parsed = CompositorProgramSchema.safeParse({
			...heroConfig,
			layout: [deepNode(20)],
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects string values for numeric tracks", () => {
		const badConfigWithNumeric = {
			...heroConfig,
			layout: [
				{
					id: "chip",
					kind: "box",
					width: "fit",
					background: "#3a2f1e",
					animation: {
						tracks: [
							{
								id: "t1",
								prop: "opacity" as const,
								keyframes: [{ id: "k1", frame: 0, value: "opaque" }],
							},
						],
					},
				},
			],
		};
		const parsedBad = CompositorProgramSchema.safeParse(badConfigWithNumeric);
		expect(parsedBad.success).toBe(false);
	});

	it("rejects volume keyframes outside 0–1 (L3 — no amplification headroom)", () => {
		const badVolumeConfig = {
			...heroConfig,
			layout: [
				{
					id: "media-a",
					kind: "media",
					inputHandleId: "avatar",
					animation: {
						tracks: [
							{
								id: "t1",
								prop: "volume" as const,
								keyframes: [
									{ id: "k1", frame: 0, value: 0.5 },
									{ id: "k2", frame: 10, value: 1.5 },
								],
							},
						],
					},
				},
			],
		};
		const parsedBad = CompositorProgramSchema.safeParse(badVolumeConfig);
		expect(parsedBad.success).toBe(false);
	});
});

describe("validateLayoutProgram (E-code pre-parse scan)", () => {
	const base = { width: 100, height: 100, layout: [] };

	it("rejects v1 shapes — layers/layerUpdates/FPS (no backwards compatibility)", () => {
		expect(validateLayoutProgram({ ...base, layers: [] }).ok).toBe(false);
		expect(validateLayoutProgram({ ...base, layerUpdates: [] }).ok).toBe(false);
		expect(validateLayoutProgram({ ...base, FPS: 24 }).ok).toBe(false);
		const r = validateLayoutProgram({ ...base, layers: [] });
		if (r.ok) throw new Error("expected failure");
		expect(r.issues[0].code).toBe("E1001");
		expect(r.issues[0].path).toEqual(["layers"]);
	});

	it("E1201 unknown kind", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "a", kind: "lottie" }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues[0].code).toBe("E1201");
	});

	it("E1202 duplicate id", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [
				{ id: "a", kind: "text", text: "x" },
				{ id: "a", kind: "text", text: "y" },
			],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1202")).toBe(true);
	});

	it("E1203 missing id", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ kind: "text", text: "x" }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1203")).toBe(true);
	});

	it("E1204 media without inputHandleId", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "m", kind: "media" }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1204")).toBe(true);
	});

	it("E1205 invalid SizeSpec", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "a", kind: "box", width: -5 }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues[0].code).toBe("E1205");
	});

	it("E1206 absolute without x/y", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "a", kind: "box", position: "absolute" }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1206")).toBe(true);
	});

	it("E1209 grow on absolute", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [
				{
					id: "a",
					kind: "box",
					position: "absolute",
					x: 10,
					y: 10,
					grow: 2,
				},
			],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1209")).toBe(true);
	});

	it("E1208 duplicate (id, prop) tracks", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [
				{
					id: "a",
					kind: "text",
					text: "x",
					animation: {
						tracks: [
							{
								id: "t1",
								prop: "opacity",
								keyframes: [{ id: "k1", frame: 0, value: 0 }],
							},
							{
								id: "t2",
								prop: "opacity",
								keyframes: [{ id: "k2", frame: 10, value: 1 }],
							},
						],
					},
				},
			],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1208")).toBe(true);
	});

	it("E1210 text with fontSize <= 0", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "t", kind: "text", text: "x", fontSize: 0 }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.code === "E1210")).toBe(true);
	});

	it("E1207 invalid durationFrames (NaN, <=0, non-integer)", () => {
		const rNaN = validateLayoutProgram({
			...base,
			layout: [
				{
					id: "m",
					kind: "media",
					inputHandleId: "h1",
					durationFrames: Number.NaN,
				},
			],
		});
		expect(rNaN.ok).toBe(false);
		if (!rNaN.ok) {
			expect(rNaN.issues.some((i) => i.code === "E1207")).toBe(true);
		}

		const rZero = validateLayoutProgram({
			...base,
			layout: [
				{ id: "m", kind: "media", inputHandleId: "h1", durationFrames: 0 },
			],
		});
		expect(rZero.ok).toBe(false);
		if (!rZero.ok) {
			expect(rZero.issues.some((i) => i.code === "E1207")).toBe(true);
		}
	});

	it("E1207 invalid startFrame (NaN, <0, non-integer)", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "m", kind: "media", inputHandleId: "h1", startFrame: -1 }],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.issues.some((i) => i.code === "E1207")).toBe(true);
		}
	});

	it("E1213 invalid opacity", () => {
		const r = validateLayoutProgram({
			...base,
			layout: [{ id: "m", kind: "media", inputHandleId: "h1", opacity: 1.5 }],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.issues.some((i) => i.code === "E1213")).toBe(true);
		}
	});

	it("ignores timing issues in Image mode (duration does not apply to images)", () => {
		const imageConfig = {
			...base,
			mode: "Image",
			layout: [
				{
					id: "m1",
					kind: "media",
					inputHandleId: "h1",
					durationFrames: Number.NaN,
					startFrame: -1,
				},
			],
		};
		const validationResult = validateLayoutProgram(imageConfig);
		expect(validationResult.ok).toBe(true);

		const parsed = parseProgram(imageConfig);
		expect(parsed.ok).toBe(true);
		expect(parsed.config?.layout[0].id).toBe("m1");
	});

	it("parseProgram fast-fails v1 configs and passes v2 configs", () => {
		const bad = parseProgram({ ...base, layers: [] });
		expect(bad.ok).toBe(false);
		expect(bad.issues?.[0].code).toBe("E1001");
		const good = parseProgram(heroConfig);
		expect(good.ok).toBe(true);
	});

	it("validates EaseRefSchema spring parameters", () => {
		// Valid spring
		const validSpring = EaseRefSchema.safeParse({
			name: "spring",
			dir: "out",
			params: [10, 100, 1],
		});
		expect(validSpring.success).toBe(true);

		// Invalid spring damping
		const invalidDamping = EaseRefSchema.safeParse({
			name: "spring",
			dir: "out",
			params: [0, 100, 1],
		});
		expect(invalidDamping.success).toBe(false);
		if (!invalidDamping.success) {
			expect(invalidDamping.error.issues[0].message).toContain(
				"Spring damping",
			);
		}

		// Invalid spring stiffness
		const invalidStiffness = EaseRefSchema.safeParse({
			name: "spring",
			dir: "out",
			params: [10, -5, 1],
		});
		expect(invalidStiffness.success).toBe(false);
		if (!invalidStiffness.success) {
			expect(invalidStiffness.error.issues[0].message).toContain(
				"Spring stiffness",
			);
		}

		// Invalid spring mass
		const invalidMass = EaseRefSchema.safeParse({
			name: "spring",
			dir: "out",
			params: [10, 100, 0],
		});
		expect(invalidMass.success).toBe(false);
		if (!invalidMass.success) {
			expect(invalidMass.error.issues[0].message).toContain("Spring mass");
		}
	});

	it("parses and validates kind: 'shape' layout nodes with default and custom styling", () => {
		const shapeDoc = {
			width: 1920,
			height: 1080,
			backgroundColor: "#0d0f17",
			layout: [
				{
					id: "star-shape",
					kind: "shape",
					shapeType: "star",
					starPoints: 5,
					starInnerRadiusRatio: 0.5,
					width: 300,
					height: 300,
					fillType: "solid",
					fillColor: "#38bdf8",
					strokeColor: "#ffffff",
					strokeWidth: 4,
					strokeLineCap: "round",
					strokeLineJoin: "round",
					trimStart: 0.1,
					trimEnd: 0.9,
					trimOffset: 45,
				},
				{
					id: "custom-path-shape",
					kind: "shape",
					shapeType: "path",
					d: "M 0 0 L 100 100",
					strokeWidth: 2,
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(shapeDoc);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const star = parsed.data.layout[0];
		expect(star.kind).toBe("shape");
		if (star.kind !== "shape") return;
		expect(star.shapeType).toBe("star");
		expect(star.starPoints).toBe(5);
		expect(star.trimStart).toBe(0.1);
		expect(star.trimEnd).toBe(0.9);
		expect(star.strokeWidth).toBe(4);

		const path = parsed.data.layout[1];
		expect(path.kind).toBe("shape");
		if (path.kind !== "shape") return;
		expect(path.shapeType).toBe("path");
		expect(path.d).toBe("M 0 0 L 100 100");
	});

	it("supports keyframe tracks on vector shape properties", () => {
		const animatedShapeDoc = {
			width: 1920,
			height: 1080,
			backgroundColor: "#0d0f17",
			layout: [
				{
					id: "animated-ring",
					kind: "shape",
					shapeType: "circle",
					width: 200,
					height: 200,
					animation: {
						tracks: [
							{
								id: "t_trim",
								prop: "trimEnd",
								keyframes: [
									{ id: "kf1", frame: 0, value: 0 },
									{
										id: "kf2",
										frame: 30,
										value: 1,
										ease: { name: "power2", dir: "out" },
									},
								],
							},
							{
								id: "t_stroke",
								prop: "strokeWidth",
								keyframes: [
									{ id: "kf3", frame: 0, value: 2 },
									{ id: "kf4", frame: 30, value: 10 },
								],
							},
							{
								id: "t_color",
								prop: "fillColor",
								keyframes: [
									{ id: "kf5", frame: 0, value: "#ff0000" },
									{ id: "kf6", frame: 30, value: "#00ff00" },
								],
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(animatedShapeDoc);
		expect(parsed.success).toBe(true);
	});

	it("rejects invalid trimStart/trimEnd keyframes outside [0, 1]", () => {
		const invalidTrimDoc = {
			width: 1920,
			height: 1080,
			backgroundColor: "#0d0f17",
			layout: [
				{
					id: "bad-trim",
					kind: "shape",
					animation: {
						tracks: [
							{
								id: "t_trim",
								prop: "trimStart",
								keyframes: [
									{ id: "kf1", frame: 0, value: -0.2 },
									{ id: "kf2", frame: 30, value: 1.5 },
								],
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(invalidTrimDoc);
		expect(parsed.success).toBe(false);
	});

	it("validates shape nodes using validateLayoutProgram pre-check", () => {
		const result = validateLayoutProgram({
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "shape-1",
					kind: "shape",
					trimStart: -0.5,
				},
			],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0].code).toBe("E1208");
			expect(result.issues[0].message).toContain("trimStart");
		}
	});

	it("accepts cubic bezier and hold ease references, and spatial tangents on keyframes", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "mograph-rect",
					kind: "shape",
					animation: {
						tracks: [
							{
								id: "t1",
								prop: "x",
								keyframes: [
									{
										id: "k1",
										frame: 0,
										value: 100,
										ease: {
											name: "cubic",
											dir: "out",
											params: [0.25, 0.1, 0.25, 1.0],
										},
										spatialTangentOut: { x: 50, y: -20 },
									},
									{
										id: "k2",
										frame: 60,
										value: 500,
										ease: {
											name: "hold",
											dir: "out",
										},
										spatialTangentIn: { x: -40, y: 10 },
									},
								],
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
	});

	it("accepts track sources (signal, wiggle, springOvershoot) with optional keyframes", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "signal-layer",
					kind: "shape",
					shapeType: "circle",
					animation: {
						tracks: [
							{
								id: "t-signal",
								prop: "scale",
								source: {
									type: "signal",
									inputHandleId: "audio_bass",
									multiplier: 0.5,
									offset: 1.0,
									smoothingWindowFrames: 3,
								},
							},
							{
								id: "t-wiggle",
								prop: "x",
								source: {
									type: "wiggle",
									frequency: 3,
									amplitude: 25,
									octaves: 2,
									seed: 42,
								},
							},
							{
								id: "t-spring",
								prop: "y",
								source: {
									type: "springOvershoot",
									damping: 10,
									stiffness: 150,
									mass: 1,
								},
								keyframes: [
									{ id: "k1", frame: 0, value: 0 },
									{ id: "k2", frame: 30, value: 200 },
								],
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
	});

	it("accepts track source signal aliases (handleId, amplitude, smoothing)", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "signal-layer-alias",
					kind: "shape",
					shapeType: "circle",
					animation: {
						tracks: [
							{
								id: "t-signal-alias",
								prop: "x",
								source: {
									type: "signal",
									handleId: "audio_bass_handle",
									amplitude: 150,
									smoothing: 4,
								},
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const track = (parsed.data.layout[0] as any).animation.tracks[0];
			expect(track.source.inputHandleId).toBe("audio_bass_handle");
			expect(track.source.multiplier).toBe(150);
			expect(track.source.smoothingWindowFrames).toBe(4);
		}
	});

	it("accepts container staggerFrames and staggerDirection on flex and block nodes", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "staggered-flex",
					kind: "flex",
					dir: "row",
					staggerFrames: 6,
					staggerDirection: "center-out",
					children: [
						{ id: "c1", kind: "shape", width: 100, height: 100 },
						{ id: "c2", kind: "shape", width: 100, height: 100 },
						{ id: "c3", kind: "shape", width: 100, height: 100 },
					],
				},
				{
					id: "staggered-block",
					kind: "block",
					staggerFrames: 4,
					staggerDirection: "reverse",
					children: [
						{ id: "b1", kind: "shape", width: 100, height: 100 },
						{ id: "b2", kind: "shape", width: 100, height: 100 },
					],
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
	});

	it("validates TextAnimatorSchema and kinetic typography animators on TextNode", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "kinetic-text",
					kind: "text",
					text: "GATEWAI MOTION",
					fontSize: 64,
					animators: [
						{
							id: "char-animator",
							unit: "character",
							rangeStart: 0,
							rangeEnd: 1,
							offset: 0,
							easing: "power2.out",
							transform: {
								y: 50,
								scale: 0.8,
								scaleX: 1,
								scaleY: 1,
								rotation: 15,
								rotationX: 90,
								opacity: 0,
								blur: 10,
							},
						},
						{
							id: "word-wave",
							unit: "word",
							rangeStart: 0.2,
							rangeEnd: 0.8,
							offset: -0.1,
							easing: "sine.inOut",
							transform: {
								y: -20,
							},
						},
					],
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const textNode = parsed.data.layout[0] as any;
			expect(textNode.animators).toHaveLength(2);
			expect(textNode.animators[0].unit).toBe("character");
			expect(textNode.animators[0].transform.rotationX).toBe(90);
			expect(textNode.animators[1].unit).toBe("word");
		}
	});

	it("rejects invalid range bounds on TextAnimatorSchema", () => {
		const invalidDoc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "invalid-text",
					kind: "text",
					text: "FAIL",
					animators: [
						{
							id: "bad-range",
							rangeStart: -0.5, // Min is 0
						},
					],
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(invalidDoc);
		expect(parsed.success).toBe(false);
	});

	it("validates keyframe tracks for fill and color properties with string color values", () => {
		const validDoc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "text-color-kf",
					kind: "text",
					text: "Color Pulse",
					animation: {
						tracks: [
							{
								id: "t-fill",
								prop: "fill",
								keyframes: [
									{ id: "kf1", frame: 0, value: "#ffffff" },
									{ id: "kf2", frame: 24, value: "#ff0055" },
								],
							},
							{
								id: "t-color",
								prop: "color",
								keyframes: [
									{ id: "kf3", frame: 0, value: "#000000" },
									{ id: "kf4", frame: 24, value: "#ffffff" },
								],
							},
						],
					},
				},
			],
		};

		const parsed = CompositorProgramSchema.safeParse(validDoc);
		expect(parsed.success).toBe(true);

		// Non-string values on fill / color should fail validation
		const invalidDoc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "bad-color-kf",
					kind: "text",
					text: "Bad",
					animation: {
						tracks: [
							{
								id: "t-fill-bad",
								prop: "fill",
								keyframes: [
									{ id: "kf1", frame: 0, value: 54 }, // number on color prop
								],
							},
						],
					},
				},
			],
		};
		const parsedInvalid = CompositorProgramSchema.safeParse(invalidDoc);
		expect(parsedInvalid.success).toBe(false);
	});

	it("accepts a per-node effect chain on media and box nodes", () => {
		const doc = {
			width: 1080,
			height: 1920,
			fps: 30,
			mode: "Video",
			layout: [
				{
					id: "plate",
					kind: "media",
					inputHandleId: "plate-input",
					blendMode: "screen",
					effects: [{ op: "Blur", strength: 40 }],
				},
				{
					id: "card",
					kind: "box",
					effects: [{ op: "Vignette", strength: 20 }],
				},
			],
		};
		expect(CompositorProgramSchema.safeParse(doc).success).toBe(true);
	});

	it("accepts composition-level and per-node effect chains", () => {
		const doc = {
			width: 1080,
			height: 1920,
			fps: 30,
			mode: "Video",
			effects: [{ op: "FilmGrain", strength: 0.05 }],
			layout: [
				{
					id: "plate",
					kind: "media",
					inputHandleId: "plate-input",
					effects: [{ op: "Blur", strength: 40 }],
				},
				{
					id: "card",
					kind: "box",
					effects: [{ op: "Vignette", strength: 20 }],
				},
			],
		};
		expect(CompositorProgramSchema.safeParse(doc).success).toBe(true);
	});

	it("validates TextNode with rich text spans and marks in CompositorProgramSchema", () => {
		const doc = {
			width: 1920,
			height: 1080,
			layout: [
				{
					id: "rich-title",
					kind: "text",
					text: "Scale 10x faster with 120 FPS",
					fontSize: 48,
					spans: [
						{ text: "Scale " },
						{ text: "10x", fill: "#6366f1", fontWeight: 700, fontSize: 64 },
						{ text: " faster with " },
						{
							text: "120 FPS",
							fill: "#10b981",
							mark: {
								background: "#10b98133",
								borderRadius: 6,
								paddingX: 8,
								paddingY: 4,
							},
						},
					],
				},
			],
		};
		const parsed = CompositorProgramSchema.safeParse(doc);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const textNode = parsed.data.layout[0];
			expect(textNode.kind).toBe("text");
			if (textNode.kind === "text") {
				expect(textNode.spans).toHaveLength(4);
				expect(textNode.spans?.[1].fontWeight).toBe(700);
				expect(textNode.spans?.[3].mark?.borderRadius).toBe(6);
			}
		}
	});
});
