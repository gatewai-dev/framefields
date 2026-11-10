// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewMessage } from "../embed-protocol.js";
import type { PreviewPlayer } from "../player.js";
import type {
	AudioStatus,
	NoteRequest,
	PreviewMetaReply,
	PreviewNote,
} from "../protocol.js";
import { PreviewApp } from "./app.js";
import { connectEmbedder, STATE_INTERVAL_MS } from "./channel.js";
import type { PreviewServer, ServerEvents } from "./server.js";

const META: PreviewMetaReply = {
	session: "s1",
	notesDir: "/project/.framefields/preview-notes",
	title: "Film",
	fps: 10,
	frameCount: 50,
	width: 64,
	height: 36,
	audio: { state: "none" },
};

function fakeServer(notes: PreviewNote[] = []) {
	const changes: NoteRequest[] = [];
	const logs: string[] = [];
	let on: ServerEvents | undefined;
	const server: PreviewServer = {
		meta: async () => META,
		listNotes: async () => notes,
		changeNote: async (request) => {
			changes.push(request);
			if (request.op !== "add") throw new Error("unexpected");
			return {
				...request.note,
				id: 7,
				done: false,
				created: "now",
			} as PreviewNote;
		},
		log: (line) => logs.push(`${line.level}: ${line.message}`),
		mixAudio: () => {},
		audio: async () => new ArrayBuffer(0),
		events: (handlers) => {
			on = handlers;
			return () => {};
		},
	};
	return {
		server,
		changes,
		logs,
		emit: () => on as ServerEvents,
	};
}

function fakePlayer() {
	const rendered: number[] = [];
	const player: PreviewPlayer = {
		meta: { width: 64, height: 36, fps: 10, frameCount: 50, durationMs: 5000 },
		canvas: document.createElement("canvas"),
		lastRenderMs: 3,
		hasVision: false,
		render: async (frame) => {
			rendered.push(frame);
			return frame;
		},
		warm: async () => true,
		mixAudio: () => Promise.reject(new Error("no mixing here")),
		snapshot: () => Promise.reject(new Error("no snapshots here")),
		dispose: async () => {},
	};
	return { player, rendered };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A page with its player ready, as the composition's bundle announces it. */
async function startApp(
	options: {
		notes?: PreviewNote[];
		/** Runs before the app starts, e.g. to connect an embedder. */
		connect?: (app: PreviewApp) => void;
	} = {},
) {
	const { player, rendered } = fakePlayer();
	window.framefieldsPlayer = Promise.resolve(player);
	const server = fakeServer(options.notes);
	const app = new PreviewApp({ server: server.server });
	options.connect?.(app);
	await app.start();
	await app.whenReady();
	await tick();
	return { app, rendered, player, ...server };
}

describe("PreviewApp", () => {
	beforeEach(() => {
		history.replaceState(null, "", "/");
		delete document.documentElement.dataset.preview;
	});
	afterEach(() => {
		window.framefieldsPlayer = undefined;
	});

	it("opens at the moment the address names and says it's ready", async () => {
		history.replaceState(null, "", "/#t=1.5");
		const { app, rendered } = await startApp();
		expect(app.frame).toBe(15);
		expect(rendered).toEqual([15]);
		expect(app.pageState).toBe("ready");
		expect(document.documentElement.dataset.preview).toBe("ready");
		expect(document.title).toBe("Film · preview");
		expect(window.framefieldsPreview?.state()).toMatchObject({
			state: "ready",
			frame: 15,
			time: 1.5,
			playing: false,
			audio: "none",
			connected: true,
			meta: { title: "Film", fps: 10, frameCount: 50, duration: 4.9 },
		});
		app.close();
	});

	it("seeks in place when the fragment changes", async () => {
		const { app, rendered } = await startApp();
		expect(rendered).toEqual([0]);

		location.hash = "#t=2";
		await vi.waitFor(() => expect(app.frame).toBe(20));
		expect(rendered.at(-1)).toBe(20);
		// Its own position keeping replaces the fragment without an event.
		expect(location.hash).toBe("#t=2");

		location.hash = "#frame=33";
		await vi.waitFor(() => expect(app.frame).toBe(33));
		expect(location.hash).toBe("#t=3.3");

		// The moment it shows already: nothing to draw.
		const drawn = rendered.length;
		location.hash = "#frame=33";
		location.hash = "#t=3.3&x";
		await tick();
		await tick();
		expect(rendered.length).toBe(drawn);

		// A fragment that names no moment is left alone.
		location.hash = "#notes";
		await tick();
		expect(app.frame).toBe(33);
		app.close();
	});

	it("pauses first when the fragment changes during playback", async () => {
		const { app } = await startApp();
		app.play();
		expect(app.playing).toBe(true);
		location.hash = "#t=4";
		await vi.waitFor(() => expect(app.frame).toBe(40));
		expect(app.playing).toBe(false);
		app.close();
	});

	it("drives the page through window.framefieldsPreview", async () => {
		const { app, rendered } = await startApp();
		const api = window.framefieldsPreview;
		await api?.seek(1.2);
		expect(rendered.at(-1)).toBe(12);
		await api?.seekFrame(400);
		expect(app.frame).toBe(49);
		expect(location.hash).toBe("#t=4.9");
		await api?.seekFrame(0);
		// Back at the start, the address has no fragment.
		expect(location.hash).toBe("");
		app.close();
	});

	it("pins a note to a spot and saves it with its moment", async () => {
		const { app, changes, logs } = await startApp();
		await app.seek(12);
		app.beginDraft({ x: 0.25, y: 0.5 }, null);
		expect(app.draft).toEqual({ frame: 12, x: 0.25, y: 0.5, text: "" });
		expect(await app.saveDraft()).toBe(false);

		app.setDraftText("  Bigger title ");
		expect(await app.saveDraft()).toBe(true);
		expect(changes).toEqual([
			{
				op: "add",
				note: {
					frame: 12,
					time: 1.2,
					x: 0.25,
					y: 0.5,
					w: undefined,
					h: undefined,
					text: "Bigger title",
					image: undefined,
				},
			},
		]);
		// No picture (the stand-in player can't take one): reported, with where.
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatch(
			/^warning: \[framefields\] no picture for the note: Error: no snapshots here\n {4}at /,
		);
		expect(app.draft).toBeNull();
		expect(app.notes.map((n) => n.id)).toEqual([7]);
		expect(app.toastText).toBe("Note 7 saved");
		expect(window.framefieldsPreview?.notes()).toHaveLength(1);
		app.close();
	});

	it("keeps notes current from the server and closes a deleted note's card", async () => {
		const first: PreviewNote = {
			id: 1,
			frame: 5,
			time: 0.5,
			x: 0.1,
			y: 0.1,
			text: "a",
			done: false,
			created: "",
		};
		const { app, emit } = await startApp({ notes: [first] });
		expect(app.notes).toEqual([first]);
		app.openCard(1);
		expect(app.openId).toBe(1);
		emit().notes([]);
		expect(app.openId).toBeNull();
		app.close();
	});

	it("goes offline when the server stops, and reloads into the next one", async () => {
		const { app, emit } = await startApp();
		emit().lost();
		expect(app.offline).toBe(true);
		expect(app.snapshot().connected).toBe(false);
		emit().hello("s1");
		expect(app.offline).toBe(false);
		app.close();
	});

	it("reports errors once, frame numbers aside", async () => {
		const { app, logs } = await startApp();
		app.report("error", [new Error("frame 3 failed")]);
		app.report("error", [new Error("frame 4 failed")]);
		app.report("warning", ["[framefields] font", "Inter"]);
		expect(logs.filter((l) => l.includes("failed"))).toHaveLength(1);
		expect(logs.at(-1)).toBe("warning: [framefields] font Inter");
		app.close();
	});

	it("shows a player that failed to start, and rejects waiting callers", async () => {
		window.framefieldsPlayer = Promise.reject(new Error("no WebGPU"));
		const { server, logs } = fakeServer();
		const app = new PreviewApp({ server });
		await app.start();
		await expect(app.whenReady()).rejects.toThrow("no WebGPU");
		expect(app.pageState).toBe("error");
		expect(app.snapshot().error).toBe("no WebGPU");
		expect(document.documentElement.dataset.preview).toBe("error");
		expect(logs[0]).toMatch(/^error: .*no WebGPU/);
		app.close();
	});

	it("doesn't mix in the page when the server has the soundtrack", async () => {
		const status: AudioStatus = { state: "none" };
		const { app } = await startApp();
		app.soundtrack.load(status, 0);
		expect(app.soundtrack.mixer).toBe("server");
		expect(app.snapshot().audioMixed).toBeNull();
		app.close();
	});
});

describe("the keyboard", () => {
	afterEach(() => {
		window.framefieldsPlayer = undefined;
	});

	it("steps a frame or a second, jumps to either end, and plays", async () => {
		history.replaceState(null, "", "/#frame=20");
		const { app } = await startApp();
		const press = async (key: string, shiftKey = false) => {
			expect(app.key({ key, shiftKey })).toBe(true);
			await tick();
		};
		await press("ArrowRight");
		expect(app.frame).toBe(21);
		await press("ArrowLeft", true);
		expect(app.frame).toBe(11);
		await press("End");
		expect(app.frame).toBe(49);
		await press("Home");
		expect(app.frame).toBe(0);
		await press(" ");
		expect(app.playing).toBe(true);
		await press(" ");
		expect(app.playing).toBe(false);
		expect(app.key({ key: "a" })).toBe(false);
		app.close();
	});
});

describe("the embed channel", () => {
	let frame: HTMLIFrameElement;
	let parent: Window;
	let posted: PreviewMessage[];

	beforeEach(() => {
		history.replaceState(null, "", "/");
		// A real window to stand in for the embedding app.
		frame = document.createElement("iframe");
		document.body.append(frame);
		parent = frame.contentWindow as Window;
		posted = [];
		vi.spyOn(parent, "postMessage").mockImplementation((m: unknown) => {
			posted.push(m as PreviewMessage);
		});
	});
	afterEach(() => {
		frame.remove();
		window.framefieldsPlayer = undefined;
	});

	const send = (data: unknown, source: Window | null = parent) =>
		window.dispatchEvent(new MessageEvent("message", { data, source }));
	const reply = async (id: string) => {
		await vi.waitFor(() =>
			expect(posted.some((m) => m.type === "framefields-preview:reply")).toBe(
				true,
			),
		);
		const r = posted.find(
			(m) => m.type === "framefields-preview:reply" && m.id === id,
		);
		posted = posted.filter((m) => m !== r);
		return r;
	};

	it("says it's ready, with the film and that it seeks by fragment", async () => {
		const { app } = await startApp({
			connect: (a) => connectEmbedder(a, parent),
		});
		expect(posted).toEqual([
			{
				type: "framefields-preview:ready",
				protocol: 1,
				seekByHash: true,
				meta: {
					title: "Film",
					width: 64,
					height: 36,
					fps: 10,
					frames: 50,
					duration: 4.9,
				},
			},
		]);
		app.close();
	});

	it("runs the parent's commands and replies with where it is", async () => {
		const { app, rendered } = await startApp({
			connect: (a) => connectEmbedder(a, parent),
		});
		posted = [];
		const command = { type: "framefields-preview:command" };

		send({ ...command, id: "a", command: "seek", time: 2.5 });
		expect(await reply("a")).toEqual({
			type: "framefields-preview:reply",
			id: "a",
			ok: true,
			state: { frame: 25, time: 2.5, playing: false },
		});
		expect(rendered.at(-1)).toBe(25);
		// A finished seek is also a state change.
		expect(posted).toContainEqual({
			type: "framefields-preview:state",
			frame: 25,
			time: 2.5,
			playing: false,
		});

		send({ ...command, id: "b", command: "seekFrame", frame: 7 });
		expect(await reply("b")).toMatchObject({
			ok: true,
			state: { frame: 7, time: 0.7 },
		});

		send({ ...command, id: "c", command: "play" });
		expect(await reply("c")).toMatchObject({
			ok: true,
			state: { playing: true },
		});
		send({ ...command, id: "d", command: "pause" });
		expect(await reply("d")).toMatchObject({
			ok: true,
			state: { playing: false },
		});
		send({ ...command, id: "e", command: "state" });
		expect(await reply("e")).toMatchObject({ ok: true });
		app.close();
	});

	it("takes commands only from its parent, and only well-formed ones", async () => {
		const { app } = await startApp({
			connect: (a) => connectEmbedder(a, parent),
		});
		posted = [];
		const seek = {
			type: "framefields-preview:command",
			id: "x",
			command: "seekFrame",
			frame: 30,
		};
		send(seek, window);
		send(seek, null);
		send({ ...seek, command: "rewind" });
		send({ ...seek, frame: "30" });
		send({ ...seek, id: 1 });
		send("seekFrame 30");
		await tick();
		await tick();
		expect(posted).toEqual([]);
		expect(app.frame).toBe(0);
		app.close();
	});

	it("replies with the error when a command can't run", async () => {
		window.framefieldsPlayer = Promise.reject(new Error("no WebGPU"));
		const { server } = fakeServer();
		const app = new PreviewApp({ server });
		connectEmbedder(app, parent);
		await app.start();
		await expect(app.whenReady()).rejects.toThrow();
		send({
			type: "framefields-preview:command",
			id: "z",
			command: "play",
		});
		expect(await reply("z")).toEqual({
			type: "framefields-preview:reply",
			id: "z",
			ok: false,
			error: "no WebGPU",
		});
		// The failure itself went out as a build error.
		expect(posted).toContainEqual({
			type: "framefields-preview:build",
			status: "error",
			message: "no WebGPU",
		});
		app.close();
	});

	it("sends state on play and pause, and at most four a second while playing", async () => {
		let now = 0;
		const { app } = await startApp({
			connect: (a) => connectEmbedder(a, parent, { now: () => now }),
		});
		posted = [];
		const states = () =>
			posted.filter((m) => m.type === "framefields-preview:state");
		app.play();
		// 10 fps on the wall clock: frames come, the channel's clock stands still.
		await vi.waitFor(() => expect(app.frame).toBeGreaterThan(2), {
			timeout: 2000,
		});
		expect(states()).toEqual([
			{ type: "framefields-preview:state", frame: 0, time: 0, playing: true },
		]);
		now += STATE_INTERVAL_MS;
		const at = app.frame;
		await vi.waitFor(() => expect(app.frame).toBeGreaterThan(at), {
			timeout: 2000,
		});
		expect(states()).toHaveLength(2);
		expect(states()[1]).toMatchObject({ playing: true });
		app.pause();
		expect(states().at(-1)).toMatchObject({
			frame: app.frame,
			playing: false,
		});
		app.close();
	});

	it("says a rebuild is coming, and when a frame fails", async () => {
		const { app, emit, player } = await startApp({
			connect: (a) => connectEmbedder(a, parent),
		});
		posted = [];
		player.onFrameError?.(5, new Error("boom"));
		player.onFrameError?.(6, new Error("boom"));
		expect(posted).toEqual([
			{
				type: "framefields-preview:build",
				status: "error",
				message: "frame 5: boom",
			},
		]);
		// jsdom can't reload; the message goes out before it tries.
		emit().hello("another session");
		expect(posted.at(-1)).toEqual({
			type: "framefields-preview:build",
			status: "building",
		});
		app.close();
	});
});
