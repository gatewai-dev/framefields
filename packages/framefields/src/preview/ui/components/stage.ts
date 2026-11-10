import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import type { PreviewNote } from "../../protocol.js";
import type { Draft } from "../app.js";
import { PreviewElement } from "./base.js";
import { buffering, check } from "./icons.js";

interface Press {
	x: number;
	y: number;
	cx: number;
	cy: number;
	area: { x: number; y: number; w: number; h: number } | null;
}

/** A press moving less than this is a click (a spot), not a drag (an area). */
const DRAG_PX = 6;

const box = (n: { x: number; y: number; w?: number; h?: number }) =>
	styleMap({
		left: `${n.x * 100}%`,
		top: `${n.y * 100}%`,
		width: n.w == null ? undefined : `${n.w * 100}%`,
		height: n.h == null ? undefined : `${n.h * 100}%`,
	});

/**
 * The picture: the player's canvas, the notes pinned at this frame, and
 * where new ones are placed. Click to pin a spot, drag to mark an area.
 */
export class PreviewStage extends PreviewElement {
	#press: Press | null = null;

	override render() {
		const app = this.app;
		const meta = app?.meta;
		const classes = [
			"stage",
			app?.canNote ? "can-note" : "",
			app && app.notes.length === 0 && !app.draft ? "hint" : "",
		].join(" ");
		const ratio = meta
			? {
					"--ar": `${meta.width} / ${meta.height}`,
					"--ar-n": String(meta.width / meta.height),
				}
			: {};
		const area = this.#press?.area;
		return html`<div class="stage-wrap">
			<div
				class=${classes}
				style=${styleMap(ratio)}
				@pointerdown=${this.#down}
				@pointermove=${this.#move}
				@pointerup=${this.#up}
				@pointercancel=${this.#cancel}
			>
				<canvas id="canvas" aria-label="Rendered frame"></canvas>
				<div class="stage-msg ${app?.pageState === "error" ? "on" : ""}" role="alert">
					${app?.pageState === "error" ? app.error : ""}
				</div>
				<div class="overlay">${this.#pins()}</div>
				<div
					class="marquee"
					style=${area ? box(area) : styleMap({ display: "none" })}
				></div>
				<div class="stage-hint">Click to pin a note · drag to mark an area</div>
				<div class="toast ${app?.toastOn ? "on" : ""}" role="status" aria-live="polite">
					${app?.toastText}
				</div>
				<div
					class="buffering ${app?.buffering ? "on" : ""}"
					role="status"
					aria-label="Loading"
				>
					${buffering}
				</div>
			</div>
		</div>`;
	}

	/** The element the note editor is placed against. */
	get picture(): HTMLElement | null {
		return this.querySelector(".stage");
	}

	#pins() {
		const app = this.app;
		if (!app?.meta || app.playing) return nothing;
		const here: Array<PreviewNote | Draft> = app.notes.filter(
			(n) => n.frame === app.frame,
		);
		if (app.draft && app.draft.frame === app.frame) here.push(app.draft);
		return here.map((n) => {
			const done = "done" in n && n.done;
			const areaMark =
				n.w != null
					? html`<div class="area ${done ? "done" : ""}" style=${box(n)}></div>`
					: nothing;
			if (!("id" in n)) {
				return html`${areaMark}<button
						class="pin draft"
						style=${box({ x: n.x, y: n.y })}
						aria-label="New note"
					></button>`;
			}
			const cls = [
				"pin",
				done ? "done" : "",
				n.id === app.openId ? "active" : "",
			];
			return html`${areaMark}<button
					class=${cls.join(" ")}
					style=${box({ x: n.x, y: n.y })}
					title=${n.text}
					aria-label="Note ${n.id}"
					@click=${(e: Event) => {
						e.stopPropagation();
						app.openCard(n.id);
					}}
				>
					${done ? check : String(n.id)}
				</button>`;
		});
	}

	#fraction(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return {
			x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
		};
	}

	#down = (e: PointerEvent) => {
		const app = this.app;
		const target = e.target as Element;
		if (e.button !== 0 || !app?.player || target.closest(".pin")) return;
		if (app.playing) {
			app.pause();
			return;
		}
		if (!app.notesOn) return;
		// A note being written keeps its place until it's sent or cancelled.
		if (app.draft?.text.trim()) {
			this.closest("ff-preview")
				?.querySelector<HTMLTextAreaElement>(".pop textarea")
				?.focus();
			return;
		}
		app.cancelDraft();
		const p = this.#fraction(e);
		this.#press = { ...p, cx: e.clientX, cy: e.clientY, area: null };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	#move = (e: PointerEvent) => {
		const press = this.#press;
		if (!press) return;
		if (
			!press.area &&
			Math.hypot(e.clientX - press.cx, e.clientY - press.cy) < DRAG_PX
		)
			return;
		const p = this.#fraction(e);
		press.area = {
			x: Math.min(press.x, p.x),
			y: Math.min(press.y, p.y),
			w: Math.abs(p.x - press.x),
			h: Math.abs(p.y - press.y),
		};
		this.requestUpdate();
	};

	#up = () => {
		const press = this.#press;
		if (!press) return;
		this.#press = null;
		this.app?.beginDraft({ x: press.x, y: press.y }, press.area);
	};

	#cancel = () => {
		this.#press = null;
		this.requestUpdate();
	};
}
