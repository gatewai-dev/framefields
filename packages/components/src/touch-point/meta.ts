import { defineMeta } from "../core/meta.js";

export default defineMeta({
	name: "TouchPoint",
	summary:
		"Fingers on glass: taps, double taps, long presses and swipes as soft discs with ripples, for mobile demos in a DeviceFrame.",
	tags: ["touch", "tap", "swipe", "mobile", "gesture", "demo", "phone"],
	parts: ["touch-<n>", "touch-<n>-ripple-<k>", "touch-<n>-trail-<k>"],
	cues: ["taps", "presses", "swipes", "touches"],
	example: `TouchPoint({ touches: [{ to: phone.at(196, 700) }, { to: phone.at(196, 600), swipe: phone.at(196, 200) }] })`,
	since: "M8",
});
