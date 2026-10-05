/**
 * Problems a render noticed about its document (as opposed to its output),
 * collected per render id so the renderer can put them in its QA report.
 * Producers report; the renderer takes them when the render ends.
 */
export interface RenderDiagnostic {
	readonly severity: "error" | "warning" | "info";
	/** Stable machine-readable kind, e.g. "animation_truncated" */
	readonly code: string;
	readonly message: string;
	readonly layerId?: string;
}

// Kept on globalThis: bundles can each carry their own copy of this module
// (the compositor reports through one, the renderer collects through another),
// and they must all see one store.
const STORE_KEY = Symbol.for("framefields.renderDiagnostics");
const diagnosticsByRender: Map<string, Map<string, RenderDiagnostic>> =
	((globalThis as Record<symbol, unknown>)[STORE_KEY] as
		| Map<string, Map<string, RenderDiagnostic>>
		| undefined) ??
	((globalThis as Record<symbol, unknown>)[STORE_KEY] = new Map());
// A render that never collects (a crashed or frame-only render) must not grow this forever.
const MAX_TRACKED_RENDERS = 256;

/** Record a diagnostic for a render; repeats (same code, layer and message) are kept once. */
export function reportRenderDiagnostic(
	renderId: string,
	diagnostic: RenderDiagnostic,
): void {
	let forRender = diagnosticsByRender.get(renderId);
	if (!forRender) {
		if (diagnosticsByRender.size >= MAX_TRACKED_RENDERS) {
			const oldest = diagnosticsByRender.keys().next().value;
			if (oldest !== undefined) diagnosticsByRender.delete(oldest);
		}
		forRender = new Map();
		diagnosticsByRender.set(renderId, forRender);
	}
	const key = `${diagnostic.code}|${diagnostic.layerId ?? ""}|${diagnostic.message}`;
	if (!forRender.has(key)) forRender.set(key, diagnostic);
}

/**
 * Everything reported for a render, including its nested compositions (they
 * render under derived ids, `${renderId}-…`), removing it from the store.
 */
export function takeRenderDiagnostics(renderId: string): RenderDiagnostic[] {
	const collected = new Map<string, RenderDiagnostic>();
	for (const [id, forRender] of diagnosticsByRender) {
		if (id !== renderId && !id.startsWith(`${renderId}-`)) continue;
		for (const [key, diagnostic] of forRender) collected.set(key, diagnostic);
		diagnosticsByRender.delete(id);
	}
	return [...collected.values()];
}
