import pkg from "../../../package.json" with { type: "json" };

/**
 * App version read from the monorepo root package.json.
 * Used for version-aware render fingerprinting.
 */
export const APP_VERSION = pkg.version ?? "unknown";
