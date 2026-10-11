import { describe, expect, it } from 'vitest';
import { areaActions, DEFAULT_PERMISSIONS, LOCKED, PERMISSION_AREAS, PERMISSIONS, ROLES, withImplied, type Permission } from './permissions';

const defaultsSet = () => {
	const set = new Set<string>();
	for (const p of PERMISSIONS) for (const r of DEFAULT_PERMISSIONS[p]) set.add(`${r}|${p}`);
	return set;
};

describe('Rechte-Katalog', () => {
	it('zeigt jedes Recht genau einmal auf der Seite', () => {
		const shown: Permission[] = PERMISSION_AREAS.flatMap((a) => [a.view.self, a.view.own, a.view.all, ...areaActions(a)].filter((p): p is Permission => !!p));
		expect(new Set(shown).size).toBe(shown.length);
		expect([...shown].sort()).toEqual([...PERMISSIONS].sort());
	});

	it('hat Standardrechte, die schon vollständig sind', () => {
		// Wer etwas darf, darf den Bereich auch sehen – in den Standards muss das schon stimmen
		const defaults = defaultsSet();
		expect([...withImplied(defaults)].sort()).toEqual([...defaults].sort());
	});

	it('lässt dem Admin die gesperrten Rechte', () => {
		for (const { role, permission } of LOCKED) expect(DEFAULT_PERMISSIONS[permission]).toContain(role);
		expect(ROLES).toContain('admin');
	});
});

describe('withImplied', () => {
	it('setzt „Sehen", sobald im Bereich etwas erlaubt ist', () => {
		const out = withImplied(new Set(['bauleiter|angebote.freigeben']));
		expect(out.has('bauleiter|angebote.sehen')).toBe(true);
	});

	it('nimmt bei Stufen die untere mit', () => {
		const out = withImplied(new Set(['arbeiter|tagesberichte.alle.sehen', 'arbeiter|angebote.loeschen']));
		expect(out.has('arbeiter|tagesberichte.sehen')).toBe(true);
		expect(out.has('arbeiter|angebote.loeschen.entwurf')).toBe(true);
		expect(out.has('arbeiter|angebote.sehen')).toBe(true);
	});

	it('nimmt bei drei Stufen beide unteren mit', () => {
		const out = withImplied(new Set(['arbeiter|stunden.alle.sehen']));
		expect(out.has('arbeiter|stunden.sehen')).toBe(true);
		expect(out.has('arbeiter|stunden.eigene.sehen')).toBe(true);
	});

	it('setzt über ein Recht im Bereich auch „nur eigene"', () => {
		const out = withImplied(new Set(['arbeiter|stunden.erstellen']));
		expect(out.has('arbeiter|stunden.sehen')).toBe(true);
		expect(out.has('arbeiter|stunden.eigene.sehen')).toBe(true);
	});

	it('lässt bei „nur eigene" die Partie weg', () => {
		const out = withImplied(new Set(['arbeiter|stunden.eigene.sehen']));
		expect(out.has('arbeiter|stunden.sehen')).toBe(false);
	});

	it('setzt bei Stufen die untere Sehen-Stufe, nicht „alle"', () => {
		const out = withImplied(new Set(['partiefuehrer|auftraege.status']));
		expect(out.has('partiefuehrer|auftraege.sehen')).toBe(true);
		expect(out.has('partiefuehrer|auftraege.alle.sehen')).toBe(false);
	});

	it('lässt andere Gruppen in Ruhe', () => {
		const out = withImplied(new Set(['viewer|kunden.loeschen']));
		expect([...out].every((k) => k.startsWith('viewer|'))).toBe(true);
	});

	it('Urlaub beantragen heißt nur die eigenen sehen, genehmigen alle', () => {
		const out = withImplied(new Set(['arbeiter|urlaub.beantragen', 'bauleiter|urlaub.genehmigen']));
		expect(out.has('arbeiter|urlaub.eigene.sehen')).toBe(true);
		expect(out.has('arbeiter|urlaub.sehen')).toBe(false);
		expect(out.has('bauleiter|urlaub.alle.sehen')).toBe(true);
		expect(out.has('bauleiter|urlaub.eigene.sehen')).toBe(true);
	});
});
