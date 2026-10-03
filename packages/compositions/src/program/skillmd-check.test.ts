import { describe, expect, it } from "vitest";
import { CompositorProgramSchema } from "./schema.js";

/**
 * Contract test: the example config published in
 * `nodes/node-compositor/SKILL.md` must always parse against the schema.
 * (Kept in sync with that file's ```json block.)
 */
const SKILL_MD_EXAMPLE = {
	width: 1920,
	height: 1080,
	backgroundColor: "#16130d",
	fps: 24,
	mode: "Video",
	layout: [
		{
			id: "hero",
			kind: "flex",
			dir: "column",
			gap: 24,
			padding: 80,
			align: "center",
			width: "fill",
			height: "fill",
			animation: {
				tracks: [
					{
						id: "hero-fade",
						prop: "opacity",
						keyframes: [
							{ id: "kf0", frame: 0, value: 0 },
							{
								id: "kf1",
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
					text: "Rendered by the compositor layout engine",
					fontSize: 40,
					fill: "#b8a88a",
				},
				{
					id: "badges",
					kind: "flex",
					dir: "row",
					gap: 16,
					animation: {
						tracks: [
							{
								id: "badges-rise",
								prop: "y",
								keyframes: [
									{ id: "kf0", frame: 0, value: 40 },
									{
										id: "kf1",
										frame: 20,
										value: 0,
										ease: { name: "back", dir: "out" },
									},
								],
							},
						],
					},
					children: [
						{
							id: "chip-avatar",
							kind: "box",
							width: 160,
							height: 48,
							borderRadius: 24,
							background: "#3a2f1e",
						},
						{
							id: "chip-hero",
							kind: "box",
							width: 160,
							height: 48,
							borderRadius: 24,
							background: "#3a2f1e",
						},
					],
				},
			],
		},
		{
			id: "avatar-img",
			kind: "media",
			inputHandleId: "avatar",
			fit: "cover",
			width: 200,
			height: 200,
			borderRadius: 100,
			startFrame: 0,
			durationFrames: 72,
			animation: {
				tracks: [
					{
						id: "avatar-pop",
						prop: "scale",
						keyframes: [
							{ id: "kf0", frame: 0, value: 1.15 },
							{ id: "kf1", frame: 30, value: 1 },
						],
					},
				],
			},
		},
	],
} as const;

describe("SKILL.md example config (agent-facing contract)", () => {
	it("parses against CompositorProgramSchema", () => {
		const parsed = CompositorProgramSchema.safeParse(SKILL_MD_EXAMPLE);
		expect(parsed.success).toBe(true);
		if (!parsed.success) {
			console.error(JSON.stringify(parsed.error.issues, null, 2));
		}
		if (parsed.success) {
			expect(parsed.data.layout[0].kind).toBe("flex");
			const hero = parsed.data.layout[0];
			if (hero.kind === "flex") {
				expect(hero.animation?.tracks[0].prop).toBe("opacity");
				expect(hero.children?.length).toBe(3);
			}
			expect(parsed.data.layout[1].kind).toBe("media");
		}
	});
});
