/**
 * Notes the user pins on the preview: a moment, a spot (or an area) on the
 * frame, and what should change there. They are kept as files so whoever
 * edits the film (a person, or an agent) can read them: `notes.json`, plus the
 * frame with the spot marked as `note-<id>.jpg`. The folder ignores itself in
 * git. `notes.json` is read on every change, so it can be edited by hand
 * (marking a note done, say) while the preview runs.
 */
import fs from "node:fs";
import path from "node:path";

export interface PreviewNote {
	id: number;
	frame: number;
	/** Seconds into the film. */
	time: number;
	/** The spot, as fractions of the frame's width and height (0..1). */
	x: number;
	y: number;
	/** Set when an area was marked: its size, from the spot at its top left. */
	w?: number;
	h?: number;
	text: string;
	/** The frame with the spot marked (absolute path), when it was captured. */
	image?: string;
	done: boolean;
	created: string;
}

export interface NewNote {
	frame: number;
	time: number;
	x: number;
	y: number;
	w?: number;
	h?: number;
	text: string;
	/** JPEG as a base64 data URL. */
	image?: string;
}

export class NoteStore {
	readonly file: string;

	constructor(readonly dir: string) {
		this.file = path.join(dir, "notes.json");
	}

	async list(): Promise<PreviewNote[]> {
		try {
			const notes = JSON.parse(await fs.promises.readFile(this.file, "utf8"));
			return Array.isArray(notes) ? notes : [];
		} catch {
			return [];
		}
	}

	async add(input: NewNote): Promise<PreviewNote> {
		const notes = await this.list();
		const id = notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
		const note: PreviewNote = {
			id,
			frame: Math.max(0, Math.round(Number(input.frame) || 0)),
			time: round(Number(input.time) || 0, 3),
			x: round(clamp01(input.x), 4),
			y: round(clamp01(input.y), 4),
			...(input.w !== undefined &&
				input.h !== undefined && {
					w: round(clamp01(input.w), 4),
					h: round(clamp01(input.h), 4),
				}),
			text: String(input.text ?? "").trim(),
			done: false,
			created: new Date().toISOString(),
		};
		await this.ensureDir();
		const jpeg = /^data:image\/jpeg;base64,(.+)$/.exec(input.image ?? "");
		if (jpeg) {
			note.image = path.join(this.dir, `note-${id}.jpg`);
			await fs.promises.writeFile(note.image, Buffer.from(jpeg[1], "base64"));
		}
		await this.save([...notes, note]);
		return note;
	}

	async update(
		id: number,
		patch: { done?: boolean; text?: string },
	): Promise<PreviewNote | undefined> {
		const notes = await this.list();
		const note = notes.find((n) => n.id === id);
		if (!note) return undefined;
		if (typeof patch.done === "boolean") note.done = patch.done;
		if (typeof patch.text === "string" && patch.text.trim())
			note.text = patch.text.trim();
		await this.save(notes);
		return note;
	}

	async remove(id: number): Promise<PreviewNote | undefined> {
		const notes = await this.list();
		const note = notes.find((n) => n.id === id);
		if (!note) return undefined;
		if (note.image) await fs.promises.rm(note.image, { force: true });
		await this.save(notes.filter((n) => n !== note));
		return note;
	}

	private async save(notes: PreviewNote[]): Promise<void> {
		await this.ensureDir();
		const tmp = `${this.file}.${process.pid}.tmp`;
		await fs.promises.writeFile(tmp, `${JSON.stringify(notes, null, "\t")}\n`);
		await fs.promises.rename(tmp, this.file);
	}

	private async ensureDir(): Promise<void> {
		await fs.promises.mkdir(this.dir, { recursive: true });
		// Notes are working material, not part of the project.
		const ignore = path.join(path.dirname(this.dir), ".gitignore");
		if (!fs.existsSync(ignore)) await fs.promises.writeFile(ignore, "*\n");
	}
}

/** One line for a terminal (or an agent reading one). */
export function describeNote(note: PreviewNote, fps: number): string {
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const where =
		note.w !== undefined && note.h !== undefined
			? `area ${pct(note.x)},${pct(note.y)} to ${pct(note.x + note.w)},${pct(note.y + note.h)}`
			: `spot ${pct(note.x)},${pct(note.y)}`;
	return `note ${note.id} at ${timecode(note.frame, fps)} (frame ${note.frame}), ${where}: ${note.text}`;
}

function timecode(frame: number, fps: number): string {
	const s = frame / fps;
	const m = Math.floor(s / 60);
	return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}

function clamp01(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round(v: number, digits: number): number {
	return Number(v.toFixed(digits));
}
