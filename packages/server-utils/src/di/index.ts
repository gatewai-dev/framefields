import { Container } from "inversify";

const GLOBAL_CONTAINER_KEY = Symbol.for("gatewai.server-utils.container");

// Using type-safe global accessor to avoid the 'any' type
const globalObj = globalThis as unknown as {
	[GLOBAL_CONTAINER_KEY]?: Container;
};

if (!globalObj[GLOBAL_CONTAINER_KEY]) {
	globalObj[GLOBAL_CONTAINER_KEY] = new Container();
}

export const container = globalObj[GLOBAL_CONTAINER_KEY]!;
export * from "./tokens.js";
