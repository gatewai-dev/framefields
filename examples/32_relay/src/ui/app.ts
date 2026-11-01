/** The whole Relay window content, in content px, keyed to the timeline. */
import type { LayoutNode } from "framefields";
import { board } from "./board.js";
import { handoffs } from "./handoffs.js";
import { inbox } from "./inbox.js";
import { sidebar } from "./sidebar.js";
import { taskModal } from "./task-modal.js";
import type { Timeline } from "./timeline.js";

export function relayApp(t: Timeline): LayoutNode[] {
	return [inbox(t), board(t), sidebar(t), ...taskModal(t), ...handoffs(t)];
}
