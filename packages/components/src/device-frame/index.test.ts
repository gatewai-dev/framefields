import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { deviceFrame } from "./index.js";

const make = () => bind(fakeHost(), deviceFrame);
type Node = {
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	scale?: number;
	rotateY?: number;
	children?: Node[];
};
const find = (n: unknown, id: string): Node | undefined => {
	const node = n as Node;
	if (node.id === id) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};

describe("DeviceFrame", () => {
	for (const [device, orientation] of [
		["phone", "portrait"],
		["phone", "landscape"],
		["tablet", "portrait"],
		["laptop", "portrait"],
	] as const)
		it(`${device} ${orientation}: at() spans the screen`, () => {
			const d = make()({ id: "d", device, orientation, x: 100, y: 50 });
			const r = d.screenRect;
			const pts =
				device === "phone"
					? orientation === "portrait"
						? [393, 852]
						: [852, 393]
					: device === "tablet"
						? [820, 1180]
						: [1440, 900];
			expect(d.at(0, 0)).toEqual([r.x, r.y]);
			const [x, y] = d.at(pts[0] as number, pts[1] as number);
			expect(x).toBeCloseTo(r.x + r.width, 6);
			expect(y).toBeCloseTo(r.y + r.height, 6);
			// The screen sits inside the device.
			expect(r.x).toBeGreaterThan(100);
			expect(r.x + r.width).toBeLessThan(100 + (d.width as number));
			// Content is laid out in points and scaled to the screen.
			const content = find(d, "d-content");
			expect(content?.width).toBe(pts[0]);
			expect((content?.width ?? 0) * (content?.scale ?? 0)).toBeCloseTo(
				r.width,
				6,
			);
		});

	it("sizes from height (handhelds) or width (laptops)", () => {
		expect(make()({ device: "phone", height: 800 }).height).toBe(800);
		expect(make()({ device: "laptop", width: 1000 }).width).toBe(1000);
	});

	it("fills, tilts and draws the island and status bar", () => {
		const d = make()({ id: "d", tilt: { rotateY: -20 } });
		d.fill({ kind: "box", id: "ui" } as never);
		expect(find(d, "d-content")?.children?.map((c) => c.id)).toEqual(["ui"]);
		expect(find(d, "d-tilt")?.rotateY).toBe(-20);
		expect(find(d, "d-island")).toBeDefined();
		expect(find(d, "d-status-time")).toBeDefined();
		const bare = make()({ id: "b", device: "laptop" });
		expect(find(bare, "b-island")).toBeUndefined();
		expect(find(bare, "b-status")).toBeUndefined();
		expect(find(bare, "b-base")).toBeDefined();
	});
});
