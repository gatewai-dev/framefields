import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { TITLE_LAYOUTS, titleCard } from "./index.js";

const make = () => bind(fakeHost(), titleCard);
type Node = { id?: string; x?: number; width?: number; children?: Node[] };

describe("TitleCard", () => {
	it("keeps every part inside its width, in every layout", () => {
		for (const layout of TITLE_LAYOUTS) {
			const card = make()({
				kicker: "Chapter one",
				title: "A headline that wraps across the card",
				subtitle: "and a sub-line",
				layout,
				width: 900,
				titleSize: 60,
			});
			const parts = ((card as unknown as Node).children?.[0]?.children ??
				[]) as Node[];
			for (const p of parts) {
				expect(p.x ?? 0).toBeGreaterThanOrEqual(0);
				expect((p.x ?? 0) + (p.width ?? 0)).toBeLessThanOrEqual(900 + 1e-6);
			}
		}
	});

	it("reveals the headline, then settles, then stays", () => {
		const card = make()({ kicker: "k", title: "Title", subtitle: "s" });
		const revealed = card.cues.revealed[0]?.frame ?? 0;
		expect(revealed).toBeGreaterThan(0);
		expect(card.cues.settled[0]?.frame).toBeGreaterThanOrEqual(revealed);
		expect(card.span.end).toBe(Number.POSITIVE_INFINITY);
	});

	it("plays out after the hold when asked", () => {
		const card = make()({
			title: "Title",
			subtitle: "s",
			exitStyle: "rise",
			hold: 20,
		});
		const settled = card.cues.settled[0]?.frame ?? 0;
		expect(card.cues.exitStart[0]?.frame).toBe(settled + 20);
		expect(card.span.duration).toBeGreaterThan(settled + 20);
	});
});
