export const SAM_LICENSE_TERMS_URL =
	"https://github.com/facebookresearch/sam3/blob/main/LICENSE";

export interface SamLicenseOptions {
	/** Explicitly agree to Meta's SAM License terms to download or run SAM 3 models. */
	readonly acceptLicense?: boolean;
}

/**
 * Ensures that the user has explicitly accepted Meta's SAM License terms before
 * downloading SAM 3 weights or performing inference. SAM 2.1's weights are Apache-2.0 and
 * need no acceptance.
 */
export function assertSamLicenseAccepted(
	context = "SAM 3",
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
			`SAM 3's model weights are subject to Meta's SAM License.\n` +
			`Review terms at: ${SAM_LICENSE_TERMS_URL}\n` +
			`To download and run SAM 3 in Framefields, you must explicitly accept the terms by:\n` +
			`  1. Passing 'acceptLicense: true' (or 'acceptSamLicense: true' in ClipVision options), or\n` +
			`  2. Setting the environment variable FRAMEFIELDS_ACCEPT_SAM_LICENSE=1.`,
	);
}
