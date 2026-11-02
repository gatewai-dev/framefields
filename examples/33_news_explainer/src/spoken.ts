/**
 * Text as it is spoken, for comparing a script with a transcript: the
 * transcriber writes "35,000" where the script says "thirty-five thousand",
 * and the script writes "2004" where the voice says "two thousand four".
 */

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = [
	"",
	"",
	"twenty",
	"thirty",
	"forty",
	"fifty",
	"sixty",
	"seventy",
	"eighty",
	"ninety",
];

function underThousand(n: number): string[] {
	const words: string[] = [];
	const hundreds = Math.floor(n / 100);
	const rest = n % 100;
	if (hundreds > 0) words.push(ONES[hundreds] ?? "", "hundred");
	if (rest >= 20) {
		words.push(TENS[Math.floor(rest / 10)] ?? "");
		if (rest % 10 > 0) words.push(ONES[rest % 10] ?? "");
	} else if (rest > 0 || words.length === 0) words.push(ONES[rest] ?? "");
	return words;
}

/** A whole number below a million, in words ("2004" → "two thousand four"). */
export function numberWords(n: number): string {
	if (!Number.isInteger(n) || n < 0 || n >= 1_000_000)
		throw new Error(`numberWords: ${n} is out of range`);
	const thousands = Math.floor(n / 1000);
	const rest = n % 1000;
	const words = thousands > 0 ? [...underThousand(thousands), "thousand"] : [];
	if (rest > 0 || thousands === 0) words.push(...underThousand(rest));
	return words.join(" ");
}

/**
 * Lowercase words with numbers spelled out, punctuation and hyphens gone, and
 * no "and" (said inside numbers, "three hundred and forty", or not).
 */
export function spokenWords(s: string): string {
	return s
		.toLowerCase()
		.replace(/(\d),(\d{3})/g, "$1$2")
		.replace(/\d+/g, (digits) => ` ${numberWords(Number(digits))} `)
		.replace(/[^a-z' ]/g, " ")
		.split(/\s+/)
		.filter((w) => w && w !== "and")
		.join(" ");
}
