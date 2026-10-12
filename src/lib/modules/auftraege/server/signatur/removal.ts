/**
 * Ausgestellte Rechnungen und Stornorechnungen löschen – nur zum Testen und
 * nur mit dem eigenen Recht „Alle löschen" (von Haus aus Admin). Echte
 * Rechnungen sind aufzubewahren; korrigiert wird per Storno.
 *
 * Die Sperren (Trigger) werden dafür nur innerhalb der Transaktion abgelegt
 * und am Ende unverändert wieder angelegt – scheitert etwas, rollt alles
 * zurück, auch die Trigger. Das Protokoll bleibt vollständig: Die Löschung
 * selbst steht darin, mit Begründung.
 *
 * - Rechnung mit Storno: die Stornorechnung geht mit.
 * - Stornorechnung allein: die stornierte Rechnung gilt wieder (wie vor dem
 *   Storno), ihre Tagesberichte hängen wieder an ihr, sofern noch frei.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dailyReports, invoiceAudit, invoiceFiles, invoices, invoiceSignatures } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { audit } from './audit';
import { removeUnreferenced } from './archive';
import { forgetVerification } from './verification';
import { syncOfferBilling } from '../billing';

/** Diese Tabellen sperren Trigger – das Protokoll nicht: dort wird nur angefügt */
const LOCKED_TABLES = ['invoices', 'invoice_positions', 'invoice_files', 'invoice_signatures'];

export type RemovalResult = { ok: true; deleted: string[]; restoredId: number | null } | { ok: false; message: string };

export async function deleteIssuedInvoice(user: SessionUser, id: number, why: string): Promise<RemovalResult> {
	const reason = why.replace(/\s+/g, ' ').trim().slice(0, 500);
	if (reason.length < 3) return { ok: false, message: 'Bitte angeben, warum die Rechnung gelöscht wird.' };
	const row = await db.select().from(invoices).where(eq(invoices.id, id)).get();
	if (!row) return { ok: false, message: 'Die Rechnung gibt es nicht mehr.' };
	if (row.stage === 'entwurf') return { ok: false, message: 'Entwürfe werden über „Entwurf löschen" entfernt.' };
	if (row.stage === 'signierung' && Date.now() - (row.updatedAt?.getTime() ?? 0) < 5 * 60_000) {
		return { ok: false, message: 'Die Rechnung wird gerade signiert – bitte kurz warten.' };
	}

	// Mit der Rechnung geht ihre Stornorechnung; eine Stornorechnung allein hebt das Storno auf
	const ids = [id];
	if (row.kind !== 'storno' && row.stornoId) ids.push(row.stornoId);
	const restore = row.kind === 'storno' && row.cancelsId ? await db.select().from(invoices).where(eq(invoices.id, row.cancelsId)).get() : undefined;
	const doomed = await db.select({ id: invoices.id, number: invoices.number, kind: invoices.kind, stage: invoices.stage, token: invoices.verifyToken }).from(invoices).where(inArray(invoices.id, ids)).all();
	const files = await db.select({ invoiceId: invoiceFiles.invoiceId, fileName: invoiceFiles.fileName }).from(invoiceFiles).where(inArray(invoiceFiles.invoiceId, ids)).all();

	await db.transaction(async (tx) => {
		const triggers = await tx.all<{ name: string; sql: string }>(
			sql`select name, sql from sqlite_master where type = 'trigger' and sql is not null and tbl_name in (${sql.join(
				LOCKED_TABLES.map((t) => sql`${t}`),
				sql`, `
			)})`
		);
		for (const t of triggers) await tx.run(sql.raw(`drop trigger "${t.name.replace(/"/g, '')}"`));

		if (restore) {
			const signed = await tx.select({ id: invoiceSignatures.id }).from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, restore.id)).get();
			await tx
				.update(invoices)
				.set({
					stage: signed ? 'signiert' : restore.signError ? 'fehlgeschlagen' : 'ausgestellt',
					cancelledAt: null,
					cancelledBy: null,
					cancelReason: null,
					stornoId: null,
					updatedAt: new Date()
				})
				.where(eq(invoices.id, restore.id));
			// Die beim Storno freigegebenen Berichte wieder anhängen – sofern inzwischen nicht neu abgerechnet
			const cancelled = await tx
				.select({ detail: invoiceAudit.detail })
				.from(invoiceAudit)
				.where(and(eq(invoiceAudit.invoiceId, restore.id), eq(invoiceAudit.action, 'storniert')))
				.orderBy(desc(invoiceAudit.id))
				.get();
			let reports: number[] = [];
			try {
				reports = ((JSON.parse(cancelled?.detail ?? '{}').tagesberichte ?? []) as unknown[]).map(Number).filter(Number.isInteger);
			} catch {
				/* ohne Angabe bleiben sie frei */
			}
			if (reports.length) await tx.update(dailyReports).set({ invoiceId: restore.id }).where(and(inArray(dailyReports.id, reports), isNull(dailyReports.invoiceId)));
		}

		await tx.update(dailyReports).set({ invoiceId: null }).where(inArray(dailyReports.invoiceId, ids));
		await tx.delete(invoiceSignatures).where(inArray(invoiceSignatures.invoiceId, ids));
		await tx.delete(invoiceFiles).where(inArray(invoiceFiles.invoiceId, ids));
		await tx.delete(invoices).where(inArray(invoices.id, ids));

		for (const d of doomed) {
			await audit(
				{
					invoiceId: d.id,
					invoiceNumber: d.number,
					user,
					action: 'geloescht_ausgestellt',
					detail: { grund: reason, art: d.kind, stufe: d.stage, dateien: files.filter((f) => f.invoiceId === d.id).map((f) => f.fileName) }
				},
				tx
			);
		}
		if (restore) await audit({ invoiceId: restore.id, invoiceNumber: restore.number, user, action: 'storno_aufgehoben', detail: { grund: reason, stornorechnung: row.number } }, tx);
		await syncOfferBilling(row.orderId, 'beide', tx);

		for (const t of triggers) await tx.run(sql.raw(t.sql));
	});

	// Erst nach der Transaktion: die Dateien gehören zu nichts mehr
	for (const f of files) removeUnreferenced(f.fileName);
	for (const d of doomed) forgetVerification(d.token);
	if (restore) forgetVerification(restore.verifyToken);
	return { ok: true, deleted: doomed.map((d) => d.number), restoredId: restore?.id ?? null };
}
