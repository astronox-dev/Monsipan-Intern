import { describe, expect, it } from 'vitest';
import { isEmail, normalizeEmail } from './email';

describe('isEmail', () => {
	it('nimmt Adressen mit Umlauten', () => {
		expect(isEmail('jürgen@firma.at')).toBe(true);
		expect(isEmail('office@müller-bau.at')).toBe(true);
		expect(isEmail('Hans.Groß@straßenbau.de')).toBe(true);
	});

	it('nimmt gewöhnliche Adressen', () => {
		expect(isEmail('office@monsipan.com')).toBe(true);
		expect(isEmail('a.b+c@sub.example.co.at')).toBe(true);
	});

	it('lehnt Unsinn ab', () => {
		for (const v of ['', 'jürgen', 'jürgen@', '@firma.at', 'jürgen@firma', 'jü rgen@firma.at', 'a@@b.at', 'a@b..at', 'a@.b.at', 'a@b.a']) {
			expect(isEmail(v), v).toBe(false);
		}
	});

	it('speichert Umlaute einheitlich', () => {
		// „ü" als u + Trema (so kommt es manchmal vom Mac) wird zu einem Zeichen
		expect(normalizeEmail(' ju\u0308rgen@firma.at ')).toBe('jürgen@firma.at');
		expect(isEmail('ju\u0308rgen@firma.at')).toBe(true);
	});
});
