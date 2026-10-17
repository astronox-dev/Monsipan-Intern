import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { categories, colors, locations, parties, units } from './db/schema';

/** Auswahllisten für Formulare und Filter */
export async function locationOptions(onlyActive = true) {
	const q = db.select({ id: locations.id, name: locations.name, active: locations.active }).from(locations);
	return (onlyActive ? q.where(eq(locations.active, true)) : q).orderBy(asc(locations.sortOrder), asc(locations.name)).all();
}

export async function categoryOptions() {
	return db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
}

export async function colorOptions() {
	return db
		.select({ id: colors.id, name: colors.name, ral: colors.ral, hex: colors.hex })
		.from(colors)
		.orderBy(asc(colors.sortOrder), asc(colors.name))
		.all();
}

export async function partyOptions(onlyActive = true) {
	const q = db.select({ id: parties.id, name: parties.name, kind: parties.kind }).from(parties);
	return (onlyActive ? q.where(eq(parties.active, true)) : q).orderBy(asc(parties.name)).all();
}

/** Einheiten aus den Stammdaten, in ihrer Reihenfolge */
export async function unitOptions(): Promise<string[]> {
	const rows = await db.select({ name: units.name }).from(units).orderBy(asc(units.sortOrder), asc(units.name)).all();
	return rows.map((r) => r.name);
}
