/**
 * Stunden je Kostenstelle über alle Partien. Gezählt wird, was gearbeitet
 * wurde: Norm + Überstunden 50 % + 100 % – Urlaub, Feiertag, Regen und
 * Krankenstand nicht. Die Kostenstellen kommen aus dem, was in den
 * Stundenzetteln steht; eine Liste pflegt niemand. Schreibweisen wie
 * „24117 ", „24 117" und „24117 / Halle 3" vs. „24117/Halle 3" fallen zusammen.
 */

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Schlüssel zum Zusammenfassen: ohne überzählige Leerzeichen, Ziffern ohne Abstand, Groß/klein egal */
export function costCenterKey(value: string | null | undefined): string {
	return String(value ?? '')
		.trim()
		.replace(/\s*\/\s*/g, '/')
		.replace(/(\d)\s+(?=\d)/g, '$1')
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

/** Ein Tag eines Stundenzettels */
export interface CostCenterDay {
	costCenter: string;
	date: string;
	normal: number;
	o50: number;
	o100: number;
	userId: number;
	/** Die Partie, die den Zettel schreibt – leer: ohne Partie */
	party: string | null;
}

export interface CostCenterSum {
	/** Leer: Stunden ohne eingetragene Kostenstelle */
	key: string;
	/** Die häufigste Schreibweise */
	label: string;
	normal: number;
	o50: number;
	o100: number;
	total: number;
	/** An wie vielen Tagen und von wie vielen Personen */
	days: number;
	people: number;
	first: string;
	last: string;
	/** Je Partie die Stunden, die meisten zuerst */
	parties: { name: string; hours: number }[];
}

/** Zusammenfassen – sortiert nach Kostenstelle (Zahlen der Größe nach), ohne Kostenstelle am Ende */
export function sumByCostCenter(rows: readonly CostCenterDay[]): CostCenterSum[] {
	const groups = new Map<string, { spellings: Map<string, number>; rows: CostCenterDay[] }>();
	for (const r of rows) {
		const key = costCenterKey(r.costCenter);
		const g = groups.get(key) ?? { spellings: new Map<string, number>(), rows: [] as CostCenterDay[] };
		const spelling = r.costCenter.trim().replace(/\s+/g, ' ');
		g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
		g.rows.push(r);
		groups.set(key, g);
	}
	const out: CostCenterSum[] = [];
	for (const [key, g] of groups) {
		// Gleich oft: die kürzere (ohne Leerzeichen in der Nummer)
		const label = [...g.spellings].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], 'de'))[0][0];
		const sum = (f: (r: CostCenterDay) => number) => round2(g.rows.reduce((s, r) => s + f(r), 0));
		const byParty = new Map<string, number>();
		for (const r of g.rows) byParty.set(r.party ?? '', (byParty.get(r.party ?? '') ?? 0) + r.normal + r.o50 + r.o100);
		const dates = g.rows.map((r) => r.date).sort();
		out.push({
			key,
			label,
			normal: sum((r) => r.normal),
			o50: sum((r) => r.o50),
			o100: sum((r) => r.o100),
			total: sum((r) => r.normal + r.o50 + r.o100),
			days: new Set(dates).size,
			people: new Set(g.rows.map((r) => r.userId)).size,
			first: dates[0],
			last: dates[dates.length - 1],
			parties: [...byParty]
				.map(([name, hours]) => ({ name, hours: round2(hours) }))
				.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'de'))
		});
	}
	return out.sort((a, b) => (!a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label, 'de', { numeric: true })));
}
