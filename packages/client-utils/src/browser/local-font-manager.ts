/**
 * Singleton font loader
 */
class LocalFontManager {
	private static instance: LocalFontManager | null = null;
	private loadedFonts: Set<string> = new Set();

	private constructor() {}

	public static getInstance(): LocalFontManager {
		if (!LocalFontManager.instance) {
			LocalFontManager.instance = new LocalFontManager();
		}
		return LocalFontManager.instance;
	}

	public async loadFont(family: string, url: string): Promise<void> {
		if (this.loadedFonts.has(family)) return;

		const fontId = `local-font-${family}`;
		if (document.getElementById(fontId)) return;

		const style = document.createElement("style");
		style.id = fontId;
		style.innerHTML = `
			@font-face {
            	font-family: "${family}";
            	src: url("${url}");
			}
        `;
		document.head.appendChild(style);

		try {
			await document.fonts.load(`1em "${family}"`);
			await document.fonts.ready;
			this.loadedFonts.add(family);
		} catch (e) {
			console.warn(`Font load failed for ${family}:`, e);
		}
	}

	public isFontLoaded(family: string): boolean {
		return this.loadedFonts.has(family);
	}
}

export const localFontManager = LocalFontManager.getInstance();
export const registerFont = (family: string, url: string) =>
	localFontManager.loadFont(family, url);
export const isFontLoaded = (family: string) =>
	localFontManager.isFontLoaded(family);
export { LocalFontManager };
