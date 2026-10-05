#!/usr/bin/env node
// Keeps the agent plugin and monorepo root versions in lockstep with the released
// `framefields` package.
//
// Runs after `changeset version` (see `version:packages`), so every release bumps the
// version in both plugin manifests and the root package.json. Clients compare the
// plugin version to decide when to update, so a stale one leaves users on old skills.
// The root version is what the server-utils logger reports.
//
// Dependency-free on purpose, like validate-agent-plugin.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
	"package.json",
	"plugins/framefields/plugin.json",
	"plugins/framefields/.claude-plugin/plugin.json",
];

const { version } = JSON.parse(
	readFileSync(join(repoRoot, "packages/framefields/package.json"), "utf8"),
);

for (const manifest of MANIFESTS) {
	const path = join(repoRoot, manifest);
	const source = readFileSync(path, "utf8");
	// Replace the value in place so the file's formatting and key order survive.
	const updated = source.replace(
		/("version"\s*:\s*)"[^"]*"/,
		`$1${JSON.stringify(version)}`,
	);
	if (updated === source && JSON.parse(source).version !== version)
		throw new Error(`${manifest}: no "version" field to update`);
	writeFileSync(path, updated);
	console.log(`${manifest} → ${version}`);
}
