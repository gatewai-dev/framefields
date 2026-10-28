import type { RenderDiagnostic } from "@framefields/core";

export interface CheckDiagnostic extends RenderDiagnostic {
	stage:
		| "build"
		| "schema"
		| "assets"
		| "lint"
		| "timeline"
		| "render"
		| "worker";
	path?: string;
}

export interface CheckReport {
	schemaVersion: 1;
	sdkVersion: string;
	entry: string;
	exportName: string;
	status: "passed" | "failed";
	diagnostics: CheckDiagnostic[];
	artifacts: string[];
	render: "not_requested" | "skipped" | "passed" | "failed";
	runtime?: { node: string; platform: string; arch: string };
	timeline?: { fps: number; totalFrames: number; durationMs: number };
	backend?: {
		vendor: string;
		device: string;
		description: string;
		software: boolean;
	};
}

export function failedCheck(
	entry: string,
	exportName: string,
	sdkVersion: string,
	code: string,
	message: string,
): CheckReport {
	return {
		schemaVersion: 1,
		sdkVersion,
		entry,
		exportName,
		status: "failed",
		diagnostics: [{ severity: "error", code, message, stage: "worker" }],
		artifacts: [],
		render: "not_requested",
	};
}
