/**
 * Krankenstand: melden mit von – bis (ohne Ende: „noch krank") und der
 * Krankmeldung als Foto oder PDF. Jeder meldet sich selbst; wer die eigene
 * Partie bzw. alle sieht, kann auch für diese melden.
 *
 * Die Belege sehen nur die Person selbst, wer gemeldet hat, und wer alle
 * Krankenstände sieht (das Büro).
 */
import fs from 'node:fs';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { col } from '$lib/server/db/sql';
import { parties, sickDocuments, sickReports, users } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { fullName } from '$lib/format';
import { isValidIsoDate } from '$lib/modules/stunden/week';
import { overlaps, rangeLabel } from '../days';
import { belegFile, BelegError, storeBeleg } from './belege';

export const MAX_BELEGE = 10;

const reporter = alias(users, 'reporter');
const activeUser = and(eq(users.active, true), isNull(users.deletedAt));

export type Scope = 'self' | 'party' | 'all';

export function sickScope(user: Pick<SessionUser, 'role' | 'partyId'>): Scope | null {
	if (can(user.role, 'krankenstand.alle.sehen')) return 'all';
	if (can(user.role, 'krankenstand.sehen') && user.partyId) return 'party';
	if (can(user.role, 'krankenstand.eigene.sehen')) return 'self';
	return null;
}

function scopeWhere(user: SessionUser): SQL | undefined {
	const scope = sickScope(user);
	if (scope === 'all') return undefined;
	if (scope === 'party') return or(eq(users.partyId, user.partyId!), eq(sickReports.userId, user.id));
	return eq(sickReports.userId, user.id);
}

const seesDocs = (user: SessionUser, r: { userId: number; createdBy: number | null }) =>
	r.userId === user.id || r.createdBy === user.id || can(user.role, 'krankenstand.alle.sehen');

export const mayEditSick = (user: SessionUser, r: { userId: number; createdBy: number | null }) =>
	r.userId === user.id || r.createdBy === user.id || can(user.role, 'krankenstand.bearbeiten');

/** Krankenstände eines Jahres – so weit sichtbar; laufende zuerst */
export async function listSick(user: SessionUser, year: number) {
	const rows = await db
		.select({
			id: sickReports.id,
			userId: sickReports.userId,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username,
			partyName: parties.name,
			from: sickReports.from,
			to: sickReports.to,
			note: sickReports.note,
			createdAt: sickReports.createdAt,
			createdBy: sickReports.createdBy,
			reporterFirst: reporter.firstName,
			reporterLast: reporter.lastName
		})
		.from(sickReports)
		.innerJoin(users, eq(users.id, sickReports.userId))
		.leftJoin(parties, eq(parties.id, users.partyId))
		.leftJoin(reporter, eq(reporter.id, sickReports.createdBy))
		.where(and(scopeWhere(user), lte(sickReports.from, `${year}-12-31`), or(isNull(sickReports.to), gte(sickReports.to, `${year}-01-01`))))
		.orderBy(sql`case when ${sickReports.to} is null then 0 else 1 end`, desc(sickReports.from), desc(sickReports.id))
		.all();
	const ids = rows.map((r) => r.id);
	const docs = ids.length
		? await db
				.select({
					id: sickDocuments.id,
					reportId: sickDocuments.reportId,
					kind: sickDocuments.kind,
					fileName: sickDocuments.fileName,
					size: sickDocuments.size
				})
				.from(sickDocuments)
				.where(inArray(sickDocuments.reportId, ids))
				.orderBy(asc(sickDocuments.id))
				.all()
		: [];
	return rows.map(({ firstName, lastName, username, reporterFirst, reporterLast, ...r }) => {
		const mine = docs.filter((d) => d.reportId === r.id);
		const visible = seesDocs(user, r);
		return {
			...r,
			name: fullName({ firstName, lastName, username }),
			reportedBy: r.createdBy === r.userId ? '' : fullName({ firstName: reporterFirst, lastName: reporterLast }),
			docCount: mine.length,
			docs: visible ? mine.map(({ reportId: _, ...d }) => d) : [],
			canEdit: mayEditSick(user, r)
		};
	});
}

export type SickRow = Awaited<ReturnType<typeof listSick>>[number];

/** Für wen gemeldet werden kann: man selbst, die eigene Partie bzw. alle */
export async function sickPeople(user: SessionUser) {
	const scope = sickScope(user);
	if (scope !== 'all' && scope !== 'party') return [];
	const rows = await db
		.select({
			id: users.id,
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username,
			partyName: parties.name
		})
		.from(users)
		.leftJoin(parties, eq(parties.id, users.partyId))
		.where(and(activeUser, ne(users.role, 'viewer'), scope === 'party' ? or(eq(users.partyId, user.partyId!), eq(users.id, user.id)) : undefined))
		.orderBy(asc(users.firstName), asc(users.lastName))
		.all();
	return rows.map((r) => ({
		id: r.id,
		name: fullName(r),
		partyName: r.partyName
	}));
}

export interface SickInput {
	userId: number;
	from: string;
	to: string | null;
	note: string;
}

export function readSick(form: FormData, user: SessionUser): SickInput | { message: string } {
	const from = String(form.get('von') ?? '');
	const rawTo = String(form.get('bis') ?? '');
	if (!isValidIsoDate(from)) return { message: 'Bitte eintragen, seit wann.' };
	if (rawTo && !isValidIsoDate(rawTo)) return { message: '„Bis" ist kein gültiges Datum.' };
	if (rawTo && rawTo < from) return { message: '„Bis" liegt vor „von".' };
	const person = Number(form.get('person'));
	return {
		userId: Number.isInteger(person) && person > 0 ? person : user.id,
		from,
		to: rawTo || null,
		note: String(form.get('notiz') ?? '')
			.trim()
			.slice(0, 500)
	};
}

async function mayReportFor(user: SessionUser, personId: number): Promise<{ partyId: number | null } | { message: string }> {
	if (!can(user.role, 'krankenstand.melden')) return { message: 'Dafür fehlt dir die Berechtigung.' };
	const person = await db
		.select({ id: users.id, partyId: users.partyId })
		.from(users)
		.where(and(activeUser, eq(users.id, personId)))
		.get();
	if (!person) return { message: 'Diese Person gibt es nicht (mehr).' };
	if (person.id === user.id) return person;
	const scope = sickScope(user);
	if (scope === 'all' || (scope === 'party' && person.partyId === user.partyId)) return person;
	return { message: 'Für diese Person kannst du keinen Krankenstand melden.' };
}

/** Belege speichern – Fehler bei einer Datei brechen alles ab, bevor etwas in der Datenbank steht */
async function storeAll(files: File[]) {
	const out: {
		sha256: string;
		kind: 'jpg' | 'pdf';
		size: number;
		fileName: string;
	}[] = [];
	for (const f of files.slice(0, MAX_BELEGE)) out.push({ ...(await storeBeleg(f)), fileName: f.name.slice(0, 200) });
	return out;
}

export async function createSick(user: SessionUser, input: SickInput, files: File[]): Promise<number | { message: string }> {
	const person = await mayReportFor(user, input.userId);
	if ('message' in person) return person;
	const existing = await db.select({ from: sickReports.from, to: sickReports.to }).from(sickReports).where(eq(sickReports.userId, input.userId)).all();
	const clash = existing.find((e) => overlaps(e.from, e.to, input.from, input.to));
	if (clash)
		return {
			message: `Für ${clash.to ? rangeLabel(clash.from, clash.to) : `ab ${rangeLabel(clash.from, null)}`} ist schon ein Krankenstand gemeldet – dort ergänzen.`
		};
	let stored: Awaited<ReturnType<typeof storeAll>>;
	try {
		stored = await storeAll(files);
	} catch (err) {
		if (err instanceof BelegError) return { message: err.message };
		throw err;
	}
	const id = await db.transaction(async (tx) => {
		const row = await tx
			.insert(sickReports)
			.values({ ...input, createdBy: user.id, updatedAt: new Date() })
			.returning({ id: sickReports.id })
			.get();
		for (const s of stored) await tx.insert(sickDocuments).values({ reportId: row.id, ...s, createdBy: user.id });
		return row.id;
	});
	const who = await db
		.select({
			firstName: users.firstName,
			lastName: users.lastName,
			username: users.username
		})
		.from(users)
		.where(eq(users.id, input.userId))
		.get();
	notify({
		event: 'krankenstand.gemeldet',
		title: `Krankenstand: ${who ? fullName(who) : ''}`,
		body: [
			input.to ? rangeLabel(input.from, input.to) : `seit ${rangeLabel(input.from, null)}`,
			stored.length ? 'mit Krankmeldung' : 'Krankmeldung folgt'
		].join(' · '),
		url: '/krankenstand',
		partyId: person.partyId,
		actorId: user.id
	});
	return id;
}

async function sickById(id: number) {
	return db
		.select({
			id: sickReports.id,
			userId: sickReports.userId,
			createdBy: sickReports.createdBy,
			from: sickReports.from
		})
		.from(sickReports)
		.where(eq(sickReports.id, id))
		.get();
}

/** Ende eintragen („gesund ab") und Notiz ändern */
export async function updateSick(user: SessionUser, id: number, to: string | null, note: string): Promise<true | { message: string }> {
	const report = await sickById(id);
	if (!report) return { message: 'Diese Meldung gibt es nicht mehr.' };
	if (!mayEditSick(user, report)) return { message: 'Dafür fehlt dir die Berechtigung.' };
	if (to && (!isValidIsoDate(to) || to < report.from)) return { message: '„Bis" liegt vor dem Beginn.' };
	await db
		.update(sickReports)
		.set({ to, note: note.trim().slice(0, 500), updatedAt: new Date() })
		.where(eq(sickReports.id, id));
	return true;
}

export async function addSickDocuments(user: SessionUser, id: number, files: File[]): Promise<true | { message: string }> {
	const report = await sickById(id);
	if (!report) return { message: 'Diese Meldung gibt es nicht mehr.' };
	if (!mayEditSick(user, report)) return { message: 'Dafür fehlt dir die Berechtigung.' };
	if (!files.length) return { message: 'Bitte ein Foto oder PDF wählen.' };
	const have = await db.select({ id: sickDocuments.id }).from(sickDocuments).where(eq(sickDocuments.reportId, id)).all();
	if (have.length + files.length > MAX_BELEGE) return { message: `Höchstens ${MAX_BELEGE} Belege je Krankenstand.` };
	try {
		for (const s of await storeAll(files)) await db.insert(sickDocuments).values({ reportId: id, ...s, createdBy: user.id });
	} catch (err) {
		if (err instanceof BelegError) return { message: err.message };
		throw err;
	}
	return true;
}

/** Beleg zum Ansehen – nur für die, die ihn sehen dürfen */
export async function sickDocument(user: SessionUser, docId: number) {
	const doc = await db
		.select({
			kind: sickDocuments.kind,
			sha256: sickDocuments.sha256,
			fileName: sickDocuments.fileName,
			userId: sickReports.userId,
			createdBy: sickReports.createdBy
		})
		.from(sickDocuments)
		.innerJoin(sickReports, eq(sickReports.id, sickDocuments.reportId))
		.where(eq(sickDocuments.id, docId))
		.get();
	if (!doc || !seesDocs(user, doc)) return null;
	const file = belegFile(doc.sha256, doc.kind);
	return fs.existsSync(file) ? { file, kind: doc.kind, fileName: doc.fileName } : null;
}

export async function deleteSickDocument(user: SessionUser, docId: number): Promise<true | { message: string }> {
	const doc = await db
		.select({
			id: sickDocuments.id,
			userId: sickReports.userId,
			createdBy: sickReports.createdBy
		})
		.from(sickDocuments)
		.innerJoin(sickReports, eq(sickReports.id, sickDocuments.reportId))
		.where(eq(sickDocuments.id, docId))
		.get();
	if (!doc) return true;
	if (!mayEditSick(user, doc)) return { message: 'Dafür fehlt dir die Berechtigung.' };
	await db.delete(sickDocuments).where(eq(sickDocuments.id, docId));
	return true;
}

/** Löschen: wer gemeldet hat oder das Büro */
export async function deleteSick(user: SessionUser, id: number): Promise<true | { message: string }> {
	const report = await sickById(id);
	if (!report) return true;
	if (report.createdBy !== user.id && !can(user.role, 'krankenstand.bearbeiten')) return { message: 'Dafür fehlt dir die Berechtigung.' };
	await db.delete(sickReports).where(eq(sickReports.id, id));
	return true;
}

/** Für die Übersicht: wer heute krank ist und wie viele Meldungen der letzten 60 Tage noch keinen Beleg haben */
export async function sickCounts(day: string) {
	const since = new Date(Date.parse(`${day}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
	const [today, noDoc] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(sickReports)
			.where(and(lte(sickReports.from, day), or(isNull(sickReports.to), gte(sickReports.to, day))))
			.get(),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(sickReports)
			.where(and(gte(sickReports.from, since), sql`not exists (select 1 from ${sickDocuments} where ${col(sickDocuments.reportId)} = ${col(sickReports.id)})`))
			.get()
	]);
	return { today: today?.n ?? 0, withoutDoc: noDoc?.n ?? 0 };
}
