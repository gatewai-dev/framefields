/**
 * Answers that look at nothing, to read model scores against: no
 * violation ever; every object stays where it was last seen; a floor and a
 * light for a scene; four objects, option A.
 */
import type { BenchItem } from "./data.js";

interface PredictInputs {
	frames: number[];
	horizon: number[];
	objects: Array<{ name: string; positions: Record<string, number[]> }>;
}

/** What the static baseline answers to an item. */
export function staticAnswer(item: BenchItem): unknown {
	if (item.task === "violation") return { violation: false };
	if (item.task === "predict") {
		const inputs = item.inputs as unknown as PredictInputs;
		const last = (positions: Record<string, number[]>) =>
			positions[String(Math.max(...Object.keys(positions).map(Number)))];
		return {
			frames: Object.fromEntries(
				inputs.horizon.map((f) => [
					String(f),
					Object.fromEntries(
						inputs.objects.map((o) => [
							o.name,
							{ position: last(o.positions) },
						]),
					),
				]),
			),
		};
	}
	if (item.task === "recreate")
		return {
			layout: [
				{
					kind: "model3d",
					id: "floor",
					is3D: true,
					label: "floor",
					primitive3d: {
						type: "roundedBox",
						width: 3000,
						height: 20,
						depth: 3000,
						color: "#8a8f98",
					},
					x: 0,
					y: 410,
					z: 0,
				},
				{
					kind: "light",
					id: "ambient",
					lightType: "ambient",
					color: "#ffffff",
					intensity: 1,
				},
			],
		};
	return { answer: (item.inputs as { options?: string[] }).options ? "A" : 4 };
}
