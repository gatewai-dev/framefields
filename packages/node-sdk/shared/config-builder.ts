import { z } from "zod";

/**
 * Per-field metadata, attached to the field's zod schema with `.meta()`.
 *
 * It is readable from the schema itself (`z.globalRegistry.get(schema)`) and
 * from `z.toJSONSchema(schema)`, which is what `scripts/generate-effects.mts`
 * uses to emit the authoring classes. Raw `z.object` configs can call
 * `.meta({...})` with these keys directly; `configBuilder().field()` is sugar
 * for the same thing. See `spec/sync-node.md` §5.2.
 */
export interface FieldMeta {
	label?: string;
	description?: string;
	dataTypes?: string[];
	/** Editor: the node shows an input handle for this field. */
	bindable?: boolean;
	/**
	 * Authoring: the prop is typed `EffectProp<T>` (value, signal or frame
	 * function). Defaults to `bindable`. Set it explicitly where the two differ.
	 */
	signal?: boolean;
	/** Editor wiring only. Excluded from the generated authoring surface. */
	editorOnly?: boolean;
	/** Escape hatch for a value zod cannot type, e.g. a GPU texture handle. */
	tsType?: { name: string; from: string };
}

/** @deprecated Use {@link FieldMeta}. */
export type FieldOptions = FieldMeta;

export class ConfigBuilder<
	TShape extends z.ZodRawShape = Record<string, never>,
> {
	constructor(
		private shape: TShape = {} as unknown as TShape,
		private options: { strict?: boolean } = { strict: true },
	) {}

	field<TKey extends string, TType extends z.ZodTypeAny>(
		key: TKey,
		schema: TType,
		options?: FieldMeta,
	): ConfigBuilder<TShape & { [K in TKey]: TType }> {
		// `.meta()` returns a new schema instance carrying the metadata, so the
		// caller's original schema object is left untouched.
		const withMeta = options ? (schema.meta({ ...options }) as TType) : schema;
		const newShape = {
			...this.shape,
			[key]: withMeta,
		} as TShape & { [K in TKey]: TType };
		return new ConfigBuilder(newShape, this.options);
	}

	build() {
		const base = z.object(this.shape);
		const schema = this.options.strict !== false ? base.strict() : base;
		return { schema };
	}
}

export function configBuilder(
	options: { strict?: boolean } = { strict: true },
) {
	return new ConfigBuilder({}, options);
}
