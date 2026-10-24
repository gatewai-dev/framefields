/**
 * A minimal component for testing the contract: a plate with a label that
 * "lands" at frame 10 and produces one cue per tick.
 */
import { z } from "zod";
import { defineComponent } from "../core/contract.js";

export const probe = defineComponent({
	name: "Probe",
	props: () => ({
		label: z.string().default("probe"),
		ticks: z.array(z.number().int().min(0)).default([]),
		size: z.number().positive().default(100),
	}),
	defaults: { enter: "rise", hold: 5 },
	build(ctx, props) {
		const plate = ctx.host.box({
			id: ctx.partId("plate"),
			position: "absolute",
			x: 0,
			y: 0,
			width: props.size,
			height: props.size,
			background: ctx.theme.color.accent,
			borderRadius: ctx.theme.radius.md,
		});
		const label = ctx.host.text(props.label, {
			id: ctx.partId("label"),
			fontFamily: ctx.theme.font.body,
			fill: ctx.theme.color.ink,
		});
		return {
			children: [plate, label],
			width: props.size,
			height: props.size,
			duration: 10,
			cues: {
				landed: [{ frame: 10 }],
				ticks: props.ticks.map((frame, i) => ({
					frame,
					index: i,
					jitter: ctx.rng(i).next(),
				})),
			},
			parts: { plate, label },
		};
	},
});
