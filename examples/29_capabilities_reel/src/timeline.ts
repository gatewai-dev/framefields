/**
 * Chapters on the bar grid. Every chapter starts exactly on a downbeat: its transition plays
 * during its own first frames, over a tail of the chapter before it (sequence() overlaps each
 * pair by the transition's length, so the outgoing chapter is that much longer).
 */
import { BAR } from "./theme.js";

export interface Chapter {
	id: string;
	title: string;
	bar: number;
	bars: number;
}

const PLAN: Array<[id: string, title: string, bars: number]> = [
	["open", "Open", 3],
	["lottie", "Lottie", 3],
	["emoji", "Emoji + physics", 3],
	["vector", "SVG + shapes", 3],
	["stylize", "Stylize", 4],
	["fluid", "Warp + fluid", 3],
	["vision", "Vision", 3],
	["type", "Typography", 3],
	["space", "3D", 3],
	["data", "Data + color", 3],
	["nodes", "Node montage", 2],
	["finale", "Finale", 4],
];

export const CHAPTERS: Chapter[] = [];
{
	let bar = 0;
	for (const [id, title, bars] of PLAN) {
		CHAPTERS.push({ id, title, bar, bars });
		bar += bars;
	}
}

export const TOTAL_BARS = CHAPTERS.reduce((n, c) => n + c.bars, 0);
export const TOTAL_FRAMES = TOTAL_BARS * BAR;

export function chapter(
	id: string,
): Chapter & { start: number; frames: number } {
	const c = CHAPTERS.find((x) => x.id === id);
	if (!c) throw new Error(`No chapter ${id}`);
	return { ...c, start: c.bar * BAR, frames: c.bars * BAR };
}
