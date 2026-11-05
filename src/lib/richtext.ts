/**
 * Einfache Hervorhebungen in Texten wie dem Schlusstext: **fett** und
 * __unterstrichen__, auch zusammen (**__beides__**). Gespeichert wird der Text
 * mit den Zeichen; Ansicht und PDF machen daraus die Schrift.
 */

export interface RichSegment {
	text: string;
	bold: boolean;
	underline: boolean;
}

const MARK = /(\*\*|__)/;

/**
 * Eine Zeile in Abschnitte zerlegen. Ein Zeichenpaar ohne Gegenstück bleibt
 * stehen, wie es ist – so verschwindet nichts, was jemand absichtlich tippt.
 */
export function parseRichLine(line: string): RichSegment[] {
	const parts = line.split(MARK);
	// Welche Zeichenpaare ein Gegenstück haben: von vorn nach hinten paaren. Wie
	// beim Schreiben üblich öffnet ein Paar nur vor einem Zeichen („**fett") und
	// schließt nur nach einem („fett**") – „5 ** 3" bleibt Text.
	const paired = new Set<number>();
	const open: Record<string, number | undefined> = {};
	const nonSpaceAfter = (i: number) => /^\S/.test(parts[i + 1] ?? '') || ((parts[i + 1] ?? '') === '' && MARK.test(parts[i + 2] ?? ''));
	const nonSpaceBefore = (i: number) => /\S$/.test(parts[i - 1] ?? '') || ((parts[i - 1] ?? '') === '' && MARK.test(parts[i - 2] ?? ''));
	parts.forEach((p, i) => {
		if (p !== '**' && p !== '__') return;
		const at = open[p];
		if (at === undefined) {
			if (nonSpaceAfter(i)) open[p] = i;
		} else if (!nonSpaceBefore(i)) {
			// Kein Schluss – vielleicht ein neuer Anfang
			if (nonSpaceAfter(i)) open[p] = i;
		} else {
			paired.add(at);
			paired.add(i);
			open[p] = undefined;
		}
	});
	const out: RichSegment[] = [];
	let bold = false;
	let underline = false;
	parts.forEach((p, i) => {
		if (paired.has(i)) {
			if (p === '**') bold = !bold;
			else underline = !underline;
			return;
		}
		if (!p) return;
		const last = out.at(-1);
		if (last && last.bold === bold && last.underline === underline) last.text += p;
		else out.push({ text: p, bold, underline });
	});
	return out;
}

/** Der ganze Text, Zeile für Zeile */
export function parseRich(text: string): RichSegment[][] {
	return text.split(/\r?\n/).map(parseRichLine);
}

/** Ohne die Zeichen – etwa für die E-Rechnung oder eine Vorschau */
export function plainRich(text: string): string {
	return parseRich(text)
		.map((line) => line.map((s) => s.text).join(''))
		.join('\n');
}

/**
 * Die Auswahl in `value` von `start` bis `end` mit `mark` einschließen – oder,
 * wenn sie schon eingeschlossen ist, die Zeichen wieder entfernen. Ohne Auswahl
 * kommen die Zeichen an die Schreibmarke, dazwischen geht es weiter.
 */
export function toggleMark(value: string, start: number, end: number, mark: '**' | '__'): { value: string; start: number; end: number } {
	const n = mark.length;
	// Leerzeichen am Rand der Auswahl bleiben draußen – „**fett **" wäre keine Hervorhebung
	while (start < end && /\s/.test(value[start])) start++;
	while (end > start && /\s/.test(value[end - 1])) end--;
	const selected = value.slice(start, end);
	if (start >= n && value.slice(start - n, start) === mark && value.slice(end, end + n) === mark) {
		return {
			value: value.slice(0, start - n) + selected + value.slice(end + n),
			start: start - n,
			end: end - n
		};
	}
	if (selected.length >= 2 * n && selected.startsWith(mark) && selected.endsWith(mark)) {
		const inner = selected.slice(n, -n);
		return {
			value: value.slice(0, start) + inner + value.slice(end),
			start,
			end: start + inner.length
		};
	}
	return {
		value: value.slice(0, start) + mark + selected + mark + value.slice(end),
		start: start + n,
		end: end + n
	};
}
