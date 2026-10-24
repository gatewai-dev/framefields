import { describe, expect, it } from "vitest";
import { buildRegistry, rewriteImports } from "./build-registry.js";

describe("rewriteImports", () => {
	it("folds core and zod into one toolkit import and program into framefields", () => {
		const source = `/** Doc. */
import {
	type KeyframeTuple,
	LayerAnimation,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import type { Animatable } from "../core/host.js";
import { counter } from "../counter/index.js";
import { valueAt } from "../counter/plan.js";
import { plan } from "./plan.js";

type H = import("../core/host.js").Host;
`;
		const { content, siblings } = rewriteImports(source, "x/index.ts", [
			"bindComponent",
		]);
		expect(content).toBe(`/** Doc. */
import { type KeyframeTuple, LayerAnimation } from "framefields";
import {
	type Animatable,
	bakeSamples,
	bindComponent,
	z,
} from "framefields/components";
import { counter } from "../counter/index.js";
import { valueAt } from "../counter/plan.js";
import { plan } from "./plan.js";

type H = import("framefields/components").Host;
`);
		expect(siblings).toEqual(["counter"]);
	});

	it("refuses imports it cannot rewrite", () => {
		expect(() =>
			rewriteImports('import { x } from "@framefields/core";\n', "x/index.ts"),
		).toThrow('cannot rewrite import from "@framefields/core"');
	});
});

describe("buildRegistry", () => {
	it("every component installs from framefields alone, plus the components it names", async () => {
		const items = await buildRegistry();
		expect(items.length).toBeGreaterThanOrEqual(26);
		const names = new Set(items.map((i) => i.name));
		for (const item of items) {
			for (const d of item.registryDependencies)
				expect(names.has(d)).toBe(true);
			for (const f of item.files) {
				expect(f.path.startsWith(`${item.name}/`)).toBe(true);
				expect(f.path).not.toMatch(/\.test\.ts$|\/meta\.ts$/);
				for (const m of f.content.matchAll(/from "([^"]+)"/g)) {
					const from = m[1] as string;
					const ok =
						from === "framefields" ||
						from === "framefields/components" ||
						from.startsWith("./") ||
						item.registryDependencies.some((d) => from.startsWith(`../${d}/`));
					expect(ok, `${f.path} imports ${from}`).toBe(true);
				}
			}
			const index = item.files.find((f) => f.path === `${item.name}/index.ts`);
			expect(index?.content).toContain(
				`export const ${item.title} = /* @__PURE__ */ bindComponent(`,
			);
		}
	});
});
