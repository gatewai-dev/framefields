import type { ClipPath, Rect } from "./index.js";

export interface ScissorEntry {
	rect: Rect;
	surfaceWidth?: number;
	surfaceHeight?: number;
}

export class ClipStack {
	private scissorStack: ScissorEntry[] = [];
	private stencilStack: ClipPath[] = [];

	pushScissor(rect: Rect, surfaceWidth?: number, surfaceHeight?: number): void {
		this.scissorStack.push({ rect, surfaceWidth, surfaceHeight });
	}

	popScissor(): void {
		if (this.scissorStack.length > 0) {
			this.scissorStack.pop();
		}
	}

	saveScissors(): ScissorEntry[] {
		return [...this.scissorStack];
	}

	restoreScissors(entries: ScissorEntry[]): void {
		this.scissorStack = [...entries];
	}

	clearScissors(): void {
		this.scissorStack = [];
	}

	getCurrentScissor(
		surfaceWidth?: number,
		surfaceHeight?: number,
	): Rect | undefined {
		const entry = this.scissorStack[this.scissorStack.length - 1];
		if (!entry) return undefined;
		if (
			surfaceWidth !== undefined &&
			surfaceHeight !== undefined &&
			entry.surfaceWidth !== undefined &&
			entry.surfaceHeight !== undefined &&
			entry.surfaceWidth !== 0 &&
			entry.surfaceHeight !== 0 &&
			(entry.surfaceWidth !== surfaceWidth ||
				entry.surfaceHeight !== surfaceHeight)
		) {
			return undefined;
		}
		return entry.rect;
	}

	pushStencilClip(path: ClipPath): void {
		this.stencilStack.push(path);
	}

	popStencilClip(): void {
		if (this.stencilStack.length > 0) {
			this.stencilStack.pop();
		}
	}

	getCurrentStencil(): ClipPath | undefined {
		return this.stencilStack[this.stencilStack.length - 1];
	}

	applyScissorToPass(
		pass: GPURenderPassEncoder,
		surfaceWidth: number,
		surfaceHeight: number,
	): void {
		const current = this.getCurrentScissor(surfaceWidth, surfaceHeight);
		if (!current) {
			pass.setScissorRect(
				0,
				0,
				Math.max(1, Math.floor(surfaceWidth)),
				Math.max(1, Math.floor(surfaceHeight)),
			);
			return;
		}

		const x = Math.max(0, Math.floor(current.x));
		const y = Math.max(0, Math.floor(current.y));
		const right = Math.min(surfaceWidth, Math.ceil(current.x + current.width));
		const bottom = Math.min(
			surfaceHeight,
			Math.ceil(current.y + current.height),
		);
		const width = Math.max(0, right - x);
		const height = Math.max(0, bottom - y);

		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width <= 0 ||
			height <= 0
		) {
			pass.setScissorRect(0, 0, 1, 1);
		} else {
			// Final safety clamp to avoid WebGPU errors if surfaceWidth/Height were slightly off
			const clampedWidth = Math.min(width, Math.max(0, surfaceWidth - x));
			const clampedHeight = Math.min(height, Math.max(0, surfaceHeight - y));

			if (clampedWidth <= 0 || clampedHeight <= 0) {
				pass.setScissorRect(0, 0, 1, 1);
			} else {
				pass.setScissorRect(
					Math.floor(x),
					Math.floor(y),
					Math.floor(clampedWidth),
					Math.floor(clampedHeight),
				);
			}
		}
	}

	destroy(): void {
		this.scissorStack = [];
		this.stencilStack = [];
	}
}
