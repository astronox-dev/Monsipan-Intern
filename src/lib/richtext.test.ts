import { describe, expect, it } from 'vitest';
import { parseRich, parseRichLine, plainRich, toggleMark } from './richtext';

const seg = (text: string, bold = false, underline = false) => ({
	text,
	bold,
	underline
});

describe('parseRichLine', () => {
	it('erkennt fett und unterstrichen', () => {
		expect(parseRichLine('Bitte **bis Freitag** __unterschreiben__.')).toEqual([
			seg('Bitte '),
			seg('bis Freitag', true),
			seg(' '),
			seg('unterschreiben', false, true),
			seg('.')
		]);
	});

	it('beides zusammen', () => {
		expect(parseRichLine('**__wichtig__** sonst')).toEqual([seg('wichtig', true, true), seg(' sonst')]);
	});

	it('lässt Zeichen ohne Gegenstück stehen', () => {
		expect(parseRichLine('5 ** 3 und **fett**')).toEqual([seg('5 ** 3 und '), seg('fett', true)]);
		expect(parseRichLine('datei__neu')).toEqual([seg('datei__neu')]);
	});

	it('ohne Hervorhebung bleibt alles ein Abschnitt', () => {
		expect(parseRichLine('Mit freundlichen Grüßen')).toEqual([seg('Mit freundlichen Grüßen')]);
		expect(parseRichLine('')).toEqual([]);
	});
});

describe('parseRich / plainRich', () => {
	it('zerlegt Zeile für Zeile', () => {
		expect(parseRich('**A**\n\nB')).toEqual([[seg('A', true)], [], [seg('B')]]);
	});

	it('entfernt die Zeichen', () => {
		expect(plainRich('Bitte **bis Freitag**\n__zahlen__')).toBe('Bitte bis Freitag\nzahlen');
	});
});

describe('toggleMark', () => {
	it('schließt die Auswahl ein', () => {
		expect(toggleMark('Bitte zahlen', 6, 12, '**')).toEqual({
			value: 'Bitte **zahlen**',
			start: 8,
			end: 14
		});
	});

	it('lässt Leerzeichen am Rand draußen', () => {
		expect(toggleMark('Bitte zahlen ', 5, 13, '__')).toEqual({
			value: 'Bitte __zahlen__ ',
			start: 8,
			end: 14
		});
	});

	it('nimmt die Hervorhebung wieder weg', () => {
		expect(toggleMark('Bitte **zahlen**', 8, 14, '**')).toEqual({
			value: 'Bitte zahlen',
			start: 6,
			end: 12
		});
		expect(toggleMark('Bitte **zahlen**', 6, 16, '**')).toEqual({
			value: 'Bitte zahlen',
			start: 6,
			end: 12
		});
	});

	it('ohne Auswahl: Zeichen an die Schreibmarke', () => {
		expect(toggleMark('ab', 1, 1, '**')).toEqual({
			value: 'a****b',
			start: 3,
			end: 3
		});
	});
});
