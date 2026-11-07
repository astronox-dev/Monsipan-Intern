import { describe, expect, it } from 'vitest';
import { merge3 } from './merge';

const row = (uid: string, text = uid, qty = '') => ({ uid, text, qty });

describe('merge3: Felder', () => {
	it('nimmt die Änderung der Seite, die geändert hat', () => {
		const base = { title: 'A', note: 'x' };
		expect(merge3(base, { title: 'B', note: 'x' }, { title: 'A', note: 'y' })).toEqual({ title: 'B', note: 'y' });
	});

	it('bei Streit um dasselbe Feld gilt das eigene', () => {
		expect(merge3({ t: 'A' }, { t: 'mein' }, { t: 'fremd' })).toEqual({ t: 'mein' });
	});

	it('ohne eigene Änderung kommt alles von drüben', () => {
		const base = { a: 1, lines: [row('1')] };
		const remote = { a: 2, lines: [row('1', 'neu')] };
		expect(merge3(base, structuredClone(base), remote)).toEqual(remote);
	});
});

describe('merge3: Zeilen', () => {
	const base = [row('a'), row('b'), row('c')];

	it('Zeile für Zeile – verschiedene Zeilen geändert', () => {
		const local = [row('a', 'A!'), row('b'), row('c')];
		const remote = [row('a'), row('b'), row('c', 'C!')];
		expect(merge3(base, local, remote)).toEqual([row('a', 'A!'), row('b'), row('c', 'C!')]);
	});

	it('dieselbe Zeile, verschiedene Felder', () => {
		const local = [row('a', 'Text neu'), row('b'), row('c')];
		const remote = [row('a', 'a', '5'), row('b'), row('c')];
		expect(merge3(base, local, remote)).toEqual([row('a', 'Text neu', '5'), row('b'), row('c')]);
	});

	it('neue Zeilen beider Seiten bleiben an ihrer Stelle', () => {
		const local = [row('a'), row('x'), row('b'), row('c')];
		const remote = [row('a'), row('b'), row('c'), row('y')];
		expect(merge3(base, local, remote).map((r) => r.uid)).toEqual(['a', 'x', 'b', 'c', 'y']);
	});

	it('drüben gelöscht – fällt hier weg, außer hier geändert', () => {
		expect(merge3(base, [row('a'), row('b'), row('c')], [row('a'), row('c')]).map((r) => r.uid)).toEqual(['a', 'c']);
		expect(merge3(base, [row('a'), row('b', 'geändert'), row('c')], [row('a'), row('c')]).map((r) => r.uid)).toEqual(['a', 'b', 'c']);
	});

	it('hier gelöscht, drüben unverändert – bleibt weg', () => {
		expect(merge3(base, [row('a'), row('c')], [row('a'), row('b'), row('c', 'C!')]).map((r) => r.text)).toEqual(['a', 'C!']);
	});

	it('verschoben wird wie die Seite, die verschoben hat', () => {
		const local = [row('c'), row('a'), row('b')];
		const remote = [row('a'), row('b', 'B!'), row('c'), row('d')];
		expect(merge3(base, local, remote).map((r) => r.text)).toEqual(['c', 'a', 'B!', 'd']);
	});

	it('eine leere neue Zeile, die der Server (noch) nicht kennt, bleibt', () => {
		const local = [row('a'), row('b'), row('c'), row('neu', '')];
		expect(merge3(base, local, base).map((r) => r.uid)).toEqual(['a', 'b', 'c', 'neu']);
		// … auch wenn drüben inzwischen etwas anderes geändert wurde
		expect(merge3(base, local, [row('a', 'A!'), row('b'), row('c')]).map((r) => r.uid)).toEqual(['a', 'b', 'c', 'neu']);
	});
});
