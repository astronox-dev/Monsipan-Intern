/**
 * InvoiceAuditService – das Protokoll zu Rechnungen: wer wann was getan hat.
 * Jeder Eintrag enthält den Hash des vorigen; geändert oder gelöscht wird
 * nichts (Trigger). So fällt bei der Prüfung auf, wenn jemand an der
 * Datenbank vorbei Einträge verändert, entfernt oder einschiebt.
 */
import crypto from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { db, type Tx } from '$lib/server/db';
import { invoiceAudit } from '$lib/server/db/schema';

export interface AuditActor {
	id: number;
	firstName?: string | null;
	lastName?: string | null;
	username?: string;
}

export interface AuditEntry {
	invoiceId: number | null;
	invoiceNumber?: string;
	action: string;
	user?: AuditActor | null;
	detail?: Record<string, unknown>;
}

const GENESIS = '';

const actorName = (u: AuditActor | null | undefined) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || `#${u.id}` : 'System');

function entryHash(prevHash: string, e: { at: number; invoiceId: number | null; invoiceNumber: string; action: string; userId: number | null; userName: string; detail: string }) {
	return crypto
		.createHash('sha256')
		.update(JSON.stringify([prevHash, e.at, e.invoiceId, e.invoiceNumber, e.action, e.userId, e.userName, e.detail]))
		.digest('hex');
}

async function append(tx: Tx, e: AuditEntry) {
	const last = await tx.select({ hash: invoiceAudit.hash }).from(invoiceAudit).orderBy(desc(invoiceAudit.id)).limit(1).get();
	const row = {
		at: Date.now(),
		invoiceId: e.invoiceId,
		invoiceNumber: e.invoiceNumber ?? '',
		action: e.action,
		userId: e.user?.id ?? null,
		userName: actorName(e.user),
		detail: JSON.stringify(e.detail ?? {})
	};
	const prevHash = last?.hash ?? GENESIS;
	await tx
		.insert(invoiceAudit)
		.values({ ...row, at: new Date(row.at), prevHash, hash: entryHash(prevHash, row) })
		.run();
}

/** Eintrag schreiben – in der laufenden Transaktion oder in einer eigenen */
export async function audit(e: AuditEntry, tx?: Tx): Promise<void> {
	if (tx) return append(tx, e);
	// Zwei gleichzeitige Einträge könnten denselben Vorgänger wählen – der eindeutige Index verhindert die Gabelung, dann nochmal
	for (let attempt = 0; ; attempt++) {
		try {
			await db.transaction((t) => append(t, e));
			return;
		} catch (err) {
			if (attempt >= 3 || !/UNIQUE/i.test(String((err as Error)?.message ?? err))) throw err;
		}
	}
}

export async function auditTrail(invoiceId: number) {
	const rows = await db.select().from(invoiceAudit).where(eq(invoiceAudit.invoiceId, invoiceId)).orderBy(asc(invoiceAudit.id)).all();
	return rows.map((r) => ({ id: r.id, at: r.at, action: r.action, userName: r.userName, detail: safeJson(r.detail) }));
}

function safeJson(text: string): Record<string, unknown> {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

/** Die ganze Kette nachrechnen – gibt die erste kaputte Stelle zurück */
export async function verifyAuditChain(): Promise<{ ok: boolean; entries: number; brokenAt: number | null }> {
	const rows = await db.select().from(invoiceAudit).orderBy(asc(invoiceAudit.id)).all();
	let prev = GENESIS;
	for (const r of rows) {
		const expected = entryHash(prev, {
			at: r.at.getTime(),
			invoiceId: r.invoiceId,
			invoiceNumber: r.invoiceNumber,
			action: r.action,
			userId: r.userId,
			userName: r.userName,
			detail: r.detail
		});
		if (r.prevHash !== prev || r.hash !== expected) return { ok: false, entries: rows.length, brokenAt: r.id };
		prev = r.hash;
	}
	return { ok: true, entries: rows.length, brokenAt: null };
}
