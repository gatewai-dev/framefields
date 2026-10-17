import type { RendererConfig } from "../config/index.js";
import type { HOST_KINDS } from "../config/schema.js";
import type { ErrorRule } from "./exec.js";

export type HostKind = (typeof HOST_KINDS)[number];

export interface HostProfile {
	kind: HostKind;
	/** HTTPS username to pair with a token; undefined means GIT_USERNAME is required. */
	defaultUsername?: string;
	/** Host-specific error rules, checked before the generic ones. */
	rules: ErrorRule[];
	lfsRules: ErrorRule[];
}

const KNOWN_HOSTS: Record<string, HostKind> = {
	"github.com": "github",
	"gitlab.com": "gitlab",
	"bitbucket.org": "bitbucket",
};

const PROFILES: Record<HostKind, Omit<HostProfile, "kind">> = {
	github: {
		defaultUsername: "x-access-token",
		rules: [
			{
				test: /SAML|organization has enabled or enforced SAML SSO/i,
				code: "GIT_AUTH_FAILED",
				hint: "Authorize the token for the organization's SAML SSO in GitHub settings.",
			},
		],
		lfsRules: [
			{
				test: /over its data quota|exceeded its LFS budget/i,
				code: "LFS_QUOTA_EXCEEDED",
				hint: "GitHub LFS bandwidth/storage is used up; buy a data pack or move LFS elsewhere.",
			},
		],
	},
	gitlab: {
		defaultUsername: "oauth2",
		rules: [],
		lfsRules: [
			{
				test: /LFS objects are not available|size limit|storage limit/i,
				code: "LFS_QUOTA_EXCEEDED",
				hint: "The GitLab project or namespace hit its storage limit.",
			},
		],
	},
	bitbucket: {
		defaultUsername: "x-token-auth",
		rules: [],
		lfsRules: [
			{
				test: /repository storage limit|over (the|its) .*limit/i,
				code: "LFS_QUOTA_EXCEEDED",
				hint: "The Bitbucket workspace hit its LFS storage limit.",
			},
		],
	},
	gitea: {
		rules: [],
		lfsRules: [
			{
				test: /LFS (is )?(not enabled|disabled)|\b404\b.*batch/i,
				code: "LFS_UNAVAILABLE",
				hint: "Enable LFS on the Gitea/Forgejo server (LFS_START_SERVER = true).",
			},
		],
	},
	generic: { rules: [], lfsRules: [] },
};

export function hostProfile(host: string, config: RendererConfig): HostProfile {
	const h = host.toLowerCase();
	const kind: HostKind = config.git.hosts[h] ?? KNOWN_HOSTS[h] ?? "generic";
	return { kind, ...PROFILES[kind] };
}
