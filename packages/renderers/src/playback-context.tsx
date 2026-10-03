import { createContext, useContext } from "react";

export interface PlaybackContextValue {
	frame: number;
	fps: number;
	isPlaying: boolean;
}

export const PlaybackContext = createContext<PlaybackContextValue>({
	frame: 0,
	fps: 24,
	isPlaying: false,
});

export const PlaybackProvider = PlaybackContext.Provider;

export const useCurrentFrame = (): number => {
	const value = useContext(PlaybackContext);
	return value.frame;
};

export const useVideoConfig = () => {
	const value = useContext(PlaybackContext);
	return {
		fps: value.fps,
		width: 1920,
		height: 1080,
	};
};
