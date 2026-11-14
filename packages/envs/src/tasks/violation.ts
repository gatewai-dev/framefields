/**
 * Find the violation: shown one clip of `falling-violation` (either view),
 * say whether something physically impossible happens, and if so when and
 * to which object. Scored against the scene's parameters.
 */
import type { ViolationKind, ViolationParams } from "../envs/violation.js";

export const VIOLATION_PROMPT = `Does anything physically impossible happen in this clip
(24 fps, 48 frames; objects are named obj0, obj1, … from the scene list)? Answer as JSON:
{"violation": true | false,
 "frame": the first frame it shows (when true),
 "object": "obj<index>" it happens to (when true; omit for a world-wide change),
 "kind": "teleport" | "vanish" | "passThrough" | "antigravity" (optional)}`;

export interface ViolationAnswer {
	violation: boolean;
	frame?: number;
	object?: string;
	kind?: ViolationKind;
}

export interface ViolationScore {
	/** The yes/no is right. */
	detected: boolean;
	/** |answered - true frame| when both say there is one. */
	frameError?: number;
	/** The object is right (antigravity has none to name: right when omitted). */
	objectCorrect?: boolean;
	kindCorrect?: boolean;
	/** 1 for a right "no"; for a right "yes", 0.5 + 0.25 within 2 frames + 0.25 for the object. */
	score: number;
}

function parseAnswer(json: unknown): ViolationAnswer {
	if (typeof json !== "object" || json === null)
		throw new Error("answer: an object");
	const r = json as Record<string, unknown>;
	if (typeof r.violation !== "boolean")
		throw new Error("violation: true or false");
	if (r.frame !== undefined && !Number.isInteger(r.frame))
		throw new Error("frame: an integer");
	if (r.object !== undefined && typeof r.object !== "string")
		throw new Error('object: "obj<index>"');
	return r as unknown as ViolationAnswer;
}

/** Scores an answer about one view (`plausible` or `violated`) of a scene. */
export function scoreViolation(
	params: ViolationParams,
	view: "plausible" | "violated",
	answer: unknown,
): ViolationScore {
	const a = parseAnswer(answer);
	const truth = view === "violated";
	if (a.violation !== truth) return { detected: false, score: 0 };
	if (!truth) return { detected: true, score: 1 };
	const { frame, object, kind } = params.violation;
	const frameError =
		a.frame === undefined ? undefined : Math.abs(a.frame - frame);
	const objectCorrect =
		kind === "antigravity"
			? a.object === undefined
			: a.object === `obj${object}`;
	return {
		detected: true,
		...(frameError !== undefined && { frameError }),
		objectCorrect,
		...(a.kind !== undefined && { kindCorrect: a.kind === kind }),
		score:
			0.5 +
			(frameError !== undefined && frameError <= 2 ? 0.25 : 0) +
			(objectCorrect ? 0.25 : 0),
	};
}
