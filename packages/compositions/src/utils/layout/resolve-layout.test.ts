import { describe, expect, it } from "vitest";
import type { LayoutNode } from "../../program/schema.js";
import { computeLayout } from "./resolve-layout.js";

const measure = (node: LayoutNode) => {
	switch (node.id) {
		case "title":
			return { width: 800, height: 80 };
		case "subtitle":
			return { width: 500, height: 40 };
		case "chip":
			return { width: 120, height: 60 };
		default:
			return null;
	}
};

const program = (layout: LayoutNode[], width = 1000, height = 600) => ({
	layout,
	viewport: { width, height },
	measure,
});

const rect = (
	r: Record<string, { x: number; y: number; width: number; height: number }>,
	id: string,
) => r[id];

describe("computeLayout — flex column (the hero/title case)", () => {
	const doc: LayoutNode[] = [
		{
			id: "hero",
			kind: "flex",
			dir: "column",
			gap: 24,
			padding: 20,
			align: "center",
			width: "fill",
			children: [
				{ id: "title", kind: "text", text: "Big Title" },
				{ id: "subtitle", kind: "text", text: "Subtitle" },
			],
		},
	];

	it("stacks children vertically with gap, centered against the container width", async () => {
		const { rects, sizes } = await computeLayout(program(doc));
		// container fills width, height = content
		expect(sizes.hero).toEqual({ width: 1000, height: 184 }); // 80+40+24 + 2*20
		// title centered horizontally: innerW=960, child 800 → (960-800)/2=80, +pad 20
		expect(rect(rects, "title")).toEqual({
			x: 100,
			y: 20,
			width: 800,
			height: 80,
		});
		// subtitle centered on its own: (960-500)/2=230, +pad 20
		expect(rect(rects, "subtitle")).toEqual({
			x: 250,
			y: 124,
			width: 500,
			height: 40,
		});
	});

	it("is deterministic — identical input yields identical rects", async () => {
		const input = program(doc);
		const a = await computeLayout(input);
		const b = await computeLayout(input);
		expect(a).toEqual(b);
	});

	it("re-lays-out when the viewport changes (responsive)", async () => {
		const { rects } = await computeLayout(program(doc, 500, 600));
		// innerW = 460; a child wider than the container overflows centered
		// (CSS-like): 20 + (460-800)/2 = -150
		expect(rect(rects, "title").x).toBe(-150);
		expect(rect(rects, "title").width).toBe(800);
	});
});

describe("computeLayout — flex row", () => {
	it("gives 'fill' children the leftover main-axis space", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				gap: 10,
				width: "fill",
				height: 100,
				children: [
					{ id: "a", kind: "box", width: 100, height: 50 },
					{ id: "b", kind: "box", width: "fill" },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 1000, 200));
		expect(rect(rects, "a")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
		// leftover = 1000 - 10(gap) - 100 = 890
		expect(rect(rects, "b").x).toBe(110);
		expect(rect(rects, "b").width).toBe(890);
	});

	it("splits leftover among multiple fills by grow weight", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: "fill",
				children: [
					{ id: "a", kind: "box", width: "fill", grow: 1 },
					{ id: "c", kind: "box", width: "fill", grow: 3 },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 400, 100));
		expect(rect(rects, "a").width).toBe(100); // 400 * 1/4
		expect(rect(rects, "c").width).toBe(300); // 400 * 3/4
	});

	it("justify: space-between spreads children with leftover gaps", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				justify: "space-between",
				width: "fill",
				children: [
					{ id: "a", kind: "box", width: 60, height: 20 },
					{ id: "b", kind: "box", width: 60, height: 20 },
					{ id: "c", kind: "box", width: 60, height: 20 },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 300, 100));
		expect(rect(rects, "a").x).toBe(0);
		expect(rect(rects, "b").x).toBe(120); // 60 + 60 spacing
		expect(rect(rects, "c").x).toBe(240);
	});

	it("align: stretch stretches auto-height children to the container", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				align: "stretch",
				width: "fill",
				height: 200,
				children: [{ id: "a", kind: "box", width: 100 }],
			},
		];
		const { rects } = await computeLayout(program(doc, 400, 400));
		expect(rect(rects, "a").height).toBe(200);
	});
});

describe("computeLayout — block", () => {
	it("block container width defaults to fill (HTML-like)", async () => {
		const doc: LayoutNode[] = [
			{
				id: "stack",
				kind: "block",
				gap: 10,
				children: [{ id: "a", kind: "box", width: 200, height: 20 }],
			},
		];
		const { rects, sizes } = await computeLayout(program(doc, 1000, 100));
		expect(sizes.stack).toEqual({ width: 1000, height: 20 });
		expect(rect(rects, "a").x).toBe(0);
	});
});

describe("computeLayout — wrap", () => {
	it("breaks lines when the row overflows", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				wrap: true,
				width: 100,
				children: [
					{ id: "a", kind: "box", width: 40, height: 20 },
					{ id: "b", kind: "box", width: 40, height: 20 },
					{ id: "c", kind: "box", width: 40, height: 20 },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 100, 100));
		expect(rect(rects, "a")).toEqual({ x: 0, y: 0, width: 40, height: 20 });
		expect(rect(rects, "b")).toEqual({ x: 40, y: 0, width: 40, height: 20 });
		expect(rect(rects, "c")).toEqual({ x: 0, y: 20, width: 40, height: 20 }); // line 2
	});
});

describe("computeLayout — absolute positioning", () => {
	it("places absolute nodes verbatim and excludes them from layout", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: 300,
				children: [
					{
						id: "abs",
						kind: "box",
						position: "absolute",
						x: 10,
						y: 20,
						width: 50,
						height: 30,
					},
					{ id: "inline", kind: "box", width: 100, height: 20 },
				],
			},
		];
		const { rects, sizes } = await computeLayout(program(doc, 300, 100));
		expect(rect(rects, "abs")).toEqual({ x: 10, y: 20, width: 50, height: 30 });
		// absolute does not contribute to container size (natural = inline only)
		expect(sizes.row).toEqual({ width: 300, height: 20 });
		expect(rect(rects, "inline").x).toBe(0);
	});

	it("does not double-offset nodes with implicit absolute coordinates (omitted position)", async () => {
		const doc: LayoutNode[] = [
			{
				id: "canvas",
				kind: "box",
				width: 1000,
				height: 600,
				children: [
					{
						id: "tracked",
						kind: "box",
						x: 250,
						y: 120,
						width: 100,
						height: 100,
					},
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 1000, 600));
		expect(rect(rects, "tracked")).toEqual({
			x: 250,
			y: 120,
			width: 100,
			height: 100,
		});
	});

	it("oversized layers are NOT clamped to the canvas (viewport masks, layer pans)", async () => {
		// canvas 1024×1024; layer box 2000×2000 — the rect must stay 2000×2000
		// and follow x/y EXACTLY (clipping is the canvas viewport's job, and it
		// must depend on the layer's position).
		const mk = (x: number, y: number): LayoutNode[] => [
			{
				id: "img",
				kind: "media",
				inputHandleId: "h1",
				position: "absolute",
				x,
				y,
				width: 2000,
				height: 2000,
			},
		];
		const base = {
			layout: mk(0, 0),
			viewport: { width: 1024, height: 1024 },
			measure: () => ({ width: 1000, height: 800 }),
		};
		const at0 = await computeLayout(base);
		expect(rect(at0.rects, "img")).toEqual({
			x: 0,
			y: 0,
			width: 2000,
			height: 2000,
		});

		// dragging the layer pans the viewport window over the content
		const panned = await computeLayout({
			...base,
			layout: mk(512, 300),
		});
		expect(rect(panned.rects, "img")).toEqual({
			x: 512,
			y: 300,
			width: 2000,
			height: 2000,
		});
	});

	it("does not clamp oversized ABSOLUTE children of a container either", async () => {
		const { rects } = await computeLayout({
			layout: [
				{
					id: "root",
					kind: "flex",
					width: "fill",
					height: "fill",
					children: [
						{
							id: "big",
							kind: "media",
							inputHandleId: "h1",
							position: "absolute",
							x: -10,
							y: -10,
							width: 2000,
							height: 1500,
						},
					],
				},
			],
			viewport: { width: 1024, height: 1024 },
			measure: () => ({ width: 900, height: 900 }),
		});
		// placed at parent content origin + (-10,-10), unclamped
		expect(rect(rects, "big")).toEqual({
			x: -10,
			y: -10,
			width: 2000,
			height: 1500,
		});
	});

	it("places editor-dragged roots at their x/y (text + media placement)", async () => {
		// A doc saved by the editor after dragging two layers: text at 268,153
		// and media at -131,234. Must render exactly there.
		const { rects } = await computeLayout({
			layout: [
				{
					id: "txt",
					kind: "text",
					text: "dwadadaw",
					position: "absolute",
					x: 268,
					y: 153,
				},
				{
					id: "img",
					kind: "media",
					inputHandleId: "h1",
					position: "absolute",
					x: -131,
					y: 234,
				},
			],
			viewport: { width: 1080, height: 1080 },
			measure: (n) =>
				n.id === "img"
					? { width: 320, height: 180 }
					: { width: 220, height: 60 },
		});
		expect(rect(rects, "txt")).toEqual({
			x: 268,
			y: 153,
			width: 220,
			height: 60,
		});
		expect(rect(rects, "img")).toEqual({
			x: -131,
			y: 234,
			width: 320,
			height: 180,
		});
	});
});

describe("computeLayout — animated props re-layout per frame", () => {
	it("different measure (frame-varying size) yields different rects", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				gap: 10,
				width: "fill",
				children: [
					{ id: "a", kind: "box" },
					{ id: "b", kind: "box" },
				],
			},
		];
		const frameA = await computeLayout({
			...program(doc, 300, 40),
			measure: () => ({ width: 100, height: 40 }),
		});
		const frameB = await computeLayout({
			...program(doc, 300, 40),
			measure: () => ({ width: 150, height: 40 }),
		});
		expect(frameA.rects.b.x).toBe(110);
		// In frameB, 150 + 10 + 150 = 310 > 300 container width.
		// With standard flexShrink (1), children shrink by 5px each (to 145px) to fit container.
		expect(frameB.rects.b.x).toBe(155);
	});
});

describe("computeLayout — childless fit box (SKILL.md example guard)", () => {
	it("has no intrinsic size — a fit box with no measurable content collapses (CSS fit-content with no content)", async () => {
		const doc: LayoutNode[] = [
			{
				id: "chip-empty",
				kind: "box",
				width: "fit",
				borderRadius: 24,
				background: "#3a2f1e",
			},
		];
		const { sizes } = await computeLayout(program(doc, 400, 100));
		// A fit box with no measurable content has NO intrinsic size: its
		// main-axis (height) collapses to 0 — the chip is invisible regardless
		// of the cross-axis stretch (400 = wrapper align-stretch). The SKILL.md
		// hero example gives chips explicit width/height for this reason;
		// keep that contract visible.
		expect(sizes["chip-empty"]).toEqual({ width: 400, height: 0 });
	});
});

describe("computeLayout — Yoga-specific features", () => {
	it("supports flexShrink", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: 200,
				children: [
					{ id: "a", kind: "box", width: 150, height: 50, flexShrink: 1 },
					{ id: "b", kind: "box", width: 150, height: 50, flexShrink: 1 },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 200, 100));
		// Both shrink equally from 150 to fit 200px: 100 each
		expect(rect(rects, "a").width).toBe(100);
		expect(rect(rects, "b").width).toBe(100);
	});

	it("supports dynamic aspect ratio scaling for media nodes inside flex containers", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				height: 100,
				children: [
					{
						id: "video",
						kind: "media",
						inputHandleId: "v1",
						width: "auto",
						height: "fill",
					},
				],
			},
		];
		const { sizes } = await computeLayout({
			layout: doc,
			viewport: { width: 400, height: 400 },
			measure: (node) => {
				if (node.id === "video") return { width: 1920, height: 1080 };
				return null;
			},
		});
		expect(sizes.video.height).toBe(100);
		expect(sizes.video.width).toBe(178);
	});

	it("supports relative positioning offsets and shifts children accordingly", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: 400,
				height: 100,
				children: [
					{ id: "a", kind: "box", width: 100, height: 50 },
					{
						id: "b",
						kind: "flex",
						dir: "column",
						width: 100,
						height: 50,
						position: "relative",
						x: 15,
						y: -10,
						children: [{ id: "c", kind: "box", width: 50, height: 20 }],
					},
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 400, 100));
		// Child 'a' is at normal flow position (0, 0)
		expect(rect(rects, "a")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
		// Child 'b' normal flow position would start at x: 100, y: 0.
		// It has relative offsets x: 15, y: -10.
		expect(rect(rects, "b")).toEqual({
			x: 115,
			y: -10,
			width: 100,
			height: 50,
		});
		// Child 'c' inside parent 'b' should shift along with its parent
		expect(rect(rects, "c")).toEqual({ x: 115, y: -10, width: 50, height: 20 });
	});

	it("defaults flexShrink to 1 for children in flex container", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: 200,
				height: 50,
				children: [
					{ id: "a", kind: "box", width: 150, height: 50 },
					{ id: "b", kind: "box", width: 150, height: 50 },
				],
			},
		];
		const { rects } = await computeLayout(program(doc, 1000, 600));
		// Container width is 200, children total 300; both shrink equally to 100px
		expect(rect(rects, "a").width).toBe(100);
		expect(rect(rects, "b").width).toBe(100);
	});

	it("scales auto-sized media proportionally down when constrained by flex container", async () => {
		const doc: LayoutNode[] = [
			{
				id: "row",
				kind: "flex",
				dir: "row",
				width: 300,
				height: 100,
				align: "stretch",
				children: [
					{
						id: "img",
						kind: "media",
						inputHandleId: "img1",
					},
				],
			},
		];
		const { rects } = await computeLayout({
			layout: doc,
			viewport: { width: 500, height: 500 },
			measure: () => ({ width: 1920, height: 1080 }),
		});
		// Stretched to height 100, width scaled by 16:9 ratio -> 178px
		expect(rect(rects, "img").height).toBe(100);
		expect(rect(rects, "img").width).toBe(178);
	});
});
