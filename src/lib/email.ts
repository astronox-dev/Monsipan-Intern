/**
 * E-Mail-Adressen prüfen – auch mit Umlauten (jürgen@müller.at). Die
 * Browser-Prüfung von type="email" und z.email() lassen nur ASCII zu; darum
 * nehmen die Felder type="text" mit inputmode="email" und hier wird geprüft.
 */

/** Etwas vor dem @, danach ein Name mit mindestens einem Punkt – Buchstaben jeder Sprache */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"._-][^\s@<>()[\]\\,;:"]*\.[^\s@<>()[\]\\,;:".]{2,}$/u;

/** Einheitlich speichern: ohne Leerzeichen am Rand, Umlaute in einer Form (NFC) */
export function normalizeEmail(s: string): string {
	return s.trim().normalize('NFC');
}

export function isEmail(s: string): boolean {
	const v = normalizeEmail(s);
	return v.length <= 254 && EMAIL.test(v) && !v.includes('..');
}
