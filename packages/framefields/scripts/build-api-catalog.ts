/** Generate the agent-facing timing/preflight API reference from the owning types. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCES = [
	["../../core/src/frame-time.ts", ["frameCount", "resolveFrameRequest"]],
	["../src/renderer/framegrid.ts", ["FrameGridOptions", "FrameSamplePoint"]],
	[
		"../../compositions/src/program/sequence.ts",
		[
			"SceneOptions",
			"SequenceOptions",
			"SequenceTimelineResult",
			"calculateSequenceTimeline",
		],
	],
	["../src/cli/check.ts", ["CheckOptions"]],
	["../src/cli/check-result.ts", ["CheckReport", "CheckDiagnostic"]],
] as const;

export function buildApiCatalog(): { schemaVersion: 1; entries: object[] } {
	const entries: object[] = [];
	for (const [file, names] of SOURCES) {
		const source = ts.createSourceFile(
			file,
			readFileSync(new URL(file, import.meta.url), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		for (const name of names) {
			const declaration = source.statements.find(
				(node) =>
					(ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node)) &&
					node.name?.text === name,
			);
			if (
				!declaration ||
				!(
					ts.isInterfaceDeclaration(declaration) ||
					ts.isFunctionDeclaration(declaration)
				)
			)
				throw new Error(`Missing API declaration ${name} in ${file}`);
			const text = declaration.getText(source);
			const signature =
				ts.isFunctionDeclaration(declaration) && declaration.body
					? `${text.slice(0, declaration.body.getStart(source) - declaration.getStart(source)).trim()};`
					: text;
			entries.push({
				name,
				declaration: signature,
				documentation: ts
					.getJSDocCommentsAndTags(declaration)
					.map((doc) => doc.getText(source))
					.join("\n"),
				properties: ts.isInterfaceDeclaration(declaration)
					? declaration.members.map((member) => ({
							declaration: member.getText(source),
							documentation: ts
								.getJSDocCommentsAndTags(member)
								.map((doc) => doc.getText(source))
								.join("\n"),
						}))
					: undefined,
			});
		}
	}
	return { schemaVersion: 1, entries };
}

export function writeApiCatalog(output: string): void {
	writeFileSync(output, `${JSON.stringify(buildApiCatalog(), null, "\t")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	writeApiCatalog(process.argv[2]);
