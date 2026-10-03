/**
 * @file packages/compositions/src/program/text-animations/typewriter.ts
 * Realistic human cadence typewriter simulation, matrix scramble cipher, and blinking cursor.
 */

import type { TextScrambleConfig, TypingCadence } from "./types.js";

const SCRAMBLE_POOLS: Record<string, string> = {
	ascii: "!@#$%^&*()_+{}[]:;<>,.?",
	alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
	matrix: "010101<>[]{}+=*~#%&!?/\\:;|X0123456789",
	binary: "01",
	hex: "0123456789ABCDEF",
};

export function getScramblePool(
	charset: string,
	customCharset?: string,
): string {
	if (charset === "custom" && customCharset && customCharset.length > 0) {
		return customCharset;
	}
	return SCRAMBLE_POOLS[charset] ?? SCRAMBLE_POOLS.alphanumeric;
}

/**
 * Evaluates typewriter visible character count and scramble state for frame `currentFrame`.
 */
export function evaluateTypewriterState(
	fullText: string,
	currentFrame: number,
	startFrame: number,
	durationFrames: number,
	cadence: TypingCadence = {
		mode: "human",
		jitter: 0.35,
		commaPauseMultiplier: 3.0,
		sentencePauseMultiplier: 5.5,
		paragraphPauseMultiplier: 7.0,
	},
	scramble: TextScrambleConfig = {
		enabled: false,
		charset: "alphanumeric",
		scrambleFramesPerChar: 8,
		highlightProbability: 0.25,
	},
	blinkFrequency = 2.0,
	granularity: "character" | "word" | "line" = "character",
	progressOverride?: number,
): {
	visibleChars: number;
	currentDisplayString: string;
	isCursorVisible: boolean;
} {
	if (progressOverride === undefined && currentFrame < startFrame) {
		return {
			visibleChars: 0,
			currentDisplayString: "",
			isCursorVisible: false,
		};
	}

	const progress =
		progressOverride !== undefined
			? Math.max(0, Math.min(1, progressOverride))
			: Math.min(1, (currentFrame - startFrame) / Math.max(1, durationFrames));
	const elapsed =
		progressOverride !== undefined
			? progress * durationFrames
			: currentFrame - startFrame;
	const totalChars = fullText.length;

	let visibleCount = Math.floor(progress * totalChars);

	if (granularity === "word") {
		const tokens = fullText.split(/(\s+)/);
		const wordIndices: number[] = [];
		tokens.forEach((t, i) => {
			if (t.trim().length > 0) wordIndices.push(i);
		});
		const visibleWords = Math.min(
			wordIndices.length,
			Math.floor(progress * (wordIndices.length + 1)),
		);
		if (visibleWords <= 0) {
			visibleCount = 0;
		} else {
			const lastIdx =
				wordIndices[Math.min(wordIndices.length - 1, visibleWords - 1)];
			visibleCount = tokens.slice(0, lastIdx + 1).join("").length;
		}
	} else if (granularity === "line") {
		const lines = fullText.split("\n");
		const visibleLines = Math.min(
			lines.length,
			Math.floor(progress * (lines.length + 1)),
		);
		visibleCount = lines.slice(0, visibleLines).join("\n").length;
	} else if (cadence.mode === "human" && progress < 1) {
		// Apply punctuation cadence delays if human mode is enabled
		let simulatedCharIndex = 0;
		let simulatedElapsed = 0;
		const baseFramesPerChar = durationFrames / Math.max(1, totalChars);

		for (let i = 0; i < totalChars; i++) {
			const char = fullText[i];
			let multiplier = 1.0;
			const commaMult = cadence.commaPauseMultiplier ?? 3.0;
			const sentenceMult = cadence.sentencePauseMultiplier ?? 5.5;
			const paraMult = cadence.paragraphPauseMultiplier ?? 7.0;
			const jitter = cadence.jitter ?? 0.35;

			if (char === "," || char === ";") multiplier = commaMult;
			else if (char === "." || char === "!" || char === "?")
				multiplier = sentenceMult;
			else if (char === "\n") multiplier = paraMult;

			// Add small deterministic jitter
			const jitterVal = 1 + Math.sin(i * 17.3 + 42) * 0.5 * jitter;
			const charDuration = baseFramesPerChar * multiplier * jitterVal;

			simulatedElapsed += charDuration;
			if (simulatedElapsed <= elapsed) {
				simulatedCharIndex = i + 1;
			} else {
				break;
			}
		}
		visibleCount = Math.min(totalChars, simulatedCharIndex);
	}

	let displayStr = fullText.slice(0, visibleCount);

	// Scramble pool substitution on the trailing edge of typed characters
	if (scramble.enabled && visibleCount < totalChars && visibleCount > 0) {
		const pool = getScramblePool(scramble.charset, scramble.customCharset);
		const trailCount = Math.min(
			visibleCount,
			Math.max(1, scramble.scrambleFramesPerChar > 4 ? 3 : 2),
		);
		let scrambledTail = "";
		for (let t = 0; t < trailCount; t++) {
			const idx =
				Math.floor(
					Math.abs(Math.sin(currentFrame * 7 + t * 13)) * pool.length,
				) % pool.length;
			scrambledTail += pool[idx];
		}
		displayStr =
			displayStr.slice(0, displayStr.length - trailCount) + scrambledTail;
	}

	// Cursor blink based on frequency (Hz)
	// At 30fps and 2Hz -> 15 frames per cycle (7.5 on, 7.5 off)
	let isCursorVisible = true;
	if (blinkFrequency > 0) {
		const halfPeriodFrames = Math.max(1, Math.round(30 / (2 * blinkFrequency)));
		isCursorVisible = Math.floor(elapsed / halfPeriodFrames) % 2 === 0;
	}

	return {
		visibleChars: visibleCount,
		currentDisplayString: displayStr,
		isCursorVisible,
	};
}
