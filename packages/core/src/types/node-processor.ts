import type { DataTypeEnum } from "./base.js";
import type { AnyOutputUnion, NodeResult } from "./node-result.js";

export type ConnectedInput = {
	connectionValid: boolean;
	outputItem: AnyOutputUnion | null;
};

export interface NodeProcessorContext {
	getFirstOutputHandle: (
		nodeId: string,
		type?: DataTypeEnum,
	) => string | undefined;
	getFirstOutputHandleWithLabel: (
		nodeId: string,
		label: string,
	) => string | undefined;
	findInputData: (
		inputs: Record<string, ConnectedInput>,
		requiredType?: string,
		handleLabel?: string,
	) => string | undefined;
	registerObjectUrl: (url: string) => void;
	getOutputHandle: (type: string, label?: string) => string | undefined;
}

export type NodeProcessorParams<TNode = any> = {
	node: TNode;
	inputs: Record<string, ConnectedInput>;
	signal: AbortSignal;
	data: any;
	context: NodeProcessorContext;
};

export type NodeRunFunction<TNode = any> = (
	params: NodeProcessorParams<TNode>,
) => Promise<NodeResult | null>;
