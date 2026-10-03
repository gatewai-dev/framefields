/**
 * Utility to safely access environment variables in the browser.
 * Prioritizes runtime values injected via /env.js over build-time VITE_ variables.
 */

declare global {
	interface Window {
		GATEWAI_ENV?: {
			BASE_URL?: string;
			DISABLE_EMAIL_SIGNUP?: boolean;
			ENABLE_PRICING?: boolean;
			GOOGLE_AUTH_ENABLED?: boolean;
			APPLE_AUTH_ENABLED?: boolean;
			EMAIL_PSW_AUTH_ENABLED?: boolean;
			R2_CUSTOM_DOMAIN?: string;
		};
	}
}

export function getEnv(
	key: keyof NonNullable<Window["GATEWAI_ENV"]>,
): string | boolean | undefined {
	// 1. Try runtime environment (injected via /env.js)
	if (
		typeof window !== "undefined" &&
		window.GATEWAI_ENV &&
		window.GATEWAI_ENV[key] !== undefined
	) {
		return window.GATEWAI_ENV[key];
	}

	// 3. Fallback to process.env (webpack server-side rendering)
	try {
		if (typeof process !== "undefined" && process && process.env) {
			const val = process.env[key];
			if (val !== undefined) {
				return val;
			}
		}
	} catch {}

	return undefined;
}
