/**
 * Tagesberichte wie das Papierformular: Kopf mit Nummer, Datum und Straße,
 * beliebig viele LB-Positionen mit Einheit, darunter Zeilen mit Ortsbezeichnung
 * und Mengen je Position, dazu der Materialblock (Material, Kenn-Nr., Filmdicke).
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { InkPages } from '../../../ink';
import { createdAt } from './common';
import { invoices, orders } from './auftraege';
import { parties, users } from './core';
import { products } from './lager';

/**
 * Ablauf: in Arbeit → freigegeben (Partieführer unterschreibt für den
 * Auftragnehmer) → geprüft (Bauleitung/Büro) → abgeschlossen, sobald der Kunde
 * über seinen Link unterschrieben hat.
 */
export const REPORT_STATUS = ['entwurf', 'freigegeben', 'geprueft', 'abgeschlossen'] as const;
export type ReportStatus = (typeof REPORT_STATUS)[number];

export const dailyReports = sqliteTable(
	'daily_reports',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Nummer vom Block, frei eintragbar – beim Anlegen wird die nächste vorgeschlagen */
		number: text('number').notNull().default(''),
		/** Tag des Berichts als "JJJJ-MM-TT" – bei mehreren Tagen der erste */
		date: text('date').notNull(),
		/** Letzter Tag, wenn der Bericht über mehrere Tage geht – sonst leer */
		dateTo: text('date_to'),
		/** Bundesstraße Nr. aus dem Kästchen rechts oben */
		road: text('road').notNull().default(''),
		/** Baustelle und Kostenstelle; später kommt hier der Auftrag dazu */
		site: text('site').notNull().default(''),
		costCenter: text('cost_center').notNull().default(''),
		/** Tagesleistung und LV-Position aus den letzten beiden Zeilen der Tabelle */
		dailyOutput: text('daily_output').notNull().default(''),
		lvPosition: text('lv_position').notNull().default(''),
		note: text('note').notNull().default(''),
		status: text('status', { enum: REPORT_STATUS }).notNull().default('entwurf'),
		partyId: integer('party_id').references(() => parties.id, { onDelete: 'set null' }),
		/** Auftrag, zu dem der Bericht gehört – freiwillig */
		orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
		/** Mit dieser Rechnung abgerechnet – jeder Bericht nur einmal */
		invoiceId: integer('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		/** Freigabe mit Unterschrift (SVG-Pfad) – steht im Ausdruck bei „Für den Auftragnehmer" */
		releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
		releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
		releaseSignature: text('release_signature'),
		checkedBy: integer('checked_by').references(() => users.id, { onDelete: 'set null' }),
		checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
		/**
		 * Dauerhafter Link für den Kunden (/bericht/<token>): dort unterschreibt er
		 * und lädt den fertigen Bericht. Bleibt beim Wieder öffnen erhalten.
		 */
		customerToken: text('customer_token'),
		/** Unterschrift des Kunden – steht im Ausdruck bei „Für den Auftraggeber" */
		customerName: text('customer_name'),
		customerSignature: text('customer_signature'),
		customerSignedAt: integer('customer_signed_at', { mode: 'timestamp_ms' }),
		/** Auf der Baustelle am Gerät unterschrieben (statt über den Link) – dann gleich nach der Prüfung fertig */
		customerSignedOnSite: integer('customer_signed_on_site', { mode: 'boolean' }).notNull().default(false),
		/** Zuletzt per E-Mail verschickt – an wen und wann */
		customerEmail: text('customer_email'),
		customerLinkSentAt: integer('customer_link_sent_at', { mode: 'timestamp_ms' }),
		/** Handschrift auf dem Formular (Tablet) – je Seite die Striche in PDF-Punkten */
		ink: text('ink', { mode: 'json' }).$type<InkPages>(),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('daily_reports_date_idx').on(t.date),
		index('daily_reports_party_idx').on(t.partyId),
		index('daily_reports_order_idx').on(t.orderId),
		index('daily_reports_invoice_idx').on(t.invoiceId),
		uniqueIndex('daily_reports_customer_token_idx').on(t.customerToken)
	]
);

/** Kopf einer Mengenspalte: LB-Position und Einheit */
export const dailyReportPositions = sqliteTable(
	'daily_report_positions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reportId: integer('report_id')
			.notNull()
			.references(() => dailyReports.id, { onDelete: 'cascade' }),
		/** Reihenfolge der Spalte, ab 1 */
		idx: integer('idx').notNull(),
		lbPos: text('lb_pos').notNull().default(''),
		unit: text('unit').notNull().default(''),
		/** Gesamtmenge – wird von Hand eingetragen */
		totalQuantity: real('total_quantity'),
		/** Feste Kennung der Zeile – damit gleichzeitiges Bearbeiten sie wiedererkennt (ältere: leer) */
		uid: text('uid')
	},
	(t) => [uniqueIndex('daily_report_positions_idx').on(t.reportId, t.idx)]
);

/** Eine Zeile der Tabelle: Ortsbezeichnung und die Mengen je Spalte */
export const dailyReportRows = sqliteTable(
	'daily_report_rows',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reportId: integer('report_id')
			.notNull()
			.references(() => dailyReports.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		label: text('label').notNull().default(''),
		/** Mengen je LB-Position, in der Reihenfolge der Spalten */
		quantities: text('quantities', { mode: 'json' }).$type<(number | null)[]>().notNull().default([]),
		/** Feste Kennung der Zeile – damit gleichzeitiges Bearbeiten sie wiedererkennt (ältere: leer) */
		uid: text('uid')
	},
	(t) => [index('daily_report_rows_report_idx').on(t.reportId, t.sortOrder)]
);

/** Eine Zeile im Materialblock unten links */
export const dailyReportMaterials = sqliteTable(
	'daily_report_materials',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reportId: integer('report_id')
			.notNull()
			.references(() => dailyReports.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		/** Artikel aus dem Lager, aus dem Material und Kenn-Nr. übernommen wurden */
		productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
		/** Material bzw. Farbe, z. B. „Weiß" */
		material: text('material').notNull().default(''),
		/** Kenn-Nr. – beim Artikel aus dem Lager dessen Name */
		code: text('code').notNull().default(''),
		/** Filmdicke – meist mm, aber frei, z. B. „0,6 nass" */
		filmThickness: text('film_thickness').notNull().default(''),
		/** Feste Kennung der Zeile – damit gleichzeitiges Bearbeiten sie wiedererkennt (ältere: leer) */
		uid: text('uid')
	},
	(t) => [index('daily_report_materials_report_idx').on(t.reportId, t.sortOrder)]
);

/**
 * Fotos zum Bericht – nur intern, nicht im PDF und nicht beim Kunden. Die
 * Dateien liegen unter /data/fotos/<sha256>.jpg, dazu eine kleine Vorschau.
 */
export const dailyReportPhotos = sqliteTable(
	'daily_report_photos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reportId: integer('report_id')
			.notNull()
			.references(() => dailyReports.id, { onDelete: 'cascade' }),
		sha256: text('sha256').notNull(),
		thumbSha256: text('thumb_sha256').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		size: integer('size').notNull(),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('daily_report_photos_report_idx').on(t.reportId)]
);

export type DailyReport = typeof dailyReports.$inferSelect;
export type DailyReportRow = typeof dailyReportRows.$inferSelect;
