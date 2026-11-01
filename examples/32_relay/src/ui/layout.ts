/**
 * Where everything sits inside the app window, in content px (the area below
 * the title bar). The film aims the pointer and the camera at these rects.
 */
import { FRAME, space } from "../theme.js";
import type { Rect } from "./kit.js";

/** Height of the window's title bar (AppFrame, kind "window"). */
export const TITLE_BAR = 46;
export const CW = FRAME.width;
export const CH = FRAME.height - TITLE_BAR;

export const SIDEBAR_W = 248;
/** Sidebar rows: nav and projects share one rhythm. */
export const NAV_ROW = 40;
export const NAV_Y = 116;
export const PROJECTS_Y = 280;

// ── Inbox ────────────────────────────────────────────────────────────────

export const LIST_X = SIDEBAR_W;
export const LIST_W = 480;
export const LIST_TOP = 72;
export const ROW_H = 96;
export const PANE_X = LIST_X + LIST_W;
export const PANE_W = CW - PANE_X;

/** The new request: the inbox's first row. */
export const REQUEST_ROW: Rect = {
	x: LIST_X,
	y: LIST_TOP,
	width: LIST_W,
	height: ROW_H,
};

export const CREATE_BUTTON: Rect = {
	x: CW - space(4) - 152,
	y: space(2),
	width: 152,
	height: 40,
};
export const REPLY_BUTTON: Rect = {
	x: CREATE_BUTTON.x - space(1.5) - 96,
	y: space(2),
	width: 96,
	height: 40,
};

// ── New task modal (modal-local rects; MODAL places them) ────────────────

export const MODAL: Rect = {
	x: SIDEBAR_W + (CW - SIDEBAR_W - 640) / 2,
	y: (CH - 700) / 2,
	width: 640,
	height: 700,
};
/** A modal-local rect in content px. */
export const inModal = (r: Rect): Rect => ({
	...r,
	x: MODAL.x + r.x,
	y: MODAL.y + r.y,
});

const FIELD_X = 160;
const FIELD_W = 280;
const FIELD_H = 40;
const PROP_Y = 212;
const PROP_STEP = 52;
export const propertyY = (i: number) => PROP_Y + i * PROP_STEP;
const field = (i: number): Rect => ({
	x: FIELD_X,
	y: propertyY(i),
	width: FIELD_W,
	height: FIELD_H,
});
export const ASSIGNEE_FIELD = field(0);
export const DUE_FIELD = field(1);
export const PROJECT_FIELD = field(2);
export const STATUS_FIELD = field(3);

export const OPTION_H = 44;
/** A menu under a field, `count` options tall. */
export const menuUnder = (f: Rect, count: number): Rect => ({
	x: f.x,
	y: f.y + f.height + space(0.5),
	width: f.width,
	height: count * OPTION_H + space(1),
});
export const optionIn = (menu: Rect, i: number): Rect => ({
	x: menu.x + space(0.5),
	y: menu.y + space(0.5) + i * OPTION_H,
	width: menu.width - space(1),
	height: OPTION_H,
});

export const CHECKLIST_Y = 440;
export const CHECK_ROW = 44;
export const ADD_CHECKLIST: Rect = {
	x: space(4),
	y: CHECKLIST_Y + 32,
	width: 168,
	height: 40,
};
export const FOOTER_Y = 628;
export const SAVE_BUTTON: Rect = {
	x: MODAL.width - space(4) - 152,
	y: FOOTER_Y + space(2),
	width: 152,
	height: 40,
};
export const CANCEL_BUTTON: Rect = {
	x: SAVE_BUTTON.x - space(1.5) - 96,
	y: SAVE_BUTTON.y,
	width: 96,
	height: 40,
};

// ── Board ────────────────────────────────────────────────────────────────

export const BOARD_X = SIDEBAR_W + space(4);
export const COLUMNS_Y = 128;
export const COLUMN_GAP = space(2);
export const COLUMN_W = (CW - BOARD_X - space(4) - 3 * COLUMN_GAP) / 4;
export const columnX = (i: number) => BOARD_X + i * (COLUMN_W + COLUMN_GAP);
export const CARDS_Y = COLUMNS_Y + 48;
export const CARD_H = 96;
export const CARD_GAP = space(1.5);
export const CARD_W = COLUMN_W - space(3);
export const READY = 1;

/** A card's slot in a column, in content px. */
export const cardSlot = (column: number, i: number): Rect => ({
	x: columnX(column) + space(1.5),
	y: CARDS_Y + i * (CARD_H + CARD_GAP),
	width: CARD_W,
	height: CARD_H,
});
