/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

export const SAM_LICENSE_TERMS_URL =
	"https://github.com/facebookresearch/sam3/blob/main/LICENSE";

export interface SamLicenseOptions {
	/** Explicitly agree to Meta's SAM License terms to download or run SAM models. */
	readonly acceptLicense?: boolean;
}

/**
 * Ensures that the user has explicitly accepted Meta's SAM License terms before
 * downloading model weights or performing inference.
 */
export function assertSamLicenseAccepted(
	context = "Segment Anything Model (SAM)",
	options?: SamLicenseOptions,
): void {
	if (options?.acceptLicense) return;
	if (
		typeof process !== "undefined" &&
		process.env?.FRAMEFIELDS_ACCEPT_SAM_LICENSE === "1"
	)
		return;

	throw new Error(
		`Meta SAM License agreement required for ${context}:\n` +
			`Segment Anything Model (SAM 2 / SAM 3) code and weights are subject to Meta's SAM License.\n` +
			`Review terms at: ${SAM_LICENSE_TERMS_URL}\n` +
			`To download and run SAM models in Framefields, you must explicitly accept the terms by:\n` +
			`  1. Passing 'acceptLicense: true' (or 'acceptSamLicense: true' in ClipVision options), or\n` +
			`  2. Setting the environment variable FRAMEFIELDS_ACCEPT_SAM_LICENSE=1.`,
	);
}
