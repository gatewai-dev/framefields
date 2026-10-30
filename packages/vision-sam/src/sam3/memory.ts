import type { Sam2Memory } from "../sam2/memory.js";

/** Dynamic memory lengths: never duplicate unavailable early-frame memories. */
export class Sam3MemoryBank {
	private seed?: Sam2Memory;
	private recent: Sam2Memory[] = [];
	constructor(private readonly temporal: Float32Array) {}
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
		frameCount: number,
	): {
		spatial: Float32Array;
		positions: Float32Array;
		pointers: Float32Array;
		encoding: Float32Array;
		pointerCount: number;
	} {
		if (!this.seed) throw new Error("SAM 3 needs a prompt before propagation.");
		const blocks = [this.seed, ...this.recent.slice(-6)];
		const spatial = new Float32Array(blocks.length * 5184 * 64),
			positions = new Float32Array(spatial.length);
		for (const [i, block] of blocks.entries()) {
			spatial.set(block.tokens, i * 5184 * 64);
			const row =
				block === this.seed ? 6 : Math.min(5, frame - block.frame - 1);
			for (let j = 0; j < block.positions.length; j++)
				positions[i * 5184 * 64 + j] =
					(block.positions[j] ?? 0) + (this.temporal[row * 64 + (j % 64)] ?? 0);
		}
		const entries = [this.seed, ...[...this.recent].reverse()].slice(0, 16);
		const pointers = new Float32Array(entries.length * 256),
			encoding = new Float32Array(16 * 256);
		for (const [i, entry] of entries.entries()) {
			pointers.set(entry.pointer, i * 256);
			const diff =
				(frame - entry.frame) / Math.max(1, Math.min(frameCount, 16) - 1);
			for (let j = 0; j < 128; j++) {
				const angle = diff / 10000 ** ((2 * Math.floor(j / 2)) / 128);
				encoding[i * 256 + j] = Math.sin(angle);
				encoding[i * 256 + 128 + j] = Math.cos(angle);
			}
		}
		return {
			spatial,
			positions,
			pointers,
			encoding,
			pointerCount: entries.length,
		};
	}
}

/** SAM 3 PositionEmbeddingSine: y then x, normalized pixel centers at grid indices 1..72. */
export function sam3Position(): Float32Array {
	const out = new Float32Array(5184 * 256);
	for (let y = 0; y < 72; y++)
		for (let x = 0; x < 72; x++)
			for (let j = 0; j < 128; j++) {
				const divisor = 10000 ** ((2 * Math.floor(j / 2)) / 128);
				const yy = (((y + 1) / (72 + 1e-6)) * 2 * Math.PI) / divisor,
					xx = (((x + 1) / (72 + 1e-6)) * 2 * Math.PI) / divisor;
				out[(y * 72 + x) * 256 + j] = j % 2 ? Math.cos(yy) : Math.sin(yy);
				out[(y * 72 + x) * 256 + 128 + j] = j % 2 ? Math.cos(xx) : Math.sin(xx);
			}
	return out;
}
