/**
 * Angebote und Aufträge: Kundenstamm, Angebote mit Positionen und Preisen,
 * daraus nach der Annahme durch den Kunden der Auftrag für eine Partie –
 * mit derselben Nummer, ohne Preise.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt } from './common';
import { parties, users } from './core';
import { INVOICE_STAGES } from '../../../modules/auftraege/signature';

export const customers = sqliteTable(
	'customers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Firma bzw. Name, wie er im Anschriftfeld steht */
		name: text('name').notNull(),
		/** Zweite Zeile, z. B. Abteilung („Stahl- und Anlagenbau") */
		addition: text('addition').notNull().default(''),
		street: text('street').notNull().default(''),
		zip: text('zip').notNull().default(''),
		city: text('city').notNull().default(''),
		uid: text('uid').notNull().default(''),
		email: text('email').notNull().default(''),
		phone: text('phone').notNull().default(''),
		contact: text('contact').notNull().default(''),
		note: text('note').notNull().default(''),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('customers_name_idx').on(t.name)]
);

/**
 * Ablauf: in Arbeit → freigegeben („ausstehend", Link an den Kunden) →
 * angenommen, oder der Kunde wünscht Änderungen (aenderung) – dann wird es
 * überarbeitet und neu freigegeben. Angenommen wird über den Link oder intern.
 * Aus einem angenommenen Angebot entsteht der Auftrag; ist er abgeschlossen und
 * alles bezahlt, gilt das Angebot als abgerechnet (billedAt).
 */
export const OFFER_STATUS = ['entwurf', 'freigegeben', 'aenderung', 'angenommen'] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

export const offers = sqliteTable(
	'offers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Angebotsnummer, z. B. „26659" – der Auftrag bekommt dieselbe */
		number: text('number').notNull(),
		projectNumber: text('project_number').notNull().default(''),
		/** Angebotsdatum „JJJJ-MM-TT" */
		date: text('date').notNull(),
		/** BV – was angeboten wird, steht in der Überschrift */
		title: text('title').notNull().default(''),
		/** Wo gearbeitet wird – geht in den Auftrag über */
		location: text('location').notNull().default(''),
		customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		/** Anschrift, wie sie im Angebot steht – bleibt, auch wenn sich der Kundenstamm ändert */
		customerName: text('customer_name').notNull().default(''),
		customerAddition: text('customer_addition').notNull().default(''),
		customerStreet: text('customer_street').notNull().default(''),
		customerZip: text('customer_zip').notNull().default(''),
		customerCity: text('customer_city').notNull().default(''),
		customerUid: text('customer_uid').notNull().default(''),
		intro: text('intro').notNull().default(''),
		closing: text('closing').notNull().default(''),
		/** Umsatzsteuer in Prozent */
		vatRate: real('vat_rate').notNull().default(20),
		status: text('status', { enum: OFFER_STATUS }).notNull().default('entwurf'),
		releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
		releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
		/** Dauerhafter Link für den Kunden (/angebot/<token>) */
		customerToken: text('customer_token'),
		customerEmail: text('customer_email'),
		customerLinkSentAt: integer('customer_link_sent_at', { mode: 'timestamp_ms' }),
		/** Letzter Änderungswunsch des Kunden – bleibt sichtbar, bis neu freigegeben wird */
		changeRequest: text('change_request'),
		changeRequestName: text('change_request_name'),
		changeRequestedAt: integer('change_requested_at', { mode: 'timestamp_ms' }),
		/** Annahme mit Name und Unterschrift (SVG-Pfad) */
		acceptedName: text('accepted_name'),
		acceptedSignature: text('accepted_signature'),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		/** Intern als angenommen markiert (ohne Unterschrift über den Link) – von wem */
		acceptedBy: integer('accepted_by').references(() => users.id, { onDelete: 'set null' }),
		/** Abgerechnet: Auftrag abgeschlossen und seine Rechnungen bezahlt – bzw. so übernommen */
		billedAt: integer('billed_at', { mode: 'timestamp_ms' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		uniqueIndex('offers_number_idx').on(t.number),
		uniqueIndex('offers_customer_token_idx').on(t.customerToken),
		index('offers_customer_idx').on(t.customerId),
		index('offers_date_idx').on(t.date)
	]
);

/** Zeile im Angebot: eine Position mit Preis oder eine Zwischenüberschrift (Titel) */
export const OFFER_LINE_KINDS = ['position', 'titel'] as const;

export const offerPositions = sqliteTable(
	'offer_positions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		offerId: integer('offer_id')
			.notNull()
			.references(() => offers.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		kind: text('kind', { enum: OFFER_LINE_KINDS }).notNull().default('position'),
		text: text('text').notNull().default(''),
		quantity: real('quantity'),
		unit: text('unit').notNull().default(''),
		/** Einheitspreis netto in Euro */
		unitPrice: real('unit_price')
	},
	(t) => [index('offer_positions_offer_idx').on(t.offerId, t.sortOrder)]
);

/** Auftrag erstellt → in Arbeit → abgeschlossen; die Partie setzt die beiden letzten */
export const ORDER_STATUS = ['erstellt', 'in_arbeit', 'abgeschlossen'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const orders = sqliteTable(
	'orders',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Dieselbe Nummer wie das Angebot */
		number: text('number').notNull(),
		offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
		partyId: integer('party_id').references(() => parties.id, { onDelete: 'set null' }),
		status: text('status', { enum: ORDER_STATUS }).notNull().default('erstellt'),
		projectNumber: text('project_number').notNull().default(''),
		title: text('title').notNull().default(''),
		/** Wo gearbeitet wird – aus dem Angebot, im Auftrag änderbar */
		location: text('location').notNull().default(''),
		customerName: text('customer_name').notNull().default(''),
		customerAddition: text('customer_addition').notNull().default(''),
		customerStreet: text('customer_street').notNull().default(''),
		customerZip: text('customer_zip').notNull().default(''),
		customerCity: text('customer_city').notNull().default(''),
		/** Ansprechpartner und Telefon aus dem Kundenstamm – für die Partie vor Ort */
		customerContact: text('customer_contact').notNull().default(''),
		customerPhone: text('customer_phone').notNull().default(''),
		/** Hinweis an die Partie */
		note: text('note').notNull().default(''),
		/**
		 * Für die Rechnung gemerkt: welche Mengenspalte der Tagesberichte (Schlüssel
		 * „LB-Pos|Einheit") zu welcher Angebotsposition gehört – null heißt „nicht abrechnen"
		 */
		/** Zuordnung der Mengen aus den Tagesberichten: Positions-ID, null = nicht abrechnen, „eigene" = eigene Position */
		invoiceMapping: text('invoice_mapping', { mode: 'json' }).$type<Record<string, number | null | 'eigene'>>(),
		statusBy: integer('status_by').references(() => users.id, { onDelete: 'set null' }),
		statusAt: integer('status_at', { mode: 'timestamp_ms' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [uniqueIndex('orders_number_idx').on(t.number), uniqueIndex('orders_offer_idx').on(t.offerId), index('orders_party_idx').on(t.partyId)]
);

/** Positionen des Auftrags – beim Erstellen aus dem Angebot übernommen, ohne Preise */
export const orderPositions = sqliteTable(
	'order_positions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		kind: text('kind', { enum: OFFER_LINE_KINDS }).notNull().default('position'),
		text: text('text').notNull().default(''),
		quantity: real('quantity'),
		unit: text('unit').notNull().default('')
	},
	(t) => [index('order_positions_order_idx').on(t.orderId, t.sortOrder)]
);

/**
 * Unterlagen zum Auftrag (PDF, z. B. Pläne) – die Partie sieht sie in der App.
 * Die Dateien liegen wie die PDFs am Artikel unter /data/dokumente/<sha256>.pdf.
 */
export const orderDocuments = sqliteTable(
	'order_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		fileName: text('file_name').notNull(),
		sha256: text('sha256').notNull(),
		size: integer('size').notNull(),
		uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('order_documents_order_idx').on(t.orderId)]
);

/**
 * PDFs am Angebot (Leistungsverzeichnis, Pläne des Kunden …) – in jedem Stand,
 * auch wenn es schon beauftragt ist. `forCrew`: erscheint auch beim Auftrag, wo
 * die Partie es sieht; sonst bleibt es beim Büro. Dateien wie die PDFs am Artikel.
 */
export const offerDocuments = sqliteTable(
	'offer_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		offerId: integer('offer_id')
			.notNull()
			.references(() => offers.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		fileName: text('file_name').notNull(),
		sha256: text('sha256').notNull(),
		size: integer('size').notNull(),
		forCrew: integer('for_crew', { mode: 'boolean' }).notNull().default(false),
		uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('offer_documents_offer_idx').on(t.offerId)]
);

/**
 * Anfragen: eine E-Mail, hineinkopiert, mit Absender und Betreff. Daraus wird
 * ein Angebot; sobald es angenommen ist, ist die Anfrage erledigt und
 * verschwindet aus der Liste der offenen.
 */
export const inquiries = sqliteTable(
	'inquiries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Eingang „JJJJ-MM-TT" */
		receivedOn: text('received_on').notNull(),
		subject: text('subject').notNull().default(''),
		/** Der eingefügte Text der E-Mail */
		body: text('body').notNull().default(''),
		senderName: text('sender_name').notNull().default(''),
		senderEmail: text('sender_email').notNull().default(''),
		senderPhone: text('sender_phone').notNull().default(''),
		/** Firma oder Gemeinde, wenn der Absender sie angibt (Kontaktformular der Webseite) */
		senderCompany: text('sender_company').notNull().default(''),
		/** Woher: leer = von Hand (eingefügte E-Mail), „webseite" = Kontaktformular auf monsipan.at */
		source: text('source').notNull().default(''),
		customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		/** Wo gearbeitet werden soll – geht ins Angebot */
		location: text('location').notNull().default(''),
		note: text('note').notNull().default(''),
		/** Das Angebot zur Anfrage */
		offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
		/** Ohne Angebot erledigt (z. B. abgesagt) – dann ebenfalls nicht mehr bei den offenen */
		closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
		/** In Arbeit genommen (noch ohne Angebot) – wann und von wem; mit Angebot zählt dessen Stand */
		inProgressAt: integer('in_progress_at', { mode: 'timestamp_ms' }),
		inProgressBy: integer('in_progress_by').references(() => users.id, { onDelete: 'set null' }),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [uniqueIndex('inquiries_offer_idx').on(t.offerId), index('inquiries_received_idx').on(t.receivedOn)]
);

/** Rechnung: offen, bis das Geld da ist – dann bezahlt */
export const INVOICE_STATUS = ['offen', 'bezahlt'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

/** Rechnung über alles, Teilrechnung über einen Teil der Tagesberichte, Stornorechnung zu einer ausgestellten */
export const INVOICE_KINDS = ['rechnung', 'teilrechnung', 'storno'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/**
 * Rechnung zum abgeschlossenen Auftrag – mit derselben Nummer. Preise aus dem
 * Angebot, Mengen aus den Tagesberichten. Anschrift und Positionen stehen in
 * der Rechnung selbst, damit sie bleibt, wie sie geschrieben wurde.
 */
export const invoices = sqliteTable(
	'invoices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Dieselbe Nummer wie Auftrag und Angebot; weitere Rechnungen zum Auftrag mit „-2", „-3" … */
		number: text('number').notNull(),
		kind: text('kind', { enum: INVOICE_KINDS }).notNull().default('rechnung'),
		orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
		offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
		/** Rechnungsdatum „JJJJ-MM-TT" */
		date: text('date').notNull(),
		/** Leistungszeitraum – aus den Tagesberichten vorgeschlagen */
		serviceFrom: text('service_from'),
		serviceTo: text('service_to'),
		/** Zahlbar bis */
		dueDate: text('due_date').notNull(),
		projectNumber: text('project_number').notNull().default(''),
		/** Kostenstelle – die Rechnungsnummer lautet dann „Nummer/Kostenstelle" */
		costCenter: text('cost_center').notNull().default(''),
		title: text('title').notNull().default(''),
		location: text('location').notNull().default(''),
		customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		customerName: text('customer_name').notNull().default(''),
		customerAddition: text('customer_addition').notNull().default(''),
		customerStreet: text('customer_street').notNull().default(''),
		customerZip: text('customer_zip').notNull().default(''),
		customerCity: text('customer_city').notNull().default(''),
		customerUid: text('customer_uid').notNull().default(''),
		intro: text('intro').notNull().default(''),
		closing: text('closing').notNull().default(''),
		/** Für das Summenblatt: Bundesland und Abschnitt */
		state: text('state').notNull().default(''),
		section: text('section').notNull().default(''),
		/** Umsatzsteuer in Prozent */
		vatRate: real('vat_rate').notNull().default(20),
		/** Bauleistung an ein Bauunternehmen: Übergang der Steuerschuld, ohne Umsatzsteuer */
		reverseCharge: integer('reverse_charge', { mode: 'boolean' }).notNull().default(false),
		status: text('status', { enum: INVOICE_STATUS }).notNull().default('offen'),
		/** Bezahlt am „JJJJ-MM-TT" */
		paidOn: text('paid_on'),
		paidBy: integer('paid_by').references(() => users.id, { onDelete: 'set null' }),
		/** Benachrichtigung „überfällig" ist verschickt – einmal je Rechnung */
		overdueNotifiedAt: integer('overdue_notified_at', { mode: 'timestamp_ms' }),
		/**
		 * Entwurf → ausgestellt → signiert (oder Signierung fehlgeschlagen) →
		 * storniert; unabhängig von offen/bezahlt. Ab „ausgestellt" sperren
		 * Trigger in der Datenbank alles, was auf der Rechnung steht.
		 */
		stage: text('stage', { enum: INVOICE_STAGES }).notNull().default('entwurf'),
		issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
		/** Wer ausgestellt bzw. storniert hat – ohne Fremdschlüssel, damit Benutzer löschbar bleiben */
		issuedBy: integer('issued_by'),
		/** Schlüssel des Prüfcodes (/pruefen/<token>): zufällig, nicht erratbar */
		verifyToken: text('verify_token'),
		/** Aufzubewahren mindestens bis „JJJJ-MM-TT" */
		retainUntil: text('retain_until'),
		/** Warum die letzte Signierung scheiterte */
		signError: text('sign_error'),
		/** Letzte Prüfung von Archiv und Signatur */
		checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
		checkResult: text('check_result'),
		checkDetail: text('check_detail'),
		cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
		cancelledBy: integer('cancelled_by'),
		cancelReason: text('cancel_reason'),
		/** Die Stornorechnung zu dieser Rechnung … */
		stornoId: integer('storno_id'),
		/** … bzw. bei der Stornorechnung die stornierte Rechnung */
		cancelsId: integer('cancels_id'),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		uniqueIndex('invoices_number_idx').on(t.number),
		uniqueIndex('invoices_verify_token_idx').on(t.verifyToken),
		index('invoices_stage_idx').on(t.stage),
		index('invoices_order_idx').on(t.orderId),
		index('invoices_status_idx').on(t.status),
		index('invoices_date_idx').on(t.date)
	]
);

export const invoicePositions = sqliteTable(
	'invoice_positions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		invoiceId: integer('invoice_id')
			.notNull()
			.references(() => invoices.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		/** Positionsnummer wie im Angebot (1.3 bleibt 1.3, auch wenn 1.2 nicht abgerechnet wird) */
		number: text('number').notNull().default(''),
		kind: text('kind', { enum: OFFER_LINE_KINDS }).notNull().default('position'),
		text: text('text').notNull().default(''),
		quantity: real('quantity'),
		unit: text('unit').notNull().default(''),
		/** Einheitspreis netto in Euro */
		unitPrice: real('unit_price')
	},
	(t) => [index('invoice_positions_invoice_idx').on(t.invoiceId, t.sortOrder)]
);

export type Customer = typeof customers.$inferSelect;
