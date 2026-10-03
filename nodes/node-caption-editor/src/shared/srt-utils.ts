export function getSrtDurationMs(srt: string): number {
	try {
		const matches = [...srt.matchAll(/(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)/g)];
		if (matches.length === 0) return 0;
		let maxMs = 0;
		for (const match of matches) {
			const ts = match[0].replace(",", ".");
			const parts = ts.split(":");
			if (parts.length === 3) {
				const [h, m, sMs] = parts;
				const secs = parseFloat(sMs);
				const ms =
					(parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + secs) * 1000;
				if (ms > maxMs) maxMs = ms;
			}
		}
		return maxMs;
	} catch (e) {
		return 0;
	}
}
