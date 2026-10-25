/**
 * How a grapheme presents, after Unicode's emoji presentation rules
 * (UTS #51): as a color emoji, as text, or as text when the text font has
 * the glyph. Layout and the emoji preload use it, and so does the
 * `missing_emoji_font` lint, so they agree on which characters need the
 * color emoji font.
 */

/** Default emoji presentation (✅ ⚡ 🚀), a skin tone, or a keycap. */
const EMOJI_STYLE = /\p{Emoji_Presentation}|\p{Emoji_Modifier}|⃣/u;
/** Pictographs that can be emoji (❤ ✈ © ™ ✔): emoji only when asked for. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** A pictograph followed by VS16 asks for emoji presentation (❤️). */
const VS16_AFTER_PICTOGRAPH = /\p{Extended_Pictographic}️/u;
const VS15 = "︎";
const ZWJ = "‍";

/**
 * `"emoji"`: draw from the color emoji font. `"text"`: draw from the text
 * font (✓ ★ ❯, letters). `"either"`: a pictograph that defaults to text
 * (❤ ✈ ☀ © ™ without VS16), drawn from the text font when it has the glyph
 * and from the emoji font when it doesn't, as browsers fall back.
 */
export type EmojiPresentation = "emoji" | "text" | "either";

export function emojiPresentation(grapheme: string): EmojiPresentation {
	if (grapheme.includes(VS15)) return "text";
	if (
		EMOJI_STYLE.test(grapheme) ||
		VS16_AFTER_PICTOGRAPH.test(grapheme) ||
		(grapheme.includes(ZWJ) && PICTOGRAPHIC.test(grapheme))
	)
		return "emoji";
	return PICTOGRAPHIC.test(grapheme) ? "either" : "text";
}
