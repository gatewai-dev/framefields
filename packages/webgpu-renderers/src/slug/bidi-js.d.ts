declare module "bidi-js" {
	interface EmbeddingLevels {
		levels: Uint8Array;
		paragraphs: Array<{ start: number; end: number; level: number }>;
	}
	interface Bidi {
		getEmbeddingLevels(
			text: string,
			explicitDirection?: "ltr" | "rtl",
		): EmbeddingLevels;
		getReorderSegments(
			text: string,
			embeddingLevels: EmbeddingLevels,
			start?: number,
			end?: number,
		): Array<[number, number]>;
		getMirroredCharacter(char: string): string | null;
		getBidiCharTypeName(char: string): string;
	}
	export default function bidiFactory(): Bidi;
}
