/**
 * Live input for interactive compositions: games, simulators, agents. The
 * browser player feeds it from the page (pointer on the canvas, keys,
 * wheel, gamepads); agents and tests feed it in code with the same calls.
 * Each frame latches a snapshot before the frame's hooks run, so everything
 * a frame reads (`down`, `pressed`, the pointer, signals bound to input)
 * agrees, and a run fed the same input frame by frame is the same run.
 *
 * ```ts
 * const input = comp.input;
 * comp.onRequestFrame(() => {
 *   ship.x += input.axis("ArrowLeft", "ArrowRight") * 8;
 *   if (input.pressed("Space")) fire();
 * });
 * input.on("pointerdown", async (e) => {
 *   const hit = await e.pick(); // the 3D layer under the pointer
 *   if (hit) select(hit.layer);
 * });
 * ```
 */
import { type FrameSignal, Signal } from "@framefields/core";
import {
	cameraRay,
	type PickResult,
	type Ray3D,
	rayPlane,
} from "@framefields/webgpu-renderers";

type Vec3 = [number, number, number];

/** What is under a point of the frame. */
export interface InputHit {
	/** Id of the layer drawn there (none for the environment's floor). */
	layer?: string;
	/** That layer's `label`. */
	label?: string;
	/** `mesh`, `quad` (a layer plane), `text` or `floor`. */
	kind: string;
	/** Which of the layer's draws (a model's meshes), in draw order. */
	part: number;
	/** The instance of an instanced draw (0 otherwise). */
	instance: number;
	/** The surface point, scene px (y down). */
	point: Vec3;
	/** Its unit normal, when measured. */
	normal?: Vec3;
	/** Distance along the camera's forward axis, scene px. */
	depth: number;
}

/** A pick: the hit (if any), and rays through any pixel from the same camera. */
export interface InputPick {
	hit: InputHit | null;
	/** The ray through frame pixel (`x`, `y`) from the camera that drew this pick; null without a 3D pass. */
	ray(x: number, y: number): Ray3D | null;
}

/** Picks frame pixel (`x`, `y`) of the frame on screen (the player's, or a headless render's). */
export type InputPicker = (x: number, y: number) => Promise<InputPick>;

export type InputEventType =
	| "pointerdown"
	| "pointermove"
	| "pointerup"
	| "wheel"
	| "keydown"
	| "keyup";

/** An input event, as it arrives (between frames). */
export interface InputEvent {
	type: InputEventType;
	/** Pointer position in frame px (the last known one for key events). */
	x: number;
	y: number;
	/** The button that changed (0 primary, 1 middle, 2 secondary); -1 for none. */
	button: number;
	/** Buttons held, as a bit mask (1 primary, 2 secondary, 4 middle). */
	buttons: number;
	/** For key events: `KeyboardEvent.code` (`"KeyW"`, `"Space"`, `"ArrowLeft"`). */
	code?: string;
	/** Wheel delta (positive away from the user). */
	deltaY: number;
	/** What is under the pointer: one more measured render of the frame on screen. */
	pick(): Promise<InputPick>;
}

/** The input state of one frame. */
interface Snapshot {
	held: Set<string>;
	pressed: Set<string>;
	released: Set<string>;
	pointer: { x: number; y: number; buttons: number; inside: boolean };
	wheel: number;
	gamepads: GamepadState[];
}

/** A gamepad as a frame sees it (the standard mapping's axes and buttons). */
export interface GamepadState {
	axes: number[];
	/** Button values 0..1. */
	buttons: number[];
}

const pointerKey = (button: number) => `Pointer${button}`;

export class CompositionInput {
	/** The state since the last latch, as events change it. */
	private readonly live: Snapshot = blank();
	private frameState: Snapshot = blank();
	private latched = Number.NaN;
	private readonly handlers = new Map<
		InputEventType,
		Set<(e: InputEvent) => void>
	>();
	private picker?: InputPicker;

	/** The frame the state was last latched for (NaN before the first). */
	get frame(): number {
		return this.latched;
	}

	/** @internal Latches the state for `frame` (once per frame; a re-render keeps it). */
	latch(frame: number): void {
		if (frame === this.latched) return;
		this.latched = frame;
		const { live } = this;
		this.frameState = {
			held: new Set(live.held),
			pressed: live.pressed,
			released: live.released,
			pointer: { ...live.pointer },
			wheel: live.wheel,
			gamepads: live.gamepads.map((g) => ({
				axes: [...g.axes],
				buttons: [...g.buttons],
			})),
		};
		live.pressed = new Set();
		live.released = new Set();
		live.wheel = 0;
	}

	// ---------------------------------------------------------------------------
	// Reading (what this frame sees).
	// ---------------------------------------------------------------------------

	/** Held this frame: a key's `code`, or `"Pointer0"` / `"Pointer2"` for buttons. */
	down(code: string): boolean {
		return this.frameState.held.has(code);
	}

	/** Went down since the previous frame (even if released again). */
	pressed(code: string): boolean {
		return this.frameState.pressed.has(code);
	}

	/** Went up since the previous frame. */
	released(code: string): boolean {
		return this.frameState.released.has(code);
	}

	/** -1, 0 or 1 from two keys (any of each list): `axis("KeyA", "KeyD")`. */
	axis(negative: string | string[], positive: string | string[]): number {
		const any = (codes: string | string[]) =>
			[codes].flat().some((c) => this.down(c));
		return (any(positive) ? 1 : 0) - (any(negative) ? 1 : 0);
	}

	/** The pointer this frame: frame px, buttons held, whether it is over the frame. */
	get pointer(): Readonly<Snapshot["pointer"]> {
		return this.frameState.pointer;
	}

	/** Wheel movement since the previous frame. */
	get wheel(): number {
		return this.frameState.wheel;
	}

	/** Gamepads this frame (standard mapping), by index. */
	get gamepads(): readonly GamepadState[] {
		return this.frameState.gamepads;
	}

	/** 1 while `code` is held, else 0, as a signal (bind it to any prop). */
	signal(code: string): FrameSignal<number> {
		return this.custom(() => (this.down(code) ? 1 : 0));
	}

	/** `axis(negative, positive)` as a signal. */
	axisSignal(
		negative: string | string[],
		positive: string | string[],
	): FrameSignal<number> {
		return this.custom(() => this.axis(negative, positive));
	}

	/** The pointer's `x` or `y` (frame px) as a signal. */
	pointerSignal(axis: "x" | "y"): FrameSignal<number> {
		return this.custom(() => this.pointer[axis]);
	}

	private custom(fn: () => number): FrameSignal<number> {
		return Signal.builder({
			type: "custom",
			fn,
		}) as unknown as FrameSignal<number>;
	}

	// ---------------------------------------------------------------------------
	// Events and picking.
	// ---------------------------------------------------------------------------

	/** Calls `handler` for each event of `type` as it arrives; returns a function that stops it. */
	on(type: InputEventType, handler: (e: InputEvent) => void): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);
		return () => set.delete(handler);
	}

	/**
	 * What frame pixel (`x`, `y`) shows in the frame on screen: the 3D layer,
	 * the surface point and normal. Measured by the renderer (one more
	 * render of that frame with its ground-truth targets), so it is exact for
	 * every Layer3D, model, text and instance.
	 */
	pick(x: number, y: number): Promise<InputPick> {
		if (!this.picker)
			return Promise.reject(
				new Error(
					"input.pick: nothing renders this composition yet (the preview player, or comp.pick in Node).",
				),
			);
		return this.picker(x, y);
	}

	/** @internal The player (or a headless render) installs how picks are made. */
	setPicker(picker: InputPicker | undefined): void {
		this.picker = picker;
	}

	// ---------------------------------------------------------------------------
	// Feeding (the player calls these; so can agents and tests).
	// ---------------------------------------------------------------------------

	/** A key went down (`KeyboardEvent.code`). Repeats while held are ignored. */
	keyDown(code: string): void {
		if (this.live.held.has(code)) return;
		this.live.held.add(code);
		this.live.pressed.add(code);
		this.emit("keydown", { code });
	}

	keyUp(code: string): void {
		if (!this.live.held.delete(code)) return;
		this.live.released.add(code);
		this.emit("keyup", { code });
	}

	/** The pointer moved to frame px (`x`, `y`); `inside` false once it leaves the frame. */
	pointerMove(x: number, y: number, inside = true): void {
		Object.assign(this.live.pointer, { x, y, inside });
		this.emit("pointermove", {});
	}

	pointerDown(x: number, y: number, button = 0): void {
		Object.assign(this.live.pointer, { x, y, inside: true });
		this.live.pointer.buttons |= buttonBit(button);
		const code = pointerKey(button);
		this.live.held.add(code);
		this.live.pressed.add(code);
		this.emit("pointerdown", { button });
	}

	pointerUp(x: number, y: number, button = 0): void {
		Object.assign(this.live.pointer, { x, y });
		this.live.pointer.buttons &= ~buttonBit(button);
		const code = pointerKey(button);
		if (this.live.held.delete(code)) this.live.released.add(code);
		this.emit("pointerup", { button });
	}

	wheelBy(deltaY: number): void {
		this.live.wheel += deltaY;
		this.emit("wheel", { deltaY });
	}

	/** The gamepads now (the player polls them each frame). */
	setGamepads(gamepads: GamepadState[]): void {
		this.live.gamepads = gamepads;
	}

	/** Releases everything held (the page lost focus). */
	releaseAll(): void {
		for (const code of [...this.live.held]) {
			if (code.startsWith("Pointer"))
				this.pointerUp(
					this.live.pointer.x,
					this.live.pointer.y,
					Number(code.slice(7)),
				);
			else this.keyUp(code);
		}
	}

	private emit(
		type: InputEventType,
		fields: Partial<Pick<InputEvent, "button" | "code" | "deltaY">>,
	): void {
		const handlers = this.handlers.get(type);
		if (!handlers?.size) return;
		const { x, y, buttons } = this.live.pointer;
		const event: InputEvent = {
			type,
			x,
			y,
			buttons,
			button: fields.button ?? -1,
			deltaY: fields.deltaY ?? 0,
			...(fields.code !== undefined && { code: fields.code }),
			pick: () => this.pick(x, y),
		};
		for (const handler of handlers) handler(event);
	}
}

const buttonBit = (button: number) =>
	button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 1 << button;

function blank(): Snapshot {
	return {
		held: new Set(),
		pressed: new Set(),
		released: new Set(),
		pointer: { x: 0, y: 0, buttons: 0, inside: false },
		wheel: 0,
		gamepads: [],
	};
}

/** A renderer's pick as `input.pick` gives it: labels named, rays from its camera. */
export function inputPick(
	result: PickResult,
	frameWidth: number,
	frameHeight: number,
	labels: ReadonlyMap<string, string>,
): InputPick {
	const { hit, camera } = result;
	const scaleX = result.width / frameWidth;
	const scaleY = result.height / frameHeight;
	return {
		hit: hit && {
			...(hit.object.layer !== undefined && { layer: hit.object.layer }),
			...(hit.object.layer !== undefined &&
				labels.has(hit.object.layer) && {
					label: labels.get(hit.object.layer),
				}),
			kind: hit.object.kind,
			part: hit.object.part,
			instance: hit.instance,
			point: hit.point,
			...(hit.normal && { normal: hit.normal }),
			depth: hit.depth,
		},
		ray: (x, y) =>
			camera
				? cameraRay(
						camera,
						result.width,
						result.height,
						(x + 0.5) * scaleX,
						(y + 0.5) * scaleY,
					)
				: null,
	};
}

export { type Ray3D, rayPlane };
