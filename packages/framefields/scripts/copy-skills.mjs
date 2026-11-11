// Copies the agent guides (plugins/framefields/skills) into dist/skills, so every published
// framefields carries the guides written for its own API: an agent working in a project reads
// node_modules/framefields/dist/skills/<skill>/SKILL.md instead of whatever main says today.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
	new URL("../../../plugins/framefields/skills", import.meta.url),
);
const target = fileURLToPath(new URL("../dist/skills", import.meta.url));
rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
	recursive: true,
	filter: (path) => !path.endsWith(".DS_Store"),
});
process.exit(0);
