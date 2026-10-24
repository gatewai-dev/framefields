// Fails the build when a registry component, installed the way
// `framefields add` writes it, does not typecheck against the built dist.
// Installs all of them into a scratch project that links this package as
// `framefields`, then runs tsc under NodeNext and bundler resolution with
// strict settings users commonly turn on.
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const registry = join(pkg, "dist/registry");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const project = mkdtempSync(join(tmpdir(), "framefields-add-"));
mkdirSync(join(project, "node_modules"));
symlinkSync(pkg, join(project, "node_modules/framefields"), "dir");
writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
for (const entry of JSON.parse(
	readFileSync(join(registry, "index.json"), "utf8"),
)) {
	const item = JSON.parse(
		readFileSync(join(registry, `${entry.name}.json`), "utf8"),
	);
	for (const file of item.files) {
		const target = join(project, "src/components", file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content);
	}
}

const strict = {
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	target: "ES2022",
	noUncheckedIndexedAccess: true,
	verbatimModuleSyntax: true,
	isolatedModules: true,
};
const failures = [];
for (const [label, resolution] of [
	["NodeNext", { module: "NodeNext", moduleResolution: "NodeNext" }],
	["bundler", { module: "ESNext", moduleResolution: "Bundler" }],
]) {
	writeFileSync(
		join(project, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { ...strict, ...resolution },
			include: ["src"],
		}),
	);
	try {
		execFileSync(process.execPath, [tsc, "-p", project], { encoding: "utf8" });
	} catch (error) {
		failures.push(`${label}:\n${error.stdout}`);
	}
}
rmSync(project, { recursive: true, force: true });

if (failures.length > 0) {
	console.error(
		`Installed components do not typecheck:\n${failures.join("\n")}`,
	);
	process.exit(1);
}
console.log("installed components typecheck (NodeNext, bundler)");
