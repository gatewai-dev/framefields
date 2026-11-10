import { html, nothing } from "lit";
import type { PreviewNote } from "../../protocol.js";
import type { Draft } from "../app.js";
import { timecode } from "../format.js";
import { PreviewElement } from "./base.js";
import * as icon from "./icons.js";

type Anchor = { x: number; y: number; w?: number; h?: number };

/**
 * The popover beside a spot on the picture: writing a new note (Enter adds
 * it, Shift+Enter a new line, Escape cancels), or reading one (mark it
 * done, delete it).
 */
export class PreviewNoteEditor extends PreviewElement {
	#focused: Draft | null = null;
	#resize = new ResizeObserver(() => this.#place());

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("resize", this.#place);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("resize", this.#place);
		this.#resize.disconnect();
	}

	/** The note shown: the draft being written, or the open card's note. */
	get #anchor(): Anchor | undefined {
		const app = this.app;
		if (!app) return undefined;
		if (app.draft) return app.draft;
		return app.openId == null ? undefined : app.noteById(app.openId);
	}

	override render() {
		const app = this.app;
		const anchor = this.#anchor;
		const body = !app?.meta
			? nothing
			: app.draft
				? this.#composer(app.draft, app.meta.fps)
				: anchor
					? this.#card(anchor as PreviewNote, app.meta.fps)
					: nothing;
		return html`<div class="pop ${anchor ? "on" : ""}" role="dialog" aria-label="Note">
			${body}
		</div>`;
	}

	protected override updated(): void {
		const picture = this.#picture();
		if (picture) this.#resize.observe(picture);
		this.#place();
		// A new draft takes the keyboard.
		const draft = this.app?.draft ?? null;
		if (draft && draft !== this.#focused)
			this.querySelector<HTMLTextAreaElement>("textarea")?.focus();
		this.#focused = draft;
	}

	#composer(draft: Draft, fps: number) {
		const app = this.app;
		if (!app) return nothing;
		const status = app.saving
			? "Saving…"
			: app.saveError
				? "Couldn't save. Is the preview running?"
				: "Enter to add";
		return html`<div class="pop-head">
				<span class="badge">+</span>
				<span class="tnum"
					>${timecode(draft.frame, fps)} · ${draft.w != null ? "area" : "spot"}</span
				>
			</div>
			<textarea
				placeholder="What should change here?"
				rows="2"
				aria-label="Note"
				.value=${draft.text}
				?readonly=${app.saving}
				@input=${this.#input}
				@keydown=${this.#keydown}
			></textarea>
			<div class="pop-foot">
				<span class="grow ${app.saveError ? "err" : ""}">${status}</span>
				<button class="btn" @click=${() => app.cancelDraft()}>Cancel</button>
				<button
					class="btn primary"
					?disabled=${!draft.text.trim() || app.saving}
					@click=${() => void app.saveDraft()}
				>
					Add note
				</button>
			</div>`;
	}

	#card(n: PreviewNote, fps: number) {
		const app = this.app;
		if (!app) return nothing;
		return html`<div class="pop-head">
				<span class="badge ${n.done ? "done" : ""}">${n.id}</span>
				<span class="tnum grow">${timecode(n.frame, fps)} · frame ${n.frame}</span>
				<button
					class="btn x-btn"
					title="Close"
					aria-label="Close"
					@click=${() => app.closePop()}
				>
					${icon.close}
				</button>
			</div>
			<div class="pop-text">${n.text}</div>
			<div class="pop-foot">
				<button class="btn" @click=${() => app.setDone(n.id, !n.done)}>
					${icon.check}${n.done ? "Reopen" : "Mark done"}
				</button>
				<span class="grow"></span>
				<button class="btn danger" @click=${() => app.removeNote(n.id)}>
					Delete
				</button>
			</div>`;
	}

	#input = (e: Event) => {
		const ta = e.target as HTMLTextAreaElement;
		this.app?.setDraftText(ta.value);
		ta.style.height = "auto";
		ta.style.height = `${Math.min(180, ta.scrollHeight)}px`;
	};

	#keydown = (e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void this.app?.saveDraft();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			this.app?.cancelDraft();
		}
	};

	#picture(): HTMLElement | null {
		return (
			this.closest("ff-preview")?.querySelector<HTMLElement>(
				"ff-stage .stage",
			) ?? null
		);
	}

	// Beside the spot (or the area's corner), flipped to stay on screen.
	#place = () => {
		const pop = this.querySelector<HTMLElement>(".pop");
		const picture = this.#picture();
		const n = this.#anchor;
		if (!pop || !picture || !n) return;
		const r = picture.getBoundingClientRect();
		const aw = (n.w ?? 0) * r.width;
		const ah = (n.h ?? 0) * r.height;
		const ax = r.left + n.x * r.width + aw;
		const ay = r.top + n.y * r.height + ah;
		const w = pop.offsetWidth;
		const h = pop.offsetHeight;
		const gap = 16;
		const left = ax + gap + w <= innerWidth - 8 ? ax + gap : ax - gap - w - aw;
		const top =
			ay + gap + h <= innerHeight - 8 ? ay + gap / 2 : ay - h - gap / 2 - ah;
		pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, left))}px`;
		pop.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, top))}px`;
	};
}
