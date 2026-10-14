import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../errors.js";

export type PackageManagerName = "pnpm" | "npm" | "yarn";

export interface PackageJson {
	name?: string;
	packageManager?: string;
	workspaces?: string[] | { packages?: string[] };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	engines?: Record<string, string>;
}

export interface ProjectInfo {
	/** Directory the install runs in (workspace root or the package itself). */
	installRoot: string;
	/** The package being rendered. */
	packageDir: string;
	pkg: PackageJson;
	manager: PackageManagerName;
	/** e.g. "pnpm@10.13.1" from `packageManager`, if pinned. */
	managerSpec?: string;
	lockfile?: string;
	/** Yarn ≥ 2 (berry) uses different flags. */
	yarnBerry: boolean;
	/** True when the package is a member of a workspace rooted above it. */
	inWorkspace: boolean;
}

const LOCKFILES: [string, PackageManagerName][] = [
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
	["npm-shrinkwrap.json", "npm"],
];

const UNSUPPORTED_LOCKFILES = ["bun.lockb", "bun.lock"];

export async function readPackageJson(
	dir: string,
): Promise<PackageJson | undefined> {
	const file = path.join(dir, "package.json");
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as PackageJson;
	} catch (err) {
		throw new RenderError(
			"INSTALL_FAILED",
			`${path.relative(process.cwd(), file)} is not valid JSON.`,
			{
				phase: "install",
				cause: err,
			},
		);
	}
}

/**
 * Finds the install root: the nearest directory between the workdir and the
 * repo root that holds a lockfile or declares workspaces.
 */
export async function inspectProject(
	repoRoot: string,
	workdir: string,
): Promise<ProjectInfo | undefined> {
	const pkg = await readPackageJson(workdir);
	if (!pkg) return undefined;

	let installRoot = workdir;
	let rootPkg = pkg;
	for (let dir = workdir; ; dir = path.dirname(dir)) {
		const dirPkg = dir === workdir ? pkg : await readPackageJson(dir);
		const hasLock = LOCKFILES.some(([f]) => existsSync(path.join(dir, f)));
		const isWorkspaceRoot =
			existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
			Boolean(dirPkg?.workspaces);
		if (dirPkg && (hasLock || isWorkspaceRoot)) {
			installRoot = dir;
			rootPkg = dirPkg;
			break;
		}
		if (dir === repoRoot || path.dirname(dir) === dir) break;
	}

	for (const file of UNSUPPORTED_LOCKFILES) {
		if (existsSync(path.join(installRoot, file))) {
			throw new RenderError(
				"INSTALL_FAILED",
				`${file} found: bun projects aren't supported yet.`,
				{
					phase: "install",
					hint: "Commit a pnpm, npm or yarn lockfile.",
				},
			);
		}
	}

	const managerSpec = rootPkg.packageManager?.split("+")[0];
	const lock = LOCKFILES.find(([f]) => existsSync(path.join(installRoot, f)));
	const fromSpec = managerSpec?.split("@")[0] as PackageManagerName | undefined;
	const manager: PackageManagerName =
		fromSpec && ["pnpm", "npm", "yarn"].includes(fromSpec)
			? fromSpec
			: (lock?.[1] ?? "npm");

	let yarnBerry = false;
	if (manager === "yarn") {
		const major = Number(managerSpec?.split("@")[1]?.split(".")[0] ?? 0);
		const lockText = lock
			? await fs.readFile(path.join(installRoot, lock[0]), "utf8")
			: "";
		yarnBerry = major >= 2 || lockText.includes("__metadata:");
	}

	return {
		installRoot,
		packageDir: workdir,
		pkg,
		manager,
		managerSpec,
		lockfile: lock ? path.join(installRoot, lock[0]) : undefined,
		yarnBerry,
		inWorkspace: installRoot !== workdir,
	};
}

/** Packages the worker provides itself (resolved to its copy, PLAN.md §7). */
export function isEnginePackage(name: string): boolean {
	return name === "framefields" || name.startsWith("@framefields/");
}

/** Build/typing tools that never load at render time. */
const TOOLING = [
	/^typescript$/,
	/^tsx$/,
	/^ts-node$/,
	/^@types\//,
	/^vitest$/,
	/^@vitest\//,
	/^@biomejs\//,
	/^eslint/,
	/^@eslint\//,
	/^prettier/,
	/^tsdown$/,
	/^tsup$/,
	/^esbuild$/,
	/^lefthook$/,
	/^husky$/,
];

/**
 * True when the package needs nothing beyond what the worker provides: every
 * dependency is a framefields package and every dev dependency is tooling.
 */
export function needsNoInstall(pkg: PackageJson): boolean {
	const deps = Object.keys(pkg.dependencies ?? {});
	const dev = Object.keys(pkg.devDependencies ?? {});
	return (
		deps.every(isEnginePackage) &&
		dev.every((d) => isEnginePackage(d) || TOOLING.some((re) => re.test(d)))
	);
}

/** The range the package declares for `framefields`, if any. */
export function declaredEngineRange(pkg: PackageJson): string | undefined {
	return pkg.dependencies?.framefields ?? pkg.devDependencies?.framefields;
}
