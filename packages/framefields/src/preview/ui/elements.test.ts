// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PreviewPlayer } from "../player.js";
import type { PreviewNote } from "../protocol.js";
import { PreviewApp } from "./app.js";
import { defineElements } from "./components/index.js";
import type { PreviewServer } from "./server.js";

// jsdom lays nothing out: no observers, no pointer capture, no geometry.
class NoResize {
	observe() {}
	disconnect() {}
}
const STAGE = { left: 100, top: 50, width: 400, height: 200 };

const notes: PreviewNote[] = [
	{
		id: 1,
		frame: 0,
		time: 0,
		x: 0.5,
		y: 0.5,
		text: "Bigger title",
		done: false,
		created: "",
	},
	{
		id: 2,
		frame: 0,
		time: 0,
		x: 0.1,
		y: 0.2,
		w: 0.3,
		h: 0.4,
		text: "Darker sky",
		done: true,
		created: "",
	},
	{
		id: 3,
		frame: 30,
		time: 3,
		x: 0.9,
		y: 0.9,
		text: "Later",
		done: false,
		created: "",
	},
];

const server: PreviewServer = {
	meta: async () => ({
		session: "s",
		notesDir: "/p/.framefields/preview-notes",
		title: "Film",
		fps: 10,
		frameCount: 50,
		width: 64,
		height: 36,
		audio: { state: "none" },
	}),
	listNotes: async () => notes,
	changeNote: () => Promise.reject(new Error("offline")),
	log: () => {},
	mixAudio: () => {},
	audio: async () => new ArrayBuffer(0),
	events: () => () => {},
};

const player = {
	meta: { width: 64, height: 36, fps: 10, frameCount: 50, durationMs: 5000 },
	lastRenderMs: 0,
	hasVision: false,
	render: async (frame: number) => frame,
	warm: async () => true,
} as unknown as PreviewPlayer;

function pointer(type: string, x: number, y: number) {
	return new MouseEvent(type, {
		bubbles: true,
		button: 0,
		clientX: x,
		clientY: y,
	});
}

const settle = async (app: PreviewApp) => {
	await new Promise((r) => setTimeout(r, 0));
	const page = document.querySelector("ff-preview");
	for (const el of Array.from(page?.querySelectorAll("*") ?? [])) {
		const update = (el as { updateComplete?: Promise<unknown> }).updateComplete;
		if (update) await update;
	}
	return app;
};

describe("the preview page's elements", () => {
	let app: PreviewApp;

	beforeAll(async () => {
		// Node's own (file-less) localStorage would shadow the page's.
		const stored = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => stored.get(k) ?? null,
			setItem: (k: string, v: string) => stored.set(k, v),
		});
		globalThis.ResizeObserver =
			NoResize as unknown as typeof globalThis.ResizeObserver;
		Element.prototype.setPointerCapture = () => {};
		defineElements();
		window.framefieldsPlayer = Promise.resolve(player);
		app = new PreviewApp({ server, embedded: false });
		const page = document.createElement("ff-preview");
		page.app = app;
		document.body.append(page);
		await app.start();
		await app.whenReady();
		await settle(app);
		const stage = document.querySelector<HTMLElement>("ff-stage .stage");
		if (stage)
			stage.getBoundingClientRect = () =>
				({ ...STAGE, right: 500, bottom: 250 }) as DOMRect;
	});

	afterAll(() => {
		vi.unstubAllGlobals();
		app.close();
		document.body.replaceChildren();
	});

	it("gives the player its canvas and shows the film", () => {
		expect(document.querySelectorAll("canvas#canvas")).toHaveLength(1);
		expect(document.querySelector("h1")?.textContent).toBe("Film");
		expect(document.querySelector(".spec")?.textContent).toBe(
			"64×36 · 10 fps · 0:04.90",
		);
		// Nothing says "no audio" in words: the speaker is crossed out and says why.
		expect(document.querySelector(".chip")).toBeNull();
		const speaker = document.querySelector(".volume .icon-btn");
		expect(speaker?.getAttribute("title")).toBe("No audio in this composition");
		expect(speaker?.getAttribute("aria-disabled")).toBe("true");
		expect(document.querySelector(".volume .slider")).toBeNull();
		const notes = document.querySelector(".notes-btn");
		expect(notes?.getAttribute("aria-label")).toBe("Notes: 2 open of 3");
		expect(notes?.textContent?.replace(/\s+/g, "")).toBe("2");
		const stage = document.querySelector<HTMLElement>(".stage");
		expect(stage?.style.getPropertyValue("--ar")).toBe("64 / 36");
		expect(document.querySelector(".play-btn")?.hasAttribute("disabled")).toBe(
			false,
		);
	});

	it("pins this frame's notes on the picture and every note on the timeline", () => {
		const pins = Array.from(document.querySelectorAll(".overlay .pin"));
		expect(pins.map((p) => p.getAttribute("aria-label"))).toEqual([
			"Note 1",
			"Note 2",
		]);
		expect(pins[1].classList.contains("done")).toBe(true);
		expect(document.querySelectorAll(".overlay .area")).toHaveLength(1);
		const marks = Array.from(document.querySelectorAll(".note-mark"));
		expect(marks.map((m) => m.textContent?.trim())).toEqual(["1", "2", "3"]);
		expect(document.querySelector(".notes-btn .badge")?.textContent).toBe("2");
		const rows = Array.from(document.querySelectorAll(".note-row .text"));
		expect(rows.map((r) => r.textContent)).toEqual([
			"Bigger title",
			"Darker sky",
			"Later",
		]);
	});

	it("opens a note's card from its pin", async () => {
		document.querySelector<HTMLElement>(".overlay .pin")?.click();
		await settle(app);
		expect(app.openId).toBe(1);
		const pop = document.querySelector(".pop");
		expect(pop?.classList.contains("on")).toBe(true);
		expect(pop?.querySelector(".pop-text")?.textContent).toBe("Bigger title");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await settle(app);
		expect(app.openId).toBeNull();
		expect(pop?.classList.contains("on")).toBe(false);
	});

	it("marks a spot with a click and an area with a drag", async () => {
		const stage = document.querySelector<HTMLElement>("ff-stage .stage");
		if (!stage) throw new Error("no stage");
		stage.dispatchEvent(pointer("pointerdown", 200, 100));
		stage.dispatchEvent(pointer("pointerup", 200, 100));
		await settle(app);
		expect(app.draft).toEqual({ frame: 0, x: 0.25, y: 0.25, text: "" });
		const textarea =
			document.querySelector<HTMLTextAreaElement>(".pop textarea");
		expect(textarea).not.toBeNull();
		expect(document.activeElement).toBe(textarea);
		expect(document.querySelector(".pin.draft")).not.toBeNull();

		// An empty draft gives way to the next press.
		stage.dispatchEvent(pointer("pointerdown", 140, 70));
		stage.dispatchEvent(pointer("pointermove", 340, 170));
		await settle(app);
		const marquee = document.querySelector<HTMLElement>(".marquee");
		expect(marquee?.style.left).toBe("10%");
		expect(marquee?.style.width).toBe("50%");
		stage.dispatchEvent(pointer("pointerup", 340, 170));
		await settle(app);
		expect(app.draft).toMatchObject({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
		expect(document.querySelector(".pop .pop-head")?.textContent).toContain(
			"area",
		);

		// Saving fails (the stand-in server is offline): the draft stays, and says so.
		const ta = document.querySelector<HTMLTextAreaElement>(".pop textarea");
		if (!ta) throw new Error("no textarea");
		ta.value = "Tighter crop";
		ta.dispatchEvent(new Event("input"));
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await settle(app);
		await settle(app);
		expect(app.draft?.text).toBe("Tighter crop");
		expect(document.querySelector(".pop-foot .err")?.textContent).toBe(
			"Couldn't save. Is the preview running?",
		);

		// Escape in the editor cancels it.
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await settle(app);
		expect(app.draft).toBeNull();
	});

	it("seeks from the timeline and the transport", async () => {
		await app.seek(10);
		await settle(app);
		const position = document.querySelector<HTMLElement>(".position");
		expect(position?.textContent?.replace(/\s+/g, "")).toBe("0:01.00/0:04.90");
		expect(position?.getAttribute("aria-label")).toBe(
			"Time 0:01.00 of 0:04.90. Click to show frames.",
		);
		// A click shows frames instead, and the page remembers it.
		position?.click();
		await settle(app);
		expect(position?.textContent?.replace(/\s+/g, "")).toBe("10/49");
		expect(position?.getAttribute("aria-label")).toBe(
			"Frame 10 of 49. Click to show time.",
		);
		expect(localStorage.getItem("framefields-preview:position")).toBe("frames");
		position?.click();
		await settle(app);
		expect(localStorage.getItem("framefields-preview:position")).toBe("time");
		document
			.querySelector<HTMLElement>(".icon-btn[aria-label='Next frame']")
			?.click();
		await settle(app);
		expect(app.frame).toBe(11);
		expect(document.querySelector<HTMLElement>(".playhead")?.style.left).toBe(
			`${(11 / 49) * 100}%`,
		);
		// No pins at a frame without notes.
		expect(document.querySelectorAll(".overlay .pin")).toHaveLength(0);
	});

	it("takes the keyboard, except while typing", async () => {
		await app.seek(20);
		await settle(app);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		await settle(app);
		expect(app.frame).toBe(21);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowLeft",
				shiftKey: true,
				bubbles: true,
			}),
		);
		await settle(app);
		expect(app.frame).toBe(11);
		const input = document.querySelector<HTMLInputElement>(".slider");
		input?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		await settle(app);
		expect(app.frame).toBe(11);
		const timeline = document.querySelector(".timeline");
		expect(timeline?.getAttribute("role")).toBe("slider");
		expect(timeline?.getAttribute("aria-valuetext")).toBe("0:01.10, frame 11");
		expect(document.querySelector(".playhead-time")?.textContent?.trim()).toBe(
			"0:01.10",
		);
	});

	it("shows its header when it isn't embedded", () => {
		expect(document.querySelector("ff-header .top")).not.toBeNull();
		expect(document.documentElement.hasAttribute("data-embed")).toBe(false);
	});
});
