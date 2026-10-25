import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "ChatThread",
	summary:
		"A messaging conversation: bubbles that spring in from either side, typing dots before replies, names, avatars, timestamps, reactions, images and auto-scroll.",
	tags: ["chat", "messages", "conversation", "social", "ui", "demo"],
	parts: [
		"viewport",
		"column",
		"bubble-<n>",
		"typing-<n>",
		"reaction-<n>",
		"avatar-<n>",
	],
	cues: ["messages", "typing"],
	example: `ChatThread({ messages: [{ from: "me", text: "Shipped?" }, { from: "sam", text: "Live!", reaction: "🎉" }] })`,
	since: "M5",
});
