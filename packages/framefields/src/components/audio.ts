/**
 * `analyzeAudio`: decode a track and analyse it into `AudioLevels`, plain
 * per-frame data for `Waveform` and `Captions` `pulse`. Offline and
 * deterministic: the same file always gives the same levels.
 */
import {
	type AnalyzeOptions,
	type AudioLevels,
	analyzeChannels,
} from "@framefields/components";
import { decodeAudioSource } from "@framefields/compositions";

export async function analyzeAudio(
	source: string,
	options: AnalyzeOptions = {},
): Promise<AudioLevels> {
	const decoded = await decodeAudioSource(source);
	if (!decoded || decoded.channels.length === 0)
		throw new Error(`analyzeAudio: could not decode audio from ${source}`);
	return analyzeChannels(decoded.channels, decoded.sampleRate, options);
}
