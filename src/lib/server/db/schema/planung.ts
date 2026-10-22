/**
 * Planung und Abwesenheiten: die Wochenplanung je Partie und Tag, die
 * durchgehende Notizliste dazu, Urlaubsanträge und Krankmeldungen mit Belegen.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { orders } from './auftraege';
import { parties, users } from './core';

/**
 * Ein Eintrag in der Wochenplanung: an einem Tag für eine Partie – ein Auftrag
 * oder freier Text (z. B. „Stbe 1", „Leitschutz?"). Beides geht auch zusammen:
 * dann ist der Text ein Zusatz zum Auftrag.
 */
export const planEntries = sqliteTable(
	'plan_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** „JJJJ-MM-TT" */
		date: text('date').notNull(),
		partyId: integer('party_id')
			.notNull()
			.references(() => parties.id, { onDelete: 'cascade' }),
		orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
		text: text('text').notNull().default(''),
		sortOrder: integer('sort_order').notNull().default(0),
		/** Vom Termin im Arbeitsauftrag eingetragen – zieht mit, wenn sich Termin oder Partie ändern */
		fromWorkOrder: integer('from_work_order', { mode: 'boolean' }).notNull().default(false),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('plan_entries_date_idx').on(t.date), index('plan_entries_party_idx').on(t.partyId, t.date), index('plan_entries_order_idx').on(t.orderId)]
);

/**
 * Besetzung in der Wochenplanung, abweichend von der festen Partie im
 * Benutzerkonto – wie am Zettel: für eine ganze Woche (`planCrewWeeks`) oder nur
 * an einem Tag (`planCrewDays`, geht vor). Die feste Partie bleibt; nächste
 * Woche gilt wieder sie.
 */
export const planCrewWeeks = sqliteTable(
	'plan_crew_weeks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Montag der Woche, „JJJJ-MM-TT" */
		weekStart: text('week_start').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		partyId: integer('party_id')
			.notNull()
			.references(() => parties.id, { onDelete: 'cascade' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('plan_crew_weeks_user_idx').on(t.weekStart, t.userId)]
);

export const planCrewDays = sqliteTable(
	'plan_crew_days',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** „JJJJ-MM-TT" */
		date: text('date').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		partyId: integer('party_id')
			.notNull()
			.references(() => parties.id, { onDelete: 'cascade' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('plan_crew_days_user_idx').on(t.date, t.userId)]
);

/** Notizen zur Planung – eine durchgehende Liste, nur fürs Büro; erledigte bleiben abgehakt stehen */
export const planNotes = sqliteTable('plan_notes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	text: text('text').notNull(),
	done: integer('done', { mode: 'boolean' }).notNull().default(false),
	doneAt: integer('done_at', { mode: 'timestamp_ms' }),
	createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

export const LEAVE_STATUS = ['beantragt', 'genehmigt', 'abgelehnt'] as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[number];

/** Urlaubsantrag: beantragt → genehmigt bzw. abgelehnt */
export const leaveRequests = sqliteTable(
	'leave_requests',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** „JJJJ-MM-TT", beide eingeschlossen */
		from: text('from_date').notNull(),
		to: text('to_date').notNull(),
		/** Urlaubstage beim Beantragen bzw. Genehmigen (ohne Feiertage und Wochentage ohne Urlaubsstunden) */
		days: real('days').notNull().default(0),
		/**
		 * Urlaubsstunden je Wochentag (Montag zuerst), festgehalten beim Genehmigen –
		 * spätere Änderungen in den Einstellungen gelten nur für neue. Ohne: die aktuellen.
		 */
		dayHours: text('day_hours', { mode: 'json' }).$type<number[]>(),
		note: text('note').notNull().default(''),
		status: text('status', { enum: LEAVE_STATUS }).notNull().default('beantragt'),
		decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
		decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
		/** Begründung bei Ablehnung bzw. Hinweis zur Genehmigung */
		decisionNote: text('decision_note').notNull().default(''),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('leave_requests_user_idx').on(t.userId, t.from), index('leave_requests_status_idx').on(t.status), index('leave_requests_range_idx').on(t.from, t.to)]
);

/** Krankenstand: von – bis; ohne Ende heißt „noch krank" */
export const sickReports = sqliteTable(
	'sick_reports',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		from: text('from_date').notNull(),
		to: text('to_date'),
		note: text('note').notNull().default(''),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('sick_reports_user_idx').on(t.userId, t.from), index('sick_reports_range_idx').on(t.from, t.to)]
);

/** Beleg zur Krankmeldung: Foto (JPEG) oder PDF unter /data/krankmeldungen/<sha256>.<jpg|pdf> */
export const sickDocuments = sqliteTable(
	'sick_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reportId: integer('report_id')
			.notNull()
			.references(() => sickReports.id, { onDelete: 'cascade' }),
		sha256: text('sha256').notNull(),
		kind: text('kind', { enum: ['pdf', 'jpg'] }).notNull(),
		fileName: text('file_name').notNull().default(''),
		size: integer('size').notNull().default(0),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('sick_documents_report_idx').on(t.reportId)]
);
