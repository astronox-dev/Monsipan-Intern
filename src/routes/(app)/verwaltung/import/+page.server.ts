/**
 * Import und Export: Kunden, Anfragen, Aufträge und Rechnungen als Excel oder
 * CSV. Der Import läuft in drei Schritten über dasselbe Formular – Datei
 * lesen, Spalten zuordnen und prüfen, importieren. Die Datei wird jedes Mal
 * mitgeschickt; am Server bleibt nichts liegen.
 */
import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { customers, inquiries, invoices, orders } from '$lib/server/db/schema';
import { requirePermission } from '$lib/server/guard';
import { readTable, TableError, type TableCell } from '$lib/server/table';
import { planImport, runImport, toText, type ImportPlan } from '$lib/modules/auftraege/server/transfer';
import { suggestMapping, TRANSFER, TRANSFER_KINDS, type TransferKind, type TransferMapping } from '$lib/modules/auftraege/transfer';
import type { Actions, PageServerLoad } from './$types';

const count = async (table: typeof customers | typeof inquiries | typeof orders | typeof invoices) =>
	Number((await db.select({ n: sql<number>`count(*)` }).from(table).get())?.n ?? 0);

export const load: PageServerLoad = async ({ locals }) => {
	const user = requirePermission(locals, 'daten.export');
	const [kunden, anfragen, auftraege, rechnungen] = await Promise.all([count(customers), count(inquiries), count(orders), count(invoices)]);
	const counts: Record<TransferKind, number> = { kunden, anfragen, auftraege, rechnungen };
	return {
		exports: TRANSFER_KINDS.filter((k) => can(user.role, TRANSFER[k].permission)).map((k) => ({ kind: k, label: TRANSFER[k].label, count: counts[k] })),
		canImport: can(user.role, 'daten.import')
	};
};

/** Was der Browser für die Zuordnung braucht: Spalten mit Beispielwerten */
function describe(table: { sheets: string[]; sheet: string; rows: TableCell[][] }) {
	const [header = [], ...rows] = table.rows;
	const width = Math.max(header.length, ...rows.slice(0, 50).map((r) => r.length));
	const columns = Array.from({ length: width }, (_, i) => {
		const sample = rows.map((r) => toText(r[i])).find((v) => v !== '') ?? '';
		return { index: i, title: toText(header[i]) || `Spalte ${i + 1}`, sample: sample.slice(0, 60) };
	});
	return { sheets: table.sheets, sheet: table.sheet, columns, rows: rows.length };
}

/** Prüfergebnis für die Anzeige – gekürzt */
function summary(plan: ImportPlan) {
	return {
		counts: plan.counts,
		issues: plan.issues.slice(0, 100),
		moreIssues: Math.max(0, plan.issues.length - 100),
		items: plan.items.filter((i) => i.action !== 'fehler').slice(0, 12).map((i) => ({ label: i.label, action: i.action, rows: i.rows.length, positions: i.positions.length }))
	};
}

async function readForm(request: Request) {
	const form = await request.formData();
	const kind = String(form.get('art') ?? '') as TransferKind;
	if (!TRANSFER_KINDS.includes(kind)) return { error: 'Bitte wählen, was importiert wird.' } as const;
	const file = form.get('datei');
	if (!(file instanceof File) || !file.size) return { error: 'Bitte eine Excel- oder CSV-Datei wählen.' } as const;
	let table;
	try {
		table = await readTable(Buffer.from(await file.arrayBuffer()), String(form.get('blatt') ?? '') || null);
	} catch (err) {
		return { error: err instanceof TableError ? err.message : 'Die Datei lässt sich nicht lesen.' } as const;
	}
	if (table.rows.length < 2) return { error: 'In der Datei stehen keine Daten (erste Zeile = Spaltenüberschriften).' } as const;
	const mapping: TransferMapping = {};
	for (const field of TRANSFER[kind].fields) {
		const raw = form.get(`m.${field.key}`);
		mapping[field.key] = raw == null ? -1 : Number(raw);
	}
	return { kind, table, file, mapping, hasMapping: form.has(`m.${TRANSFER[kind].fields[0].key}`), update: form.get('vorhandene') === 'aktualisieren' } as const;
}

export const actions: Actions = {
	/** Datei lesen: Spalten, Beispielwerte, vorgeschlagene Zuordnung */
	analyze: async ({ request, locals }) => {
		requirePermission(locals, 'daten.import');
		const input = await readForm(request);
		if ('error' in input) return fail(400, { message: input.error });
		return { analysis: describe(input.table), mapping: suggestMapping(input.kind, input.table.rows[0]), kind: input.kind, preview: null, result: null };
	},

	/** Mit der Zuordnung prüfen – schreibt nichts */
	preview: async ({ request, locals }) => {
		requirePermission(locals, 'daten.import');
		const input = await readForm(request);
		if ('error' in input) return fail(400, { message: input.error });
		const plan = await planImport(input.kind, input.table.rows.slice(1), input.mapping, { update: input.update });
		return { analysis: describe(input.table), mapping: input.mapping, kind: input.kind, preview: summary(plan), result: null };
	},

	run: async ({ request, locals }) => {
		const user = requirePermission(locals, 'daten.import');
		const input = await readForm(request);
		if ('error' in input) return fail(400, { message: input.error });
		const { plan, result } = await runImport(input.kind, input.table.rows.slice(1), input.mapping, { update: input.update }, user, input.file.name.slice(0, 200));
		return { analysis: describe(input.table), mapping: input.mapping, kind: input.kind, preview: summary(plan), result };
	}
};
