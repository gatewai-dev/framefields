import z, { type ZodTypeAny } from "zod";
import type { DataType } from "./types/base.js";

const HandleDefinitionSchema = z.object({
	dataTypes: z.custom<DataType[]>(),
	label: z.string(),
	required: z.boolean().optional(),
	order: z.number(),
	description: z.string().optional(),
});

export const ConfigHandleSchema = z.object({
	configKey: z.string(),
	dataTypes: z.custom<DataType[]>(),
	label: z.string(),
	description: z.string().optional(),
});

export type ConfigHandle = z.infer<typeof ConfigHandleSchema>;

/**
 * Function type for node config/input validation.
 */
export type NodeValidationFn = (
	config: any,
	inputs?: Record<string, any>,
	handles?: any[],
) => Record<string, string> | null;

/**
 * Metadata defining the interface and identity of a node.
 * This is safe to import in any environment.
 */
export const NodeMetadataSchema = z.object({
	// Identity
	type: z.string().min(1),
	version: z.number().int().positive().optional(),
	baseType: z.string().optional(),

	// User-friendly name for the node, used in the UI.
	displayName: z.string().min(1),

	// Short description of the node functionality.
	description: z.string().optional(),

	// Whether or not to show this node in quick access and sidebar.
	showInQuickAccess: z.boolean().optional(),
	showInSidebar: z.boolean().optional(),
	advanced: z.boolean().optional(),

	// Category
	category: z.string().min(1),
	subcategory: z.string().optional(),

	defaultDimensions: z
		.object({
			width: z.number().positive().optional(),
			height: z.number().positive().optional(),
		})
		.optional(),

	handles: z.object({
		inputs: z.array(HandleDefinitionSchema),
		outputs: z.array(HandleDefinitionSchema),
	}),

	variableInputs: z
		.discriminatedUnion("enabled", [
			z.object({
				enabled: z.literal(true),
				dataTypes: z.custom<DataType[]>(),
			}),
			z.object({
				enabled: z.literal(false),
				dataTypes: z.custom<DataType[]>().optional(),
			}),
		])
		.optional(),

	variableOutputs: z
		.discriminatedUnion("enabled", [
			z.object({
				enabled: z.literal(true),
				dataTypes: z.custom<DataType[]>(),
			}),
			z.object({
				enabled: z.literal(false),
				dataTypes: z.custom<DataType[]>().optional(),
			}),
		])
		.optional(),

	isTerminal: z.boolean().optional(),
	isTransient: z.boolean().optional(),

	configSchema: z.custom<ZodTypeAny>().optional(),
	defaultConfig: z.record(z.string(), z.unknown()).optional(),

	validation: z.any().optional(),

	resultSchema: z.custom<ZodTypeAny>().optional(),
	configHandles: z.array(ConfigHandleSchema).optional(),
});

export type NodeMetadata = Omit<
	z.infer<typeof NodeMetadataSchema>,
	"validation"
> & {
	validation?: NodeValidationFn;
};
