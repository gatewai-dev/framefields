import type {
	SessionProvider,
	VisionSession,
	VisionTensorInput,
	VisionTensorOutputs,
} from "@framefields/vision";

export class ScriptedSession implements VisionSession {
	public inputs: VisionTensorInput[] = [];
	constructor(private readonly outputs: VisionTensorOutputs) {}
	async run(input: VisionTensorInput): Promise<VisionTensorOutputs> {
		this.inputs.push({
			name: input.name,
			data: input.data.slice(),
			dims: [...input.dims],
		});
		return this.outputs;
	}
	async runMany(
		inputs: readonly VisionTensorInput[],
	): Promise<VisionTensorOutputs> {
		for (const input of inputs)
			this.inputs.push({
				...input,
				data: input.data.slice(),
				dims: [...input.dims],
			});
		return this.outputs;
	}
	release(): void {}
}

/** Replays `script[i]` for the i-th session created (one per model). */
export class ScriptedProvider implements SessionProvider {
	public readonly kind = "node" as const;
	public created: ScriptedSession[] = [];
	private readonly script: ScriptedSession[];
	constructor(script: readonly VisionTensorOutputs[]) {
		this.script = script.map((outputs) => new ScriptedSession(outputs));
	}
	async createSession(): Promise<VisionSession> {
		const session = this.script[this.created.length] ?? new ScriptedSession({});
		this.created.push(session);
		return session;
	}
}
