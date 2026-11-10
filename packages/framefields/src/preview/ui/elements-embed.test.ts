// @vitest-environment jsdom
import { afterAll, describe, expect, it } from "vitest";
import { PreviewApp } from "./app.js";
import { defineElements } from "./components/index.js";
import type { PreviewServer } from "./server.js";

class NoResize {
	observe() {}
	disconnect() {}
}

const server: PreviewServer = {
	meta: async () => ({
		session: "s",
		notesDir: null,
		title: "Film",
		fps: 10,
		frameCount: 50,
		width: 64,
		height: 36,
		audio: { state: "mixing" },
	}),
	listNotes: async () => [],
	changeNote: () => Promise.reject(new Error("off")),
	log: () => {},
	mixAudio: () => {},
	audio: async () => new ArrayBuffer(0),
	events: () => () => {},
};

describe("the embedded page (?embed=1)", () => {
	afterAll(() => {
		document.body.replaceChildren();
		history.replaceState(null, "", "/");
	});

	it("drops its header and says what it would have shown in the transport", async () => {
		globalThis.ResizeObserver =
			NoResize as unknown as typeof globalThis.ResizeObserver;
		history.replaceState(null, "", "/?embed=1#t=1");
		defineElements();
		const app = new PreviewApp({ server });
		expect(app.embedded).toBe(true);
		const page = document.createElement("ff-preview");
		page.app = app;
		document.body.append(page);
		await app.start();
		await new Promise((r) => setTimeout(r, 0));
		await page.updateComplete;
		for (const el of Array.from(page.querySelectorAll("*"))) {
			const update = (el as { updateComplete?: Promise<unknown> })
				.updateComplete;
			if (update) await update;
		}
		expect(document.documentElement.hasAttribute("data-embed")).toBe(true);
		expect(page.querySelector("ff-header")).toBeNull();
		expect(page.querySelector(".top")).toBeNull();
		// The soundtrack is still mixing: with no header, the transport says so.
		expect(page.querySelector(".transport .chip")?.textContent).toContain(
			"Mixing audio",
		);
		expect(page.querySelector("canvas#canvas")).not.toBeNull();
		expect(app.frame).toBe(10);
		app.close();
	});
});
