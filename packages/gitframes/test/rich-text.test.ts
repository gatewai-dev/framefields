import { describe, expect, it } from "vitest";
import {
	accent,
	bold,
	Composition,
	CompositorProgramSchema,
	code,
	color,
	italic,
	Layer,
	mark,
	normalizeTextSpans,
	parseMarkup,
	rich,
	signal,
	size,
	span,
	sub,
	sup,
} from "../src/index.js";

describe("Rich Text System & Tagged Template Authoring", () => {
	it("rich tagged template literal creates structured TextSpan[] AST", () => {
		const spans = rich`Hello ${bold("Bold")} and ${italic("Italic")} world!`;

		expect(spans).toEqual([
			{ text: "Hello " },
			{ text: "Bold", fontWeight: 700 },
			{ text: " and " },
			{ text: "Italic", fontStyle: "italic" },
			{ text: " world!" },
		]);
	});

	it("rich interpolates numbers, signals, and modifiers", () => {
		const countSig = signal(42);
		const spans = rich`Count: ${countSig}, Speed: ${120}km/h, ${accent("Turbo")}`;

		expect(spans.length).toBe(6);
		expect(spans[0]).toEqual({ text: "Count: " });
		expect(spans[1].text).toBe(countSig);
		expect(spans[2]).toEqual({ text: ", Speed: " });
		expect(spans[3]).toEqual({ text: "120" });
		expect(spans[4]).toEqual({ text: "km/h, " });
		expect(spans[5]).toEqual({ text: "Turbo", fill: "#6366f1" });
	});

	it("modifier helpers create typed TextSpan definitions", () => {
		expect(span("Normal", { opacity: 0.8 })).toEqual({
			text: "Normal",
			opacity: 0.8,
		});
		expect(bold("Heavy", { fontWeight: 900 })).toEqual({
			text: "Heavy",
			fontWeight: 900,
		});
		expect(italic("Slanted")).toEqual({
			text: "Slanted",
			fontStyle: "italic",
		});
		expect(accent("Hero")).toEqual({
			text: "Hero",
			fill: "#6366f1",
		});
		expect(color("Colored", "#ef4444")).toEqual({
			text: "Colored",
			fill: "#ef4444",
		});
		expect(size("Large", 64)).toEqual({
			text: "Large",
			fontSize: 64,
		});
		expect(
			mark("Highlighted", {
				bg: "#10b98133",
				radius: 8,
				paddingX: 10,
				paddingY: 4,
			}),
		).toEqual({
			text: "Highlighted",
			fill: undefined,
			mark: {
				background: "#10b98133",
				borderRadius: 8,
				paddingX: 10,
				paddingY: 4,
			},
		});
		expect(sup("2")).toEqual({
			text: "2",
			baselineShift: -8,
		});
		expect(sub("min")).toEqual({
			text: "min",
			baselineShift: 6,
		});
		expect(code("const x = 1")).toEqual({
			text: "const x = 1",
			fontFamily: "JetBrains Mono",
			mark: {
				background: "#ffffff18",
				borderRadius: 4,
				paddingX: 6,
				paddingY: 2,
			},
		});
	});

	it("normalizeTextSpans flattens visible plain text while preserving spans", () => {
		const countSig = signal("Dynamic");
		const spans = [
			{ text: "Hello " },
			{ text: countSig },
			{ text: " World!", fill: "#3b82f6" },
		];

		const normalized = normalizeTextSpans(spans);
		expect(normalized.text).toBe("Hello Dynamic World!");
		expect(normalized.spans).toEqual(spans);
	});

	it("parseMarkup parses external subtitle/CMS strings into TextSpan[]", () => {
		const raw =
			'Welcome to <b>Gitframes</b>! Experience <accent>real-time</accent> rendering with <mark bg="#f59e0b33">WebGPU</mark> and <size value="20">E=mc<sup>2</sup></size>.';
		const spans = parseMarkup(raw);

		expect(spans).toEqual([
			{ text: "Welcome to " },
			{ text: "Gitframes", fontWeight: 700 },
			{ text: "! Experience " },
			{ text: "real-time", fill: "#6366f1" },
			{ text: " rendering with " },
			{
				text: "WebGPU",
				mark: {
					background: "#f59e0b33",
					borderRadius: 4,
					paddingX: 6,
					paddingY: 2,
				},
			},
			{ text: " and " },
			{ text: "E=mc", fontSize: 20 },
			{ text: "2", fontSize: 20, baselineShift: -8 },
			{ text: "." },
		]);
	});

	it("Layer.text seamlessly accepts rich tagged template literals", () => {
		const node = Layer.text(
			rich`Build ${bold("faster", { fill: "#10b981" })} with ${accent("Gitframes")}`,
			{
				fontSize: 36,
				id: "hero-title",
			},
		);

		expect(node.id).toBe("hero-title");
		expect(node.kind).toBe("text");
		expect(node.fontSize).toBe(36);
		expect(node.text).toBe("Build faster with Gitframes");
		expect(node.spans).toBeDefined();
		expect(node.spans?.length).toBe(4);
		expect(node.spans?.[1]).toEqual({
			text: "faster",
			fontWeight: 700,
			fill: "#10b981",
		});
		expect(node.spans?.[3]).toEqual({
			text: "Gitframes",
			fill: "#6366f1",
		});
	});

	it("Composition toSpec produces schema-valid CompositorProgram with spans", () => {
		const comp = new Composition({
			width: 1920,
			height: 1080,
			fps: 60,
			durationFrames: 120,
		});

		const textLayer = Layer.text(
			rich`Scale ${bold("10x", { fill: "#6366f1" })} with ${mark("WebGPU", { bg: "#22c55e33" })}`,
			{
				x: 100,
				y: 200,
				fontSize: 48,
			},
		);

		comp.add(textLayer);

		const spec = comp.toSpec();
		expect(() => CompositorProgramSchema.parse(spec)).not.toThrow();

		const textItem = spec.layout[0];
		expect(textItem).toBeDefined();
		expect(textItem?.kind).toBe("text");
		if (textItem && textItem.kind === "text") {
			expect(textItem.text).toBe("Scale 10x with WebGPU");
			expect(textItem.spans).toBeDefined();
			expect(textItem.spans?.length).toBe(4);
			expect(textItem.spans?.[1]).toEqual({
				text: "10x",
				fontWeight: 700,
				fill: "#6366f1",
			});
			expect(textItem.spans?.[3]).toEqual({
				text: "WebGPU",
				fill: undefined,
				mark: {
					background: "#22c55e33",
					borderRadius: 4,
					paddingX: 6,
					paddingY: 2,
				},
			});
		}

		// Also verify toVirtualMedia compiles clean AST
		const vm = comp.toVirtualMedia();
		expect(vm).toBeDefined();
		expect(vm.operation.op).toBe("Compositor");
	});
});
