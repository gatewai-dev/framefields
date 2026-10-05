/**
 * Inline signal objects on animation tracks.
 *
 * `LayerAnimation.signal(prop, Signal.fromArray(...))` binds a track to a
 * signal object instead of a name registered with `comp.addSignal`. The spec
 * stays plain data: the track's `inputHandleId` gets a generated name and the
 * object rides on the source under a non-enumerable symbol (invisible to JSON,
 * zod and hashing). `compositorToProgram` walks the layout and folds those
 * objects into the program's `signals` map under their generated names, so
 * every evaluator (which only looks signals up by name) sees them.
 */

const INLINE_SIGNAL = Symbol.for("framefields.inlineSignal");

const handleIds = new WeakMap<object, string>();
let nextHandle = 0;

/**
 * The generated handle id for a signal object. The same object always gets
 * the same id, so reusing one signal across tracks registers it once.
 */
function inlineSignalHandleId(signal: object): string {
	let id = handleIds.get(signal);
	if (id === undefined) {
		id = `inline_signal_${nextHandle++}`;
		handleIds.set(signal, id);
	}
	return id;
}

/**
 * Resolves the `signalOrHandleId` argument of `LayerAnimation.signal` /
 * `colorSignal` to a handle id, plus the signal object to carry inline (when
 * it is not a registered name).
 */
export function resolveSignalArg(signalOrHandleId: unknown): {
	handleId: string;
	inline?: object;
} {
	if (typeof signalOrHandleId === "string") {
		return { handleId: signalOrHandleId };
	}
	if (
		signalOrHandleId === null ||
		(typeof signalOrHandleId !== "object" &&
			typeof signalOrHandleId !== "function")
	) {
		throw new TypeError(
			`LayerAnimation.signal: expected a signal object or a signal name, got ${String(signalOrHandleId)}. ` +
				`Pass a signal (Signal.fromArray / Signal.builder / an audio channel …) or register it with comp.addSignal(name, signal) and pass the name.`,
		);
	}
	const obj = signalOrHandleId as {
		inputHandleId?: unknown;
		gpuBinding?: { nodeId?: unknown };
		get?: unknown;
	};
	// Graph source descriptors (audio extractors …) are resolved by their own
	// handle at render time.
	if (typeof obj.inputHandleId === "string") {
		return { handleId: obj.inputHandleId };
	}
	// GPU-bound signals keep their node id as the handle; their CPU `get()`
	// still rides inline, so the track animates even when nothing registers
	// that node id (an explicit registration under the same id wins).
	if (typeof obj.gpuBinding?.nodeId === "string") {
		return typeof obj.get === "function"
			? { handleId: obj.gpuBinding.nodeId, inline: signalOrHandleId }
			: { handleId: obj.gpuBinding.nodeId };
	}
	return {
		handleId: inlineSignalHandleId(signalOrHandleId),
		inline: signalOrHandleId,
	};
}

/** Attaches an inline signal object to a track source without making it enumerable. */
export function attachInlineSignal(source: object, signal: object): void {
	Object.defineProperty(source, INLINE_SIGNAL, {
		value: signal,
		enumerable: false,
		configurable: true,
		writable: true,
	});
}

/** The inline signal object carried by a track source, if any. */
export function getInlineSignal(source: unknown): object | undefined {
	if (!source || typeof source !== "object") return undefined;
	return (source as { [INLINE_SIGNAL]?: object })[INLINE_SIGNAL];
}

/**
 * Collects every inline signal object under `nodes` (animation tracks of each
 * node, recursing into `children`) keyed by its generated handle id.
 */
export function collectInlineSignals(
	nodes: readonly unknown[],
	out: Record<string, unknown> = {},
): Record<string, unknown> {
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue;
		const { animation, children } = node as {
			animation?: { tracks?: unknown };
			children?: unknown;
		};
		const tracks = animation?.tracks;
		if (Array.isArray(tracks)) {
			for (const track of tracks) {
				const source = (track as { source?: { inputHandleId?: unknown } })
					?.source;
				const signal = getInlineSignal(source);
				if (signal && typeof source?.inputHandleId === "string") {
					out[source.inputHandleId] = signal;
				}
			}
		}
		if (Array.isArray(children)) collectInlineSignals(children, out);
	}
	return out;
}
