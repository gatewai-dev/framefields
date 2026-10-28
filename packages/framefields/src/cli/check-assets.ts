import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	CompositorProgramConfig,
	LayoutNode,
} from "@framefields/compositions/program";
import type { CheckDiagnostic } from "./check-result.js";

/** Local files only; remote availability and decoding belong to render checks. */
export function checkLocalAssets(
	spec: CompositorProgramConfig,
): CheckDiagnostic[] {
	const diagnostics: CheckDiagnostic[] = [];
	const check = (source: string, path: string, layerId?: string) => {
		if (/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith("file:"))
			return;
		const file = source.startsWith("file:") ? fileURLToPath(source) : source;
		if (!existsSync(file))
			diagnostics.push({
				severity: "error",
				code: "missing_local_asset",
				stage: "assets",
				path,
				...(layerId && { layerId }),
				message: `Local asset '${source}' does not exist. Restore it or correct the source path relative to the project working directory.`,
			});
	};
	for (const [i, font] of (spec.fonts ?? []).entries())
		check(font, `fonts.${i}`);
	const visit = (nodes: LayoutNode[], path: string) => {
		for (const [i, node] of nodes.entries()) {
			const location = `${path}.${i}`;
			if (node.kind === "media") {
				const source = node.src ?? node.inputHandleId;
				if (
					typeof source === "string" &&
					(node.src !== undefined || /[/.]/.test(source))
				)
					check(
						source,
						`${location}.${node.src !== undefined ? "src" : "inputHandleId"}`,
						node.id,
					);
			}
			if ("children" in node && Array.isArray(node.children))
				visit(node.children, `${location}.children`);
		}
	};
	visit(spec.layout, "layout");
	return diagnostics;
}
