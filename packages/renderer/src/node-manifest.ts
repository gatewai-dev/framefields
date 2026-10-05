import fs from "node:fs";
import path from "node:path";

/**
 * The `framefields` block of a node package's `package.json`.
 *
 * This is the single declaration of a node's op: renderer discovery, the
 * effects generator (`scripts/generate-effects.ts`) and the skill catalog all
 * read it from here. There is deliberately no fallback that derives an op from
 * the package name. See `spec/sync-node.md` §5.1.
 */
export const NODE_KINDS = [
	"effect",
	"audio",
	"source",
	"signal",
	"utility",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface NodeRendererExports {
	development?: string;
	import?: string;
	default?: string;
}

export interface NodeManifest {
	/** Directory name under `nodes/`, e.g. `node-apply-lut`. */
	dir: string;
	/** Absolute path of the node package. */
	path: string;
	/** npm package name, e.g. `@framefields/node-lut`. */
	packageName: string;
	/** Canonical op literal used in the operation AST and the renderer registry. */
	type: string;
	kind: NodeKind;
	/** Legacy ops that resolve to the same renderer. */
	aliases: readonly string[];
	/** Named zod schema export of `src/shared/config.ts`. */
	schema?: string;
	/** Authoring class name. Defaults to `type`. */
	className?: string;
	/** Key on `Effect.*`. Defaults to `className` with a lower-cased first letter. */
	factory?: string;
	/** A hand-written subclass exists under `effects/custom/`. */
	custom: boolean;
	/** `false` when the package opts out of discovery. */
	enabled: boolean;
	rendererExports?: NodeRendererExports;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

export class NodeManifestError extends Error {
	constructor(public readonly problems: readonly string[]) {
		super(
			`Invalid node manifest(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
		this.name = "NodeManifestError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates one parsed `package.json`. Returns the manifest, or the list of
 * problems that make it unusable. Never throws.
 */
export function parseNodeManifest(
	pkg: unknown,
	dir: string,
	nodePath = dir,
): { manifest?: NodeManifest; problems: string[] } {
	const problems: string[] = [];
	if (!isRecord(pkg)) {
		return { problems: [`${dir}: package.json is not an object`] };
	}
	const block = pkg.framefields;
	if (!isRecord(block)) {
		return {
			problems: [
				`${dir}: package.json has no "framefields" block (expected { "type": "<Op>", "kind": "<kind>" })`,
			],
		};
	}

	const { type, kind, aliases, schema, className, factory, custom } = block;

	if (typeof type !== "string" || !IDENTIFIER.test(type)) {
		problems.push(`${dir}: framefields.type must be an op identifier`);
	}
	if (
		typeof kind !== "string" ||
		!(NODE_KINDS as readonly string[]).includes(kind)
	) {
		problems.push(
			`${dir}: framefields.kind must be one of ${NODE_KINDS.join(", ")}`,
		);
	}
	if (
		aliases !== undefined &&
		!(
			Array.isArray(aliases) &&
			aliases.every((a) => typeof a === "string" && IDENTIFIER.test(a))
		)
	) {
		problems.push(
			`${dir}: framefields.aliases must be an array of op identifiers`,
		);
	}
	for (const [key, value] of Object.entries({ schema, className, factory })) {
		if (
			value !== undefined &&
			(typeof value !== "string" || !IDENTIFIER.test(value))
		) {
			problems.push(`${dir}: framefields.${key} must be an identifier`);
		}
	}
	if (custom !== undefined && typeof custom !== "boolean") {
		problems.push(`${dir}: framefields.custom must be a boolean`);
	}
	if (problems.length > 0) return { problems };

	const exportsField = isRecord(pkg.exports) ? pkg.exports["./renderer"] : null;
	const legacy = isRecord(pkg.gatewai) ? pkg.gatewai : {};

	return {
		problems,
		manifest: {
			dir,
			path: nodePath,
			packageName: typeof pkg.name === "string" ? pkg.name : dir,
			type: type as string,
			kind: kind as NodeKind,
			aliases: (aliases as string[] | undefined) ?? [],
			schema: schema as string | undefined,
			className: className as string | undefined,
			factory: factory as string | undefined,
			custom: custom === true,
			enabled: legacy.enabled !== false,
			rendererExports: isRecord(exportsField)
				? (exportsField as NodeRendererExports)
				: undefined,
		},
	};
}

/**
 * Reads every `nodes/node-*` package and returns its manifest, sorted by
 * directory name. Throws a single {@link NodeManifestError} listing every
 * problem: a missing or malformed block, or an op/alias claimed twice.
 */
export function loadNodeManifests(nodesDir: string): NodeManifest[] {
	const problems: string[] = [];
	const manifests: NodeManifest[] = [];

	const dirs = fs
		.readdirSync(nodesDir)
		.filter(
			(d) =>
				d.startsWith("node-") &&
				fs.existsSync(path.join(nodesDir, d, "package.json")),
		)
		.sort();

	for (const dir of dirs) {
		const nodePath = path.join(nodesDir, dir);
		let pkg: unknown;
		try {
			pkg = JSON.parse(
				fs.readFileSync(path.join(nodePath, "package.json"), "utf-8"),
			);
		} catch (err) {
			problems.push(`${dir}: package.json is not valid JSON (${String(err)})`);
			continue;
		}
		const parsed = parseNodeManifest(pkg, dir, nodePath);
		problems.push(...parsed.problems);
		if (parsed.manifest) manifests.push(parsed.manifest);
	}

	const owners = new Map<string, string>();
	for (const manifest of manifests) {
		for (const op of [manifest.type, ...manifest.aliases]) {
			const owner = owners.get(op);
			if (owner) {
				problems.push(
					`${manifest.dir}: op "${op}" is already declared by ${owner}`,
				);
			} else {
				owners.set(op, manifest.dir);
			}
		}
	}

	if (problems.length > 0) throw new NodeManifestError(problems);
	return manifests;
}
