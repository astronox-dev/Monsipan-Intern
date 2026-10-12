/**
 * Import und Export von Kunden, Anfragen, Aufträgen und Rechnungen: welche
 * Felder es gibt, wie sie in der Datei heißen (die Bezeichnung ist zugleich
 * die Spaltenüberschrift beim Export) und unter welchen Namen sie in Dateien
 * anderer Programme meist stehen – daraus wird die Zuordnung der Spalten
 * vorgeschlagen. Läuft auch im Browser.
 *
 * Aufträge und Rechnungen haben je Zeile eine Position; die Kopfdaten stehen
 * in jeder Zeile (oder nur in der ersten) und werden über die Nummer
 * zusammengefasst.
 */

import type { Permission } from '$lib/permissions';

export const TRANSFER_KINDS = ['kunden', 'anfragen', 'auftraege', 'rechnungen'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export interface TransferField {
	key: string;
	label: string;
	/** Übliche Spaltennamen – klein, ohne Umlaute, Leer- und Sonderzeichen */
	aliases: string[];
	required?: boolean;
	part: 'kopf' | 'position';
	hint?: string;
}

export interface TransferDef {
	label: string;
	/** Einzahl für Meldungen */
	one: string;
	fields: TransferField[];
	/** Gibt es Positionen (mehrere Zeilen je Nummer)? */
	positions: boolean;
	/** Was bei schon vorhandenen geht */
	update: boolean;
	/** Woran ein vorhandener erkannt wird */
	matchHint: string;
	/** Exportieren darf, wer im Bereich alles sieht */
	permission: Permission;
}

const f = (key: string, label: string, aliases: string[], extra: Partial<TransferField> = {}): TransferField => ({ key, label, aliases, part: 'kopf', ...extra });
const p = (key: string, label: string, aliases: string[], extra: Partial<TransferField> = {}): TransferField => ({ key, label, aliases, part: 'position', ...extra });

const customerAddress = [
	f('customerAddition', 'Kunde Zusatz', ['kundezusatz', 'zusatz', 'name2', 'abteilung']),
	f('customerStreet', 'Kunde Straße', ['kundestrasse', 'strasse', 'str', 'adresse', 'anschrift']),
	f('customerZip', 'Kunde PLZ', ['kundeplz', 'plz', 'postleitzahl']),
	f('customerCity', 'Kunde Ort', ['kundeort', 'stadt', 'kundenort'])
];

const positionFields = [
	p('posKind', 'Positionsart', ['positionsart', 'zeilenart', 'typ'], { hint: '„Titel" für Zwischenüberschriften' }),
	p('posText', 'Positionstext', ['positionstext', 'leistung', 'leistungstext', 'beschreibung', 'text', 'position', 'artikel', 'artikelbezeichnung']),
	p('posQuantity', 'Menge', ['menge', 'anzahl', 'stueck', 'stk']),
	p('posUnit', 'Einheit', ['einheit', 'me', 'mengeneinheit'])
];

export const TRANSFER: Record<TransferKind, TransferDef> = {
	kunden: {
		label: 'Kunden',
		one: 'Kunde',
		permission: 'kunden.sehen',
		positions: false,
		update: true,
		matchHint: 'Vorhanden heißt: gleicher Name (und gleiche PLZ, wenn angegeben).',
		fields: [
			f('name', 'Firma bzw. Name', ['name', 'firma', 'firmenname', 'kunde', 'kundenname', 'name1', 'kundenbezeichnung', 'bezeichnung'], { required: true }),
			f('addition', 'Zusatz', ['zusatz', 'name2', 'abteilung', 'zusatzzeile', 'firma2']),
			f('street', 'Straße', ['strasse', 'str', 'adresse', 'anschrift', 'strassehausnummer']),
			f('zip', 'PLZ', ['plz', 'postleitzahl']),
			f('city', 'Ort', ['ort', 'stadt', 'wohnort']),
			f('uid', 'UID-Nummer', ['uid', 'uidnummer', 'uidnr', 'ustid', 'ustidnr', 'umsatzsteuerid']),
			f('email', 'E-Mail', ['email', 'mail', 'emailadresse']),
			f('phone', 'Telefon', ['telefon', 'tel', 'telefonnummer', 'handy', 'mobil']),
			f('contact', 'Ansprechpartner', ['ansprechpartner', 'kontakt', 'kontaktperson', 'zhd']),
			f('note', 'Notiz', ['notiz', 'bemerkung', 'anmerkung', 'info', 'kommentar']),
			f('active', 'Aktiv', ['aktiv'], { hint: 'ja/nein – leer heißt aktiv' })
		]
	},
	anfragen: {
		label: 'Anfragen',
		one: 'Anfrage',
		permission: 'anfragen.sehen',
		positions: false,
		update: false,
		matchHint: 'Vorhanden heißt: gleicher Eingang, Betreff und Absender-E-Mail – sie wird übersprungen.',
		fields: [
			f('receivedOn', 'Eingang', ['eingang', 'datum', 'eingangsdatum', 'eingegangen', 'erhalten', 'anfragedatum'], { required: true }),
			f('subject', 'Betreff', ['betreff', 'titel', 'thema']),
			f('body', 'Text', ['text', 'nachricht', 'inhalt', 'beschreibung', 'anfrage', 'mailtext']),
			f('senderName', 'Absender', ['absender', 'name', 'von', 'kontakt']),
			f('senderEmail', 'E-Mail', ['email', 'mail', 'absenderemail']),
			f('senderPhone', 'Telefon', ['telefon', 'tel']),
			f('customer', 'Kunde', ['kunde', 'firma', 'kundenname'], { hint: 'Wird mit dem Kundenstamm verknüpft, wenn der Name passt' }),
			f('location', 'Ort der Arbeiten', ['ortderarbeiten', 'ort', 'ausfuehrungsort', 'baustelle', 'einsatzort']),
			f('note', 'Notiz', ['notiz', 'bemerkung', 'anmerkung']),
			f('closed', 'Erledigt', ['erledigt', 'abgeschlossen', 'geschlossen'], { hint: 'ja/nein' })
		]
	},
	auftraege: {
		label: 'Aufträge',
		one: 'Auftrag',
		permission: 'auftraege.alle.sehen',
		positions: true,
		update: true,
		matchHint: 'Vorhanden heißt: gleiche Auftragsnummer.',
		fields: [
			f('number', 'Auftragsnummer', ['auftragsnummer', 'auftragsnr', 'auftrag', 'auftragnr', 'nr', 'nummer', 'belegnummer'], { required: true }),
			f('projectNumber', 'Projektnummer', ['projektnummer', 'projekt', 'projektnr']),
			f('title', 'BV', ['bv', 'bauvorhaben', 'titel', 'bezeichnung', 'objekt', 'projektbezeichnung']),
			f('location', 'Ausführungsort', ['ausfuehrungsort', 'ort', 'baustelle', 'einsatzort', 'leistungsort']),
			f('customerName', 'Kunde', ['kunde', 'kundenname', 'firma', 'auftraggeber']),
			...customerAddress,
			f('customerContact', 'Ansprechpartner', ['ansprechpartner', 'kontakt']),
			f('customerPhone', 'Telefon', ['telefon', 'tel']),
			f('party', 'Partie', ['partie', 'kolonne', 'team', 'gruppe'], { hint: 'Name der Partie – leer heißt nicht zugeteilt' }),
			f('status', 'Stand', ['stand', 'status', 'zustand'], { hint: 'erstellt, in Arbeit oder abgeschlossen' }),
			f('note', 'Hinweis', ['hinweis', 'notiz', 'bemerkung']),
			...positionFields
		]
	},
	rechnungen: {
		label: 'Rechnungen',
		one: 'Rechnung',
		permission: 'rechnungen.sehen',
		positions: true,
		update: false,
		matchHint: 'Vorhanden heißt: gleiche Rechnungsnummer – sie wird übersprungen.',
		fields: [
			f('number', 'Rechnungsnummer', ['rechnungsnummer', 'rechnungsnr', 'renr', 'rechnung', 'belegnummer', 'belegnr', 'nr', 'nummer'], { required: true }),
			f('kind', 'Rechnungsart', ['rechnungsart', 'belegart', 'art'], { hint: 'Rechnung, Teilrechnung oder Storno/Gutschrift' }),
			f('date', 'Rechnungsdatum', ['rechnungsdatum', 'datum', 'belegdatum', 'redatum'], { required: true }),
			f('dueDate', 'Zahlbar bis', ['zahlbarbis', 'faellig', 'faelligkeit', 'faelligam', 'zahlungsziel'], { hint: 'Leer: Rechnungsdatum plus Zahlungsziel' }),
			f('serviceFrom', 'Leistung von', ['leistungvon', 'leistungsbeginn', 'leistungsdatum']),
			f('serviceTo', 'Leistung bis', ['leistungbis', 'leistungsende']),
			f('orderNumber', 'Auftragsnummer', ['auftragsnummer', 'auftragsnr', 'auftrag'], { hint: 'Verknüpft mit dem Auftrag, wenn es ihn gibt' }),
			f('projectNumber', 'Projektnummer', ['projektnummer', 'projekt', 'projektnr']),
			f('title', 'BV', ['bv', 'bauvorhaben', 'titel', 'bezeichnung', 'objekt']),
			f('location', 'Ausführungsort', ['ausfuehrungsort', 'ort', 'baustelle', 'leistungsort']),
			f('customerName', 'Kunde', ['kunde', 'kundenname', 'firma', 'rechnungsempfaenger', 'empfaenger'], { required: true }),
			...customerAddress,
			f('customerUid', 'UID des Kunden', ['uiddeskunden', 'uid', 'kundenuid', 'uidnummer', 'ustid']),
			f('intro', 'Einleitung', ['einleitung', 'kopftext', 'einleitungstext']),
			f('closing', 'Schlusstext', ['schlusstext', 'fusstext', 'schluss']),
			f('vatRate', 'USt-Satz', ['ustsatz', 'mwstsatz', 'steuersatz', 'ust', 'mwst', 'ustprozent'], { hint: 'Leer: 20 %' }),
			f('reverseCharge', 'Reverse Charge', ['reversecharge', 'uebergangdersteuerschuld', 'steuerschuld', 'rc'], { hint: 'ja/nein' }),
			f('paid', 'Bezahlt', ['bezahlt', 'zahlungsstatus', 'beglichen'], { hint: 'ja/nein' }),
			f('paidOn', 'Bezahlt am', ['bezahltam', 'zahlungsdatum', 'zahldatum', 'zahlungseingang']),
			f('netTotal', 'Netto gesamt', ['nettogesamt', 'netto', 'nettobetrag', 'summenetto', 'betragnetto'], {
				hint: 'Nur nötig, wenn die Datei keine Positionen hat – dann wird es eine Position'
			}),
			p('posNumber', 'Pos.-Nr.', ['posnr', 'pos', 'positionsnummer', 'positionnr']),
			...positionFields,
			p('posPrice', 'Einheitspreis', ['einheitspreis', 'ep', 'preis', 'einzelpreis', 'stueckpreis'])
		]
	}
};

/** Für den Vergleich von Spaltennamen: klein, ohne Umlaute, nur Buchstaben und Ziffern */
export function normalizeHeader(s: unknown): string {
	return String(s ?? '')
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]/g, '');
}

/** Feld → Spalte (-1 = nicht übernehmen) */
export type TransferMapping = Record<string, number>;

/**
 * Zuordnung vorschlagen: erst Spalten, die genau wie das Feld heißen (so
 * passt ein Export aus dem Portal sofort), dann die üblichen anderen Namen.
 * Jede Spalte wird höchstens einmal vergeben.
 */
export function suggestMapping(kind: TransferKind, headers: unknown[]): TransferMapping {
	const norm = headers.map(normalizeHeader);
	const used = new Set<number>();
	const out: TransferMapping = {};
	const fields = TRANSFER[kind].fields;
	for (const field of fields) out[field.key] = -1;
	const take = (field: TransferField, test: (h: string) => boolean) => {
		if (out[field.key] >= 0) return;
		const i = norm.findIndex((h, idx) => !used.has(idx) && h && test(h));
		if (i >= 0) {
			out[field.key] = i;
			used.add(i);
		}
	};
	for (const field of fields) take(field, (h) => h === normalizeHeader(field.label));
	for (const field of fields) for (const alias of field.aliases) take(field, (h) => h === alias);
	return out;
}
