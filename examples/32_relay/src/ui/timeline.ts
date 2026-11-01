/**
 * The moments the interface reacts to, in composition frames. The film reads
 * the clicks off the pointer's cues, so moving a waypoint re-times the UI.
 */
import { sec } from "../theme.js";

export interface Click {
	/** The button goes down. */
	down: number;
	/** Fully pressed: the click lands. */
	at: number;
	/** The button comes back up. */
	up: number;
}

export interface Timeline {
	/** The window starts to rise in. */
	windowIn: number;
	/** The request lands in the inbox's first row. */
	landed: number;
	select: Click;
	create: Click;
	assignee: Click;
	/** The pointer reaches Maya in the menu. */
	mayaHover: number;
	maya: Click;
	due: Click;
	fridayHover: number;
	friday: Click;
	checklist: Click;
	save: Click;
	/** The board hands its new card over to the end card. */
	sceneOut: number;
}

/**
 * Derived moments every view agrees on. The task is one surface the whole
 * way: Create task grows into the modal, and the modal, once saved, shrinks
 * into its card on the board.
 */
export const modalIn = (t: Timeline) => t.create.at + 2;
/** The modal has finished growing out of the button. */
export const modalOpen = (t: Timeline) => modalIn(t) + sec(0.5);
/** The modal's contents clear once Create task is released… */
export const modalOut = (t: Timeline) => t.save.up + 2;
/** …and its empty shell starts for the board. */
export const handOff = (t: Timeline) => modalOut(t) + 4;
export const boardIn = (t: Timeline) => t.save.up + 4;
/** The shell lands as the new card in Ready. */
export const cardLands = (t: Timeline) => handOff(t) + sec(0.8);
/** Each checklist item, in order. */
export const checklistItemAt = (t: Timeline, i: number) =>
	t.checklist.up + 2 + i * 6;
