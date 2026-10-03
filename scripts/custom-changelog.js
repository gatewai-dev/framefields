const defaultChangelog = require("@changesets/cli/changelog").default;

module.exports = {
	getReleaseLine: defaultChangelog.getReleaseLine,
	// Returning an empty string prevents writing dependency-update entries to CHANGELOG.md
	getDependencyReleaseLine: async () => "",
};
