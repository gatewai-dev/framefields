/**
 * Arabic in 2D: the sentence from the original bug report in Cairo (joined
 * letters, lam-alef, the shadda on its letter, "AI" and "2026" left to right
 * inside a right-to-left line), then a fully vowelled proverb in Naskh typed
 * out, its letters changing form as each next one arrives.
 */
import { Layer, LayerAnimation, TextAnimator } from "framefields";
import { ACCENT, CAIRO, INK, label, NASKH, PAPER, scene, W } from "../theme.js";

export const ARABIC_FRAMES = 165;

const HEADLINE = "الذكاء الاصطناعي AI هيغيّر شغلنا في 2026، بس لازم نتعلّم صح.";
const PROVERB = "اُطْلُبُوا الْعِلْمَ مِنَ الْمَهْدِ إِلَى اللَّحْدِ";

export function arabicScene() {
	return scene("arabic", PAPER, [
		Layer.text(HEADLINE, {
			id: "ar-headline",
			position: "absolute",
			x: 160,
			y: 150,
			width: W - 320,
			fontFamily: CAIRO,
			fontWeight: 700,
			fontSize: 100,
			lineHeight: 1.35,
			fill: INK,
			align: "center",
			animators: [TextAnimator.wordPop({ y: 30 })],
		}).animate(LayerAnimation.create().kineticSweep(-1, 1, 6, 66)),
		Layer.box({
			id: "ar-rule",
			position: "absolute",
			x: W / 2 - 120,
			y: 560,
			width: 240,
			height: 4,
			background: ACCENT,
			borderRadius: 2,
		}).animate(
			LayerAnimation.create().keys("opacity", [
				[50, 0],
				[70, 1, "power2.out"],
			]),
		),
		Layer.text(PROVERB, {
			id: "ar-proverb",
			position: "absolute",
			x: 160,
			y: 620,
			width: W - 320,
			fontFamily: NASKH,
			fontWeight: 500,
			fontSize: 88,
			fill: ACCENT,
			align: "center",
		}).animate(LayerAnimation.create().typewriter(70, 140)),
		label(
			"ar-label",
			"Arabic · Cairo and Noto Naskh Arabic · joining forms, lam-alef, vowel marks, right to left",
		),
	]);
}
