/**
 * The envs over JSON-RPC on stdin/stdout, for the Python client
 * (`python/framefields_envs`):
 *
 *   pnpm --filter @framefields/envs serve
 *
 * stdout carries only the protocol: anything else printed goes to stderr.
 */
import { serveEnvs } from "framefields/datasets";
import { push } from "./envs/push.js";

console.log = console.error;
console.info = console.error;
console.warn = console.error;

await serveEnvs({ push });
process.exit(0);
