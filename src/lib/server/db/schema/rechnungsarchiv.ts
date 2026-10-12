/**
 * Archiv ausgestellter Rechnungen: die PDF-Dateien (Original und signierte
 * Fassung) mit Prüfsumme, die Angaben zur Signatur und das Protokoll aller
 * Schritte. Einträge werden nie geändert oder gelöscht – Trigger in der
 * Datenbank verhindern es (siehe Migration 0034).
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { invoices } from './auftraege';

/** Original: das PDF beim Ausstellen; signiert: dasselbe plus Signatur als angehängte Revision */
export const ARCHIVE_FILE_KINDS = ['original', 'signiert'] as const;
export type ArchiveFileKind = (typeof ARCHIVE_FILE_KINDS)[number];

export const invoiceFiles = sqliteTable(
	'invoice_files',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		invoiceId: integer('invoice_id')
			.notNull()
			.references(() => invoices.id),
		kind: text('kind', { enum: ARCHIVE_FILE_KINDS }).notNull(),
		/** Pfad unter /data/rechnungen */
		fileName: text('file_name').notNull(),
		sha256: text('sha256').notNull(),
		size: integer('size').notNull(),
		/** SHA-256 der Rechnungsdaten (Kopf und Positionen) beim Ausstellen – verrät spätere Änderungen in der Datenbank */
		contentHash: text('content_hash'),
		createdBy: integer('created_by'),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('invoice_files_kind_idx').on(t.invoiceId, t.kind)]
);

export const invoiceSignatures = sqliteTable(
	'invoice_signatures',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		invoiceId: integer('invoice_id')
			.notNull()
			.references(() => invoices.id),
		fileId: integer('file_id')
			.notNull()
			.references(() => invoiceFiles.id),
		/** lokal oder csc */
		provider: text('provider').notNull(),
		/** Eingestellte und tatsächlich erreichte PAdES-Stufe (B-B, B-T, B-LT, B-LTA) */
		requestedLevel: text('requested_level').notNull(),
		level: text('level').notNull(),
		signedAt: integer('signed_at', { mode: 'timestamp_ms' }).notNull(),
		/** Zeit laut Zeitstempeldienst – die verbindliche Signaturzeit */
		timestampAt: integer('timestamp_at', { mode: 'timestamp_ms' }),
		tsa: text('tsa').notNull().default(''),
		certName: text('cert_name').notNull(),
		certOrganization: text('cert_organization').notNull().default(''),
		certIssuer: text('cert_issuer').notNull(),
		certSerial: text('cert_serial').notNull(),
		certFingerprint: text('cert_fingerprint').notNull(),
		certNotBefore: text('cert_not_before').notNull(),
		certNotAfter: text('cert_not_after').notNull(),
		/** selbst, ausgestellt, qualifiziertes-zertifikat oder qualifiziert (siehe cert.ts) */
		qualification: text('qualification').notNull(),
		notes: text('notes').notNull().default(''),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('invoice_signatures_invoice_idx').on(t.invoiceId)]
);

/**
 * Protokoll: jeder Eintrag trägt den Hash des vorigen (Hash-Kette). Wer einen
 * Eintrag ändert, löscht oder einschiebt, bricht die Kette – die Prüfung im
 * Archiv findet es. Ohne Fremdschlüssel: Einträge zu gelöschten Entwürfen
 * und Benutzern bleiben stehen.
 */
export const invoiceAudit = sqliteTable(
	'invoice_audit',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		at: integer('at', { mode: 'timestamp_ms' }).notNull(),
		invoiceId: integer('invoice_id'),
		invoiceNumber: text('invoice_number').notNull().default(''),
		action: text('action').notNull(),
		userId: integer('user_id'),
		userName: text('user_name').notNull().default(''),
		/** Einzelheiten als JSON */
		detail: text('detail').notNull().default('{}'),
		prevHash: text('prev_hash').notNull(),
		hash: text('hash').notNull()
	},
	(t) => [index('invoice_audit_invoice_idx').on(t.invoiceId, t.id), uniqueIndex('invoice_audit_prev_idx').on(t.prevHash), uniqueIndex('invoice_audit_hash_idx').on(t.hash)]
);

export type InvoiceFile = typeof invoiceFiles.$inferSelect;
export type InvoiceSignature = typeof invoiceSignatures.$inferSelect;
