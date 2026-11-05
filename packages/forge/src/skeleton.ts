/**
 * Skeletons for rigged characters: joints placed at their rest positions in
 * model space (glTF: +y up, the character faces +z, its left side at +x),
 * built bone by bone or from a proportioned preset, with left/right
 * mirroring. Joints rest unrotated, so a joint's local axes are the model's:
 * `pose: { LeftArm: { rotateZ: … } }` turns about the same axis on every
 * joint, and `aim` / retargeting find a bone's direction from its child.
 */

export type Vec3 = [number, number, number];

export interface JointSpec {
	name: string;
	/** Rest position in model space. */
	at: Vec3;
	parent?: string;
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
		const joint: Joint = {
			name,
			at: [spec.at[0], spec.at[1], spec.at[2]],
			...(spec.parent === undefined ? {} : { parent: spec.parent }),
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
			this.add(rename(j.name), {
				at,
				...(parent === undefined ? {} : { parent }),
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

	/** The rest position relative to the parent (the glTF node translation). */
	local(name: string): Vec3 {
		const j = this.joint(name);
		if (j.parent === undefined) return [...j.at];
		const p = this.joint(j.parent).at;
		return [j.at[0] - p[0], j.at[1] - p[1], j.at[2] - p[2]];
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
