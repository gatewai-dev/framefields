/**
 * Coded validation for the v2 program document (spec: SKILL.md).
 *
 * Runs on the RAW input BEFORE zod: zod strips unknown keys silently, so
 * v1 shapes (`layers`, `layerUpdates`, `FPS`) and structural errors must be
 * caught in a pre-parse walk or the E-codes never fire. The zod schema then
 * handles shape/refinement errors (mapped to E1xxx-style issues).
 */
import {
	type CompositorProgramConfig,
	CompositorProgramSchema,
	type LayoutNode,
} from "./schema.js";

export interface ProgramIssue {
	code: string;
	path: (string | number)[];
	message: string;
}

export type ProgramValidationResult =
	| { ok: true }
	| { ok: false; issues: ProgramIssue[] };

const KIND_SET = new Set([
	"flex",
	"block",
	"box",
	"text",
	"media",
	"shape",
]);
const MAX_NODES = 512;
const MAX_DEPTH = 64;

const issue = (
	code: string,
	path: (string | number)[],
	message: string,
): ProgramIssue => ({ code, path, message });

export function validateLayoutProgram(raw: unknown): ProgramValidationResult {
	const issues: ProgramIssue[] = [];

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			issues: [issue("E1001", [], "Compositor config must be an object.")],
		};
	}
	const obj = raw as Record<string, unknown>;

	// v1 shapes die here (no backwards compatibility).
	if ("layers" in obj) {
		issues.push(
			issue(
				"E1001",
				["layers"],
				"Config v2 uses `layout` — `layers` is removed.",
			),
		);
	}
	if ("layerUpdates" in obj) {
		issues.push(
			issue(
				"E1001",
				["layerUpdates"],
				"Config v2 uses `layout` — `layerUpdates` is removed.",
			),
		);
	}
	if ("FPS" in obj) {
		issues.push(
			issue("E1001", ["FPS"], "Config v2 uses `fps` — `FPS` is removed."),
		);
	}

	const seenIds = new Set<string>();
	let nodeCount = 0;
	const isImageMode = obj.mode === "Image";

	const walk = (node: unknown, path: (string | number)[], depth: number) => {
		if (depth > MAX_DEPTH) {
			issues.push(
				issue(
					"E1212",
					[...path, "children"],
					`Layout nesting exceeds ${MAX_DEPTH} levels.`,
				),
			);
			return;
		}
		if (!node || typeof node !== "object" || Array.isArray(node)) {
			issues.push(issue("E1201", path, "Layout node must be an object."));
			return;
		}
		nodeCount += 1;
		if (nodeCount > MAX_NODES) {
			issues.push(
				issue("E1211", path, `Composition exceeds ${MAX_NODES} nodes.`),
			);
			return;
		}

		const n = node as Record<string, unknown>;
		const kind = n.kind;

		if (typeof kind !== "string" || !KIND_SET.has(kind)) {
			issues.push(
				issue(
					"E1201",
					[...path, "kind"],
					`Unknown layout node kind '${String(kind)}'. Expected one of: flex, block, box, text, media, shape.`,
				),
			);
		}

		const id = n.id;
		if (typeof id !== "string" || id.length === 0) {
			issues.push(
				issue(
					"E1203",
					[...path, "id"],
					"Layout node requires a non-empty `id`.",
				),
			);
		} else if (seenIds.has(id)) {
			issues.push(
				issue("E1202", [...path, "id"], `Duplicate node id '${id}'.`),
			);
		} else {
			seenIds.add(id);
		}

		// SizeSpec sanity: numeric sizes must be finite and >= 0.
		for (const axis of ["width", "height"] as const) {
			const v = n[axis];
			if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) {
				issues.push(
					issue(
						"E1205",
						[...path, axis],
						`SizeSpec must be a finite number >= 0 or one of "auto" | "fit" | "fill".`,
					),
				);
			} else if (
				typeof v === "string" &&
				v !== "auto" &&
				v !== "fit" &&
				v !== "fill"
			) {
				issues.push(
					issue(
						"E1205",
						[...path, axis],
						`SizeSpec must be a finite number >= 0 or one of "auto" | "fit" | "fill".`,
					),
				);
			}
		}

		const position = n.position;
		const isAbsolute = position === "absolute";
		if (isAbsolute) {
			if (typeof n.x !== "number" || typeof n.y !== "number") {
				issues.push(
					issue(
						"E1206",
						[...path],
						"An absolute node requires numeric `x` and `y`.",
					),
				);
			}
			if (n.grow !== undefined) {
				issues.push(
					issue(
						"E1209",
						[...path, "grow"],
						"`grow` is not allowed on an absolute node (it is out of flow).",
					),
				);
			}
		}

		if (
			kind === "media" &&
			(typeof n.inputHandleId !== "string" || n.inputHandleId.length === 0)
		) {
			issues.push(
				issue(
					"E1204",
					[...path, "inputHandleId"],
					"A media node requires a non-empty `inputHandleId`.",
				),
			);
		}

		if (kind === "text" && typeof n.fontSize === "number" && n.fontSize <= 0) {
			issues.push(
				issue(
					"E1210",
					[...path, "fontSize"],
					"A text node requires fontSize > 0.",
				),
			);
		}

		if (kind === "shape") {
			if (n.trimStart !== undefined) {
				const ts = n.trimStart;
				if (
					typeof ts !== "number" ||
					!Number.isFinite(ts) ||
					Number.isNaN(ts) ||
					ts < 0 ||
					ts > 1
				) {
					issues.push(
						issue(
							"E1208",
							[...path, "trimStart"],
							"`trimStart` must be a finite number between 0 and 1.",
						),
					);
				}
			}
			if (n.trimEnd !== undefined) {
				const te = n.trimEnd;
				if (
					typeof te !== "number" ||
					!Number.isFinite(te) ||
					Number.isNaN(te) ||
					te < 0 ||
					te > 1
				) {
					issues.push(
						issue(
							"E1208",
							[...path, "trimEnd"],
							"`trimEnd` must be a finite number between 0 and 1.",
						),
					);
				}
			}
		}

		// Timing fields only apply to Video mode; Image mode ignores duration/startFrame.
		if (!isImageMode) {
			if (n.durationFrames !== undefined) {
				const df = n.durationFrames;
				if (
					typeof df !== "number" ||
					!Number.isFinite(df) ||
					Number.isNaN(df) ||
					df < 1 ||
					!Number.isInteger(df)
				) {
					issues.push(
						issue(
							"E1207",
							[...path, "durationFrames"],
							`\`durationFrames\` must be a positive integer (>= 1). Received: ${String(df)}.`,
						),
					);
				}
			}

			if (n.startFrame !== undefined) {
				const sf = n.startFrame;
				if (
					typeof sf !== "number" ||
					!Number.isFinite(sf) ||
					Number.isNaN(sf) ||
					sf < 0 ||
					!Number.isInteger(sf)
				) {
					issues.push(
						issue(
							"E1207",
							[...path, "startFrame"],
							`\`startFrame\` must be a non-negative integer (>= 0). Received: ${String(sf)}.`,
						),
					);
				}
			}
		}

		if (n.opacity !== undefined) {
			const op = n.opacity;
			if (
				typeof op !== "number" ||
				!Number.isFinite(op) ||
				Number.isNaN(op) ||
				op < 0 ||
				op > 1
			) {
				issues.push(
					issue(
						"E1213",
						[...path, "opacity"],
						`\`opacity\` must be a number between 0 and 1. Received: ${String(op)}.`,
					),
				);
			}
		}

		// duplicate (id, prop) tracks
		const anim = n.animation as
			| { tracks?: Array<{ prop?: unknown }> }
			| undefined;
		if (anim && Array.isArray(anim.tracks) && kind !== undefined) {
			const props = new Set<string>();
			for (let tIdx = 0; tIdx < anim.tracks.length; tIdx++) {
				const prop = anim.tracks[tIdx]?.prop;
				if (typeof prop === "string") {
					if (props.has(prop)) {
						issues.push(
							issue(
								"E1208",
								[...path, "animation", "tracks", tIdx],
								`Duplicate track property '${prop}' on node '${String(id)}'.`,
							),
						);
					}
					props.add(prop);
				}
			}
		}

		// recurse into children
		const children = n.children;
		if (Array.isArray(children)) {
			for (let i = 0; i < children.length; i++) {
				walk(children[i], [...path, "children", i], depth + 1);
			}
		}
	};

	const layout = obj.layout;
	if (Array.isArray(layout)) {
		for (let i = 0; i < layout.length; i++) {
			walk(layout[i], ["layout", i], 0);
		}
	} else if (layout !== undefined) {
		issues.push(
			issue("E1001", ["layout"], "`layout` must be an array of nodes."),
		);
	}

	if (issues.length > 0) return { ok: false, issues };
	return { ok: true };
}

function cleanImageModeTiming(raw: unknown): unknown {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const obj = raw as Record<string, unknown>;
	if (obj.mode !== "Image" || !Array.isArray(obj.layout)) return raw;

	const sanitizeNode = (node: unknown): unknown => {
		if (!node || typeof node !== "object" || Array.isArray(node)) return node;
		const n = { ...(node as Record<string, unknown>) };
		if (
			n.durationFrames !== undefined &&
			(typeof n.durationFrames !== "number" ||
				!Number.isFinite(n.durationFrames) ||
				n.durationFrames < 1 ||
				!Number.isInteger(n.durationFrames))
		) {
			delete n.durationFrames;
		}
		if (
			n.startFrame !== undefined &&
			(typeof n.startFrame !== "number" ||
				!Number.isFinite(n.startFrame) ||
				n.startFrame < 0 ||
				!Number.isInteger(n.startFrame))
		) {
			delete n.startFrame;
		}
		if (Array.isArray(n.children)) {
			n.children = n.children.map(sanitizeNode);
		}
		return n;
	};

	return {
		...obj,
		layout: obj.layout.map(sanitizeNode),
	};
}

/** Fast-fail shape gate used by processors: validate raw config then parse. */
export function parseProgram(raw: unknown): {
	ok: boolean;
	issues?: ProgramIssue[];
	config?: CompositorProgramConfig;
} {
	const pre = validateLayoutProgram(raw);
	if (!pre.ok) return { ok: false, issues: pre.issues };

	const cleaned = cleanImageModeTiming(raw);
	const parsed = CompositorProgramSchema.safeParse(cleaned);
	if (!parsed.success) {
		return {
			ok: false,
			issues: parsed.error.issues.map((i) =>
				issue(
					"E1001",
					i.path.map((p) => (typeof p === "symbol" ? p.toString() : p)),
					i.message,
				),
			),
		};
	}
	return { ok: true, config: parsed.data };
}

/** Collect every node id in the tree (depth-first, in order). */
export function collectNodeIds(nodes: LayoutNode[]): string[] {
	const ids: string[] = [];
	const walk = (n: LayoutNode) => {
		ids.push(n.id);
		if ("children" in n && n.children) walkChildren(n.children);
	};
	const walkChildren = (list: LayoutNode[]) => {
		for (const n of list) walk(n);
	};
	walkChildren(nodes);
	return ids;
}

/** Collect media node bindings: inputHandleId -> node id. */
export function collectMediaBindings(nodes: LayoutNode[]): Map<string, string> {
	const bindings = new Map<string, string>();
	const walk = (n: LayoutNode) => {
		if (n.kind === "media") bindings.set(n.inputHandleId, n.id);
		if ("children" in n && n.children) {
			for (const c of n.children) walk(c);
		}
	};
	for (const n of nodes) walk(n);
	return bindings;
}
