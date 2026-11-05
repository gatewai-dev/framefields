/**
 * Skeletons for rigged characters: joints placed at their rest positions in
 * model space (glTF: +y up, the character faces +z, its left side at +x),
 * built bone by bone or from a proportioned preset, with left/right
 * mirroring. Joints rest unrotated unless given an `orient`, so a joint's
 * local axes are the model's: `pose: { LeftArm: { rotateZ: … } }` turns
 * about the same axis on every joint, and `aim` / retargeting find a bone's
 * direction from its child. Rigs authored elsewhere (DNA files) bring rest
 * orientations, which the writer keeps.
 */

export type Vec3 = [number, number, number];
/** A rotation as a unit quaternion x, y, z, w. */
export type Quat = [number, number, number, number];

const IDENTITY: Quat = [0, 0, 0, 1];

/** Hamilton product a · b (b applied first). */
export function quatMultiply(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

export function quatConjugate(q: Quat): Quat {
	return [-q[0], -q[1], -q[2], q[3]];
}

/** `v` turned by `q`. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
	const r = quatMultiply(
		quatMultiply(q, [v[0], v[1], v[2], 0]),
		quatConjugate(q),
	);
	return [r[0], r[1], r[2]];
}

export interface JointSpec {
	name: string;
	/** Rest position in model space. */
	at: Vec3;
	parent?: string;
	/** Rest orientation in model space. Default: unrotated. */
	orient?: Quat;
	/** Free data written to the joint's glTF node `extras`. */
	extras?: Record<string, unknown>;
}

export interface Joint extends JointSpec {
	readonly index: number;
}

export interface MirrorOptions {
	/** Name fragment of the joints to copy. Default "Left". */
	from?: string;
	/** What it becomes on the copies. Default "Right". */
	to?: string;
	/** Model axis to reflect across. Default "x" (left ↔ right). */
	axis?: "x" | "y" | "z";
}

const AXIS = { x: 0, y: 1, z: 2 } as const;

export class Skeleton {
	private readonly list: Joint[] = [];
	private readonly byName = new Map<string, Joint>();

	/** Adds a joint; a parent must already exist. */
	add(name: string, spec: Omit<JointSpec, "name">): this {
		if (this.byName.has(name))
			throw new Error(`skeleton: joint "${name}" already exists`);
		if (spec.parent !== undefined && !this.byName.has(spec.parent))
			throw new Error(
				`skeleton: joint "${name}" has unknown parent "${spec.parent}"`,
			);
		if (!spec.at.every(Number.isFinite))
			throw new Error(`skeleton: joint "${name}" has a non-finite position`);
		if (spec.orient && !spec.orient.every(Number.isFinite))
			throw new Error(`skeleton: joint "${name}" has a non-finite orientation`);
		const joint: Joint = {
			name,
			at: [spec.at[0], spec.at[1], spec.at[2]],
			...(spec.parent === undefined ? {} : { parent: spec.parent }),
			...(spec.orient ? { orient: normalized(spec.orient) } : {}),
			...(spec.extras ? { extras: spec.extras } : {}),
			index: this.list.length,
		};
		this.list.push(joint);
		this.byName.set(name, joint);
		return this;
	}

	/**
	 * A chain of joints through `points`, named `${base}1`, `${base}2`, …
	 * (tails, braids, cloak columns, fingers). Returns the names, root first.
	 */
	chain(
		base: string,
		points: readonly Vec3[],
		options: { parent?: string; start?: number } = {},
	): string[] {
		const start = options.start ?? 1;
		let parent = options.parent;
		return points.map((at, i) => {
			const name = `${base}${start + i}`;
			this.add(name, { at, ...(parent === undefined ? {} : { parent }) });
			parent = name;
			return name;
		});
	}

	/**
	 * Copies every joint whose name contains `from` (default "Left") across
	 * the `axis` (default x), renamed with `to` (default "Right"). A copy's
	 * parent is the mirrored parent where there is one, else the same parent
	 * (`LeftShoulder` under `Spine2` becomes `RightShoulder` under `Spine2`).
	 */
	mirror(options: MirrorOptions = {}): this {
		const from = options.from ?? "Left";
		const to = options.to ?? "Right";
		const axis = AXIS[options.axis ?? "x"];
		const sources = this.list.filter((j) => j.name.includes(from));
		if (!sources.length)
			throw new Error(`skeleton: no joint names contain "${from}" to mirror`);
		const rename = (n: string) => n.split(from).join(to);
		for (const j of sources) {
			const at: Vec3 = [j.at[0], j.at[1], j.at[2]];
			at[axis] = -at[axis];
			const parent =
				j.parent === undefined
					? undefined
					: j.parent.includes(from)
						? rename(j.parent)
						: j.parent;
			// Reflected across the axis: keep that component, negate the others.
			const orient = j.orient?.map((c, k) =>
				k === axis || k === 3 ? c : -c,
			) as Quat | undefined;
			this.add(rename(j.name), {
				at,
				...(parent === undefined ? {} : { parent }),
				...(orient ? { orient } : {}),
				...(j.extras ? { extras: j.extras } : {}),
			});
		}
		return this;
	}

	/** Joints in order: every parent before its children. */
	get joints(): readonly Joint[] {
		return this.list;
	}

	has(name: string): boolean {
		return this.byName.has(name);
	}

	joint(name: string): Joint {
		const j = this.byName.get(name);
		if (!j) throw new Error(`skeleton: no joint "${name}"`);
		return j;
	}

	children(name: string): Joint[] {
		return this.list.filter((j) => j.parent === name);
	}

	/** The rest position in the parent's frame (the glTF node translation). */
	local(name: string): Vec3 {
		const j = this.joint(name);
		if (j.parent === undefined) return [...j.at];
		const p = this.joint(j.parent);
		const d: Vec3 = [j.at[0] - p.at[0], j.at[1] - p.at[1], j.at[2] - p.at[2]];
		return p.orient ? quatRotate(quatConjugate(p.orient), d) : d;
	}

	/** The rest orientation in model space. */
	orientation(name: string): Quat {
		return this.joint(name).orient ?? IDENTITY;
	}

	/** The rest orientation in the parent's frame (the glTF node rotation). */
	localRotation(name: string): Quat {
		const j = this.joint(name);
		const own = j.orient ?? IDENTITY;
		if (j.parent === undefined) return own;
		return quatMultiply(quatConjugate(this.orientation(j.parent)), own);
	}

	/** Whether any joint rests rotated. */
	get oriented(): boolean {
		return this.list.some((j) => j.orient !== undefined);
	}

	/** Distance from a joint to its parent. */
	length(name: string): number {
		const [x, y, z] = this.local(name);
		return this.joint(name).parent === undefined ? 0 : Math.hypot(x, y, z);
	}

	/** Every joint moved by `offset` (e.g. to stand the feet on y = 0). */
	translate(offset: Vec3): this {
		for (const j of this.list) {
			j.at[0] += offset[0];
			j.at[1] += offset[1];
			j.at[2] += offset[2];
		}
		return this;
	}
}

function normalized(q: Quat): Quat {
	const l = Math.hypot(q[0], q[1], q[2], q[3]);
	if (!(l > 0)) throw new Error("skeleton: zero quaternion");
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
