import { describe, expect, it } from "vitest";
import { isHostAllowed, isRepoAllowed, parseRepoUrl } from "./repo-url.js";

describe("parseRepoUrl", () => {
	it.each([
		["https://github.com/acme/films.git", "github.com/acme/films", "https"],
		[
			"https://gitlab.com/group/sub/films",
			"gitlab.com/group/sub/films",
			"https",
		],
		["git@github.com:acme/films.git", "github.com/acme/films", "ssh"],
		[
			"ssh://git@git.acme.dev:2222/acme/films.git",
			"git.acme.dev/acme/films",
			"ssh",
		],
		["https://bitbucket.org/acme/films/", "bitbucket.org/acme/films", "https"],
	])("%s → %s", (url, id, protocol) => {
		const repo = parseRepoUrl(url);
		expect(repo.id).toBe(id);
		expect(repo.protocol).toBe(protocol);
	});

	it("strips credentials from https URLs", () => {
		const repo = parseRepoUrl(
			"https://user:ghp_secret@github.com/acme/films.git",
		);
		expect(repo.url).toBe("https://github.com/acme/films.git");
	});

	it.each([
		"ext::sh -c touch% /tmp/pwned",
		"/srv/repos/films",
		"../films",
		"films",
	])("rejects %s", (url) => {
		expect(() => parseRepoUrl(url)).toThrow();
	});

	it("rejects file:// unless local repos are allowed", () => {
		expect(() => parseRepoUrl("file:///srv/films.git")).toThrow(
			/FF_ALLOW_LOCAL_REPOS/,
		);
		expect(
			parseRepoUrl("file:///srv/films.git", { allowLocal: true }).protocol,
		).toBe("file");
	});
});

describe("allowlist", () => {
	it("matches * within a segment and ** across segments", () => {
		expect(isRepoAllowed("github.com/acme/films", ["github.com/acme/*"])).toBe(
			true,
		);
		expect(isRepoAllowed("github.com/other/films", ["github.com/acme/*"])).toBe(
			false,
		);
		expect(
			isRepoAllowed("gitlab.com/acme/sub/films", ["gitlab.com/acme/*"]),
		).toBe(false);
		expect(
			isRepoAllowed("gitlab.com/acme/sub/films", ["gitlab.com/acme/**"]),
		).toBe(true);
	});

	it("is case-insensitive and anchored", () => {
		expect(
			isRepoAllowed("github.com/Acme/Films", ["github.com/acme/films"]),
		).toBe(true);
		expect(
			isRepoAllowed("evilgithub.com/acme/films", ["github.com/acme/*"]),
		).toBe(false);
		expect(
			isRepoAllowed("github.com/acme/films-fork", ["github.com/acme/films"]),
		).toBe(false);
	});

	it("checks hosts for credential answers", () => {
		expect(isHostAllowed("github.com", ["github.com/acme/*"])).toBe(true);
		expect(isHostAllowed("lfs-cdn.example.com", ["github.com/acme/*"])).toBe(
			false,
		);
	});
});
