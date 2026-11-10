/** The picture saved with a note: the frame with its spot (or area) marked. */
import type { PreviewPlayer } from "../player.js";
import type { Draft } from "./app.js";

/** JPEG data URL of `draft`'s frame, at most 1600 px wide, with the spot marked. */
export async function captureNote(
	player: PreviewPlayer,
	draft: Draft,
): Promise<string> {
	const bmp = await player.snapshot(draft.frame);
	const scale = Math.min(1, 1600 / bmp.width);
	const w = Math.round(bmp.width * scale);
	const h = Math.round(bmp.height * scale);
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const g = canvas.getContext("2d");
	if (!g) throw new Error("no 2D canvas to draw the note's picture");
	g.drawImage(bmp, 0, 0, w, h);
	bmp.close();
	const lw = Math.max(3, w / 400);
	// Dark, white, then blue: it reads on any picture.
	const mark = (draw: () => void) => {
		for (const [width, color] of [
			[lw + 5, "rgba(0,0,0,0.5)"],
			[lw + 2.5, "#fff"],
			[lw, "#3b82f6"],
		] as const) {
			g.lineWidth = width;
			g.strokeStyle = color;
			draw();
		}
	};
	const { x, y } = draft;
	if (draft.w != null && draft.h != null) {
		const { w: aw, h: ah } = draft;
		mark(() => g.strokeRect(x * w, y * h, aw * w, ah * h));
	} else {
		const rad = Math.max(16, w / 40);
		mark(() => {
			g.beginPath();
			g.arc(x * w, y * h, rad, 0, Math.PI * 2);
			g.stroke();
		});
		g.fillStyle = "#3b82f6";
		g.beginPath();
		g.arc(x * w, y * h, lw, 0, Math.PI * 2);
		g.fill();
	}
	return canvas.toDataURL("image/jpeg", 0.88);
}
