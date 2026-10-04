import type { VirtualMediaData } from "@gitframes/core";

const DEFAULT_STATE = { frame: 0, fps: 30, isPlaying: false };

class CompositionStateStore {
	private states = new Map<
		string,
		{ frame: number; fps: number; isPlaying: boolean }
	>();
	private listeners = new Map<string, Set<() => void>>();

	setState(key: string, frame: number, fps: number, isPlaying?: boolean) {
		const current = this.states.get(key);
		const resolvedPlaying =
			isPlaying !== undefined ? isPlaying : (current?.isPlaying ?? false);
		if (
			current?.frame === frame &&
			current?.fps === fps &&
			current?.isPlaying === resolvedPlaying
		)
			return;
		this.states.set(key, { frame, fps, isPlaying: resolvedPlaying });
		this.notify(key);
	}

	getState(key: string) {
		if (this.states.has(key)) return this.states.get(key)!;
		for (const [storeKey, value] of this.states.entries()) {
			if (key.startsWith(storeKey)) return value;
		}
		return DEFAULT_STATE;
	}

	subscribe(key: string, listener: () => void) {
		if (!this.listeners.has(key)) this.listeners.set(key, new Set());
		this.listeners.get(key)!.add(listener);
		return () => {
			const set = this.listeners.get(key);
			set?.delete(listener);
			if (set?.size === 0) {
				this.listeners.delete(key);
				this.states.delete(key);
			}
		};
	}

	clearKey(key: string) {
		this.states.delete(key);
	}

	private notify(key: string) {
		for (const [listenerKey, set] of this.listeners.entries()) {
			if (listenerKey === key || listenerKey.startsWith(key)) {
				set.forEach((l) => l());
			}
		}
	}
}

export const compositionStateStore = new CompositionStateStore();

export interface SceneProps {
	viewportWidth: number;
	viewportHeight: number;
	containerWidth?: number;
	containerHeight?: number;
	virtualMedia?: VirtualMediaData;
	backgroundColor?: string;
	type?: "Video" | "Audio" | "Image";
	volume?: number;
	renderId?: string;
	frame?: number;
	fps?: number;
	[key: string]: unknown;
}
