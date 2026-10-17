/**
 * Einheiten zur Auswahl (Angebote, Rechnungen, Tagesberichte). Die Liste kommt
 * aus den Stammdaten; gespeichert wird in den Positionen der Text.
 */

/** Gleiche Einheit in anderer Schreibweise („pauschal“) auf die aus den Stammdaten bringen */
export function canonicalUnit(units: readonly string[], value: string): string {
	const v = value.trim();
	return units.find((u) => u.toLowerCase() === v.toLowerCase()) ?? v;
}

/** Auswahl für ein Feld: die Stammdaten, dazu ein gespeicherter Wert, der dort (nicht mehr) steht */
export function unitChoices(units: readonly string[], current: string): string[] {
	const c = current.trim();
	return !c || units.includes(c) ? [...units] : [...units, c];
}
