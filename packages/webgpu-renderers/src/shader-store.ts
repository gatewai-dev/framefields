import type { VirtualMediaData } from "@framefields/core";

export interface RegisteredShader {
	wgsl: string;
	name: string;
	outputType: string;
	fnParams: Array<{
		name: string;
		type: string;
		defaultValue: number;
	}>;
}

class ShaderStore {
	private store = new Map<string, RegisteredShader>();

	private getCacheKey(nodeId: string, renderId?: string): string {
		return `${renderId ?? "global"}:${nodeId}`;
	}

	register(nodeId: string, shader: RegisteredShader, renderId?: string): void {
		this.store.set(this.getCacheKey(nodeId, renderId), shader);
		if (renderId) {
			this.store.set(this.getCacheKey(nodeId, undefined), shader);
		}
	}

	get(nodeId: string, renderId?: string): RegisteredShader | undefined {
		const res = this.store.get(this.getCacheKey(nodeId, renderId));
		if (!res && renderId) {
			return this.store.get(this.getCacheKey(nodeId, undefined));
		}
		return res;
	}

	delete(nodeId: string, renderId?: string): void {
		this.store.delete(this.getCacheKey(nodeId, renderId));
	}

	clear(renderId: string): void {
		const prefix = `${renderId}:`;
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) {
				this.store.delete(key);
			}
		}
	}

	registerSignalsFromComposition(
		renderId: string | undefined,
		virtualMedia: VirtualMediaData,
	): void {
		const traverse = (node: VirtualMediaData) => {
			if (!node) return;
			const op = node.operation as any;
			if (op && op.inputs) {
				for (const inputEntry of Object.values(op.inputs)) {
					if (
						inputEntry &&
						(inputEntry as any).connectionValid &&
						(inputEntry as any).outputItem &&
						(inputEntry as any).outputItem.type === "Signal"
					) {
						const sd = (inputEntry as any).outputItem.data;
						if (sd && sd.nodeId) {
							const customWGSL = sd.customWGSL || sd.wgsl;
							if (customWGSL) {
								this.register(
									sd.nodeId,
									{
										wgsl: customWGSL,
										name:
											sd.signalFnName ||
											sd.name ||
											`signal_${sd.nodeId.replace(/[^a-zA-Z0-9]/g, "_")}`,
										outputType: sd.fnOutputType ?? sd.outputType ?? "f32",
										fnParams: sd.fnParams ?? [],
									},
									renderId,
								);
							}
						}
					}
				}
			}
			if (node.children) {
				for (const child of node.children) {
					traverse(child);
				}
			}
		};
		traverse(virtualMedia);
	}
}

export const shaderStore = new ShaderStore();
