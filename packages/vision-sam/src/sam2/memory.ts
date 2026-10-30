/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

/** CPU-owned memory bank; neural inference uses the configured vision execution provider. */
export interface Sam2Memory {
	readonly frame: number;
	readonly tokens: Float32Array;
	readonly positions: Float32Array;
	readonly pointer: Float32Array;
}

export class Sam2MemoryBank {
	private seed?: Sam2Memory;
	private recent: Sam2Memory[] = [];
	constructor(private readonly temporal: readonly (readonly number[])[]) {}

	remember(memory: Sam2Memory, prompted: boolean): void {
		if (prompted) {
			this.seed = memory;
			this.recent = [];
		} else {
			this.recent.push(memory);
			if (this.recent.length > 15) this.recent.shift();
		}
	}

	assemble(
		frame: number,
		frameCount = 16,
	): {
		memory: Float32Array;
		positions: Float32Array;
		distances: Float32Array;
	} {
		if (!this.seed)
			throw new Error("SAM 2 must be prompted before propagation.");
		const newest = [...this.recent].reverse();
		const blocks = [this.seed, ...newest.slice(0, 6)];
		while (blocks.length < 7) blocks.push(blocks[1] ?? this.seed);
		const pointers = [this.seed, ...newest].slice(0, 16);
		while (pointers.length < 16)
			pointers.push(pointers[pointers.length - 1] as Sam2Memory);
		const length = this.seed.tokens.length;
		const memory = new Float32Array(length * 7 + 16 * 256);
		const positions = new Float32Array(memory.length);
		for (const [slot, block] of blocks.entries()) {
			memory.set(block.tokens, slot * length);
			const available = Math.min(slot, this.recent.length);
			const row =
				this.temporal[slot === 0 || available === 0 ? 6 : available - 1];
			writePositions(positions, slot * length, block.positions, row);
		}
		const distances = new Float32Array(16);
		for (const [i, entry] of pointers.entries()) {
			memory.set(entry.pointer, length * 7 + i * 256);
			distances[i] =
				Math.abs(frame - entry.frame) /
				Math.max(1, Math.min(frameCount, 16) - 1);
		}
		return { memory, positions, distances };
	}
}

/** NCHW features to the sequence-major layout consumed by memory attention. */
export function sam2Tokens(data: Float32Array): Float32Array {
	const count = data.length / 256;
	const result = new Float32Array(data.length);
	for (let channel = 0; channel < 256; channel++) {
		for (let token = 0; token < count; token++)
			result[token * 256 + channel] = data[channel * count + token] ?? 0;
	}
	return result;
}

function writePositions(
	target: Float32Array,
	offset: number,
	spatial: Float32Array,
	temporal?: readonly number[],
): void {
	if (!temporal || temporal.length !== 64)
		throw new Error("Invalid SAM 2 temporal encoding.");
	for (let i = 0; i < spatial.length; i++)
		target[offset + i] = (spatial[i] ?? 0) + (temporal[i % 64] ?? 0);
}
