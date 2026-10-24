import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "DeviceFrame",
	summary:
		"A phone, tablet or laptop around a screen; content is authored in device points and `at(x, y)` maps them for pointers and touches.",
	tags: [
		"device",
		"phone",
		"mobile",
		"tablet",
		"laptop",
		"mockup",
		"screen",
		"app",
	],
	parts: [
		"body",
		"bezel",
		"screen",
		"content",
		"island",
		"status",
		"buttons",
		"base",
		"shadow",
		"tilt",
	],
	cues: [],
	example: `DeviceFrame({ device: "phone", content: "assets/app.mp4" })`,
	since: "M8",
});
