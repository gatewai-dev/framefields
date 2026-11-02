/// <reference lib="webworker" />
/**
 * The preview's soundtrack: the export's mixer run in the browser, a stretch
 * at a time. The page asks a worker running this (with its own GPU device)
 * for the blocks around its playhead, so mixing never holds up drawing; it
 * mixes on the page itself only if the worker can't.
 */
import { BUILTIN_NODE_RENDERERS } from "framefields-preview:renderers";
import { mixAudioTracks, preflightMediaTime } from "@framefields/compositions";
import type { VirtualMediaData } from "@framefields/core";
import { ensureDevice } from "@framefields/webgpu-renderers";
import { registerRenderers } from "./register.js";

/** A stretch of the soundtrack, before the master stage. */
export interface PreviewMix {
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
	/** Its loudest sample: the page masters with the film's loudest. */
	peak: number;
	/**
	 * The same samples as that stretch of a full mix: mixed from the film's
	 * start, or continuing a chain of back-to-back stretches that began
	 * there. Otherwise effects with memory start from a lead-in.
	 */
	exact: boolean;
}

export interface MixRange {
	startSec: number;
	endSec: number;
}

/** What a composition export gives the mixer. */
export interface AudioTarget {
	toVirtualMediaAsync?: () => Promise<VirtualMediaData>;
	toVirtualMedia?: () => VirtualMediaData;
	/** Finishes live signal time, recorded frame by frame, before a mix. */
	prepareMediaTime?: () => Promise<void>;
}

/**
 * Seconds mixed before a window and dropped, so effects that carry state
 * (reverb tails, delays, compressors) enter it warmed up, as in a full mix.
 */
const AUDIO_LEAD_IN_SEC = 2;

/** The mixing function `createAudioMixer` returns. */
export type AudioMixer = (
	range: MixRange,
	chain?: string,
) => Promise<PreviewMix>;

/**
 * Mixes [startSec, endSec) of the target's soundtrack with the export's
 * mixer: the same decoders (reading only the stretch it plays, so pinned
 * assets stream from their bucket), audio effects on `device` and signals.
 *
 * Each `chain` keeps its own effect state. A stretch that starts where the
 * chain's last one ended continues that state, so a chain of back-to-back
 * stretches is the full mix, sample for sample; any other starts fresh from
 * a lead-in. The page plays on one chain and fills the film in on another,
 * so neither breaks the other.
 */
export function createAudioMixer(
	target: AudioTarget,
	fps: number,
	device: GPUDevice,
	renderId: string,
): AudioMixer {
	const chains = new Map<string, { endSec: number; exact: boolean }>();
	// Prepared once, as the export prepares it: a fresh tree, live signal
	// time finished, media timing preflighted.
	let prepared: Promise<VirtualMediaData> | undefined;
	const prepare = async () => {
		const tree = target.toVirtualMediaAsync
			? await target.toVirtualMediaAsync()
			: target.toVirtualMedia?.();
		if (!tree) throw new Error("The export is not a composition.");
		await target.prepareMediaTime?.();
		await preflightMediaTime(tree, fps);
		return tree;
	};
	return async (range, chain = "main") => {
		prepared ??= prepare();
		const tree = await prepared;
		const last = chains.get(chain);
		chains.delete(chain); // until this stretch is mixed
		const contiguous =
			last !== undefined && Math.abs(range.startSec - last.endSec) < 1e-6;
		const from = contiguous
			? range.startSec
			: Math.max(0, range.startSec - AUDIO_LEAD_IN_SEC);
		const exact = contiguous ? last.exact : from === 0;
		const { channels, sampleRate } = await mixAudioTracks(
			tree,
			fps,
			48_000,
			device,
			`${renderId}-${chain}`,
			{
				window: { startSec: from, endSec: range.endSec },
				master: false,
				continue: contiguous,
			},
		);
		chains.set(chain, { endSec: range.endSec, exact });
		const drop = Math.round((range.startSec - from) * sampleRate);
		const left = (channels[0] ?? new Float32Array(0)).slice(drop);
		const right = (channels[1] ?? channels[0] ?? left).slice(drop);
		let peak = 0;
		for (let i = 0; i < left.length; i++)
			peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
		return { left, right, sampleRate, peak, exact };
	};
}

export interface MixRequest {
	id: number;
	range: MixRange;
	/** The effect-state chain to mix on (see `createAudioMixer`). */
	chain: string;
}

export type MixReply =
	| { ready: true }
	| { ready: false; error: string }
	| { id: number; mix: PreviewMix }
	| { id: number; error: string };

/**
 * The worker side: the project's bundle calls this instead of starting a
 * player when it runs in a worker. It builds the composition, then answers
 * each `MixRequest` with the stretch mixed (its buffers transferred).
 */
export function startAudioMixer(
	mod: Record<string, unknown>,
	exportName: string,
): void {
	const scope = self as unknown as DedicatedWorkerGlobalScope;
	const ready = (async () => {
		await registerRenderers(BUILTIN_NODE_RENDERERS);
		const exported = mod[exportName];
		const target = (
			typeof exported === "function"
				? await (exported as () => unknown)()
				: exported
		) as AudioTarget & { fps?: number };
		const vm = target.toVirtualMediaAsync
			? await target.toVirtualMediaAsync()
			: target.toVirtualMedia?.();
		const fps =
			target.fps ?? (vm?.operation as { fps?: number } | undefined)?.fps ?? 30;
		return createAudioMixer(target, fps, await ensureDevice(), "worker-audio");
	})();
	ready.then(
		() => scope.postMessage({ ready: true } satisfies MixReply),
		(err: unknown) =>
			scope.postMessage({
				ready: false,
				error: errorText(err),
			} satisfies MixReply),
	);
	// One stretch at a time, in the order asked: the page queues them.
	let queue: Promise<void> = Promise.resolve();
	scope.onmessage = (event: MessageEvent<MixRequest>) => {
		const { id, range, chain } = event.data;
		queue = queue.then(async () => {
			try {
				const mix = await (await ready)(range, chain);
				scope.postMessage({ id, mix } satisfies MixReply, [
					mix.left.buffer,
					mix.right.buffer,
				]);
			} catch (err) {
				scope.postMessage({ id, error: errorText(err) } satisfies MixReply);
			}
		});
	};
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
