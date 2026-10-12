/**
 * Benachrichtigungen: welche Ereignisse es gibt und wer sie von Haus aus bekommt.
 *
 * Was tatsächlich gilt, stellt der Admin unter Verwaltung → Benachrichtigungen
 * ein – je Ereignis Gruppen und einzelne Personen. Bekommen kann eine
 * Benachrichtigung aber nur, wer das Ding auch sehen darf (`requires`); geht es
 * um eine Partie, nur die eigene Partie – außer mit dem Recht, alle zu sehen
 * (`all`). Wer etwas selbst auslöst, bekommt dazu nichts.
 */
import type { Permission, Role } from './permissions';

export interface NotificationEventDef {
	label: string;
	section: string;
	hint?: string;
	/** Ohne dieses Recht kommt nichts an – der Link würde ins Leere führen */
	requires: Permission;
	/** Ereignis einer Partie: ohne dieses Recht nur für die eigene Partie */
	all?: Permission;
	defaults: readonly Role[];
}

export const NOTIFICATION_EVENTS = {
	'anfrage.neu': {
		label: 'Neue Anfrage',
		section: 'Auftragsmanagement',
		hint: 'Eine E-Mail wurde als Anfrage angelegt',
		requires: 'anfragen.sehen',
		defaults: ['geschaeftsfuehrer', 'bauleiter']
	},
	'angebot.freigegeben': {
		label: 'Angebot freigegeben',
		section: 'Auftragsmanagement',
		hint: 'Und damit bereit für den Kunden',
		requires: 'angebote.sehen',
		defaults: ['geschaeftsfuehrer']
	},
	'angebot.angenommen': {
		label: 'Angebot vom Kunden angenommen',
		section: 'Auftragsmanagement',
		requires: 'angebote.sehen',
		defaults: ['geschaeftsfuehrer', 'bauleiter', 'buchhaltung']
	},
	'angebot.aenderung': {
		label: 'Kunde wünscht Änderungen am Angebot',
		section: 'Auftragsmanagement',
		requires: 'angebote.sehen',
		defaults: ['geschaeftsfuehrer', 'bauleiter', 'buchhaltung']
	},
	'auftrag.zugeordnet': {
		label: 'Auftrag einer Partie zugeordnet',
		section: 'Auftragsmanagement',
		hint: 'Neuer Auftrag oder Wechsel der Partie',
		requires: 'auftraege.sehen',
		all: 'auftraege.alle.sehen',
		defaults: ['partiefuehrer']
	},
	'auftrag.unterlagen': {
		label: 'Neue Pläne und Unterlagen am Auftrag',
		section: 'Auftragsmanagement',
		requires: 'auftraege.sehen',
		all: 'auftraege.alle.sehen',
		defaults: ['partiefuehrer']
	},
	'auftrag.in_arbeit': {
		label: 'Auftrag in Arbeit',
		section: 'Auftragsmanagement',
		hint: 'Die Partie hat begonnen',
		requires: 'auftraege.sehen',
		all: 'auftraege.alle.sehen',
		defaults: ['bauleiter']
	},
	'auftrag.abgeschlossen': {
		label: 'Auftrag abgeschlossen',
		section: 'Auftragsmanagement',
		hint: 'Bereit zur Rechnung',
		requires: 'auftraege.sehen',
		all: 'auftraege.alle.sehen',
		defaults: ['bauleiter', 'buchhaltung']
	},
	'rechnung.erstellt': {
		label: 'Rechnung erstellt',
		section: 'Auftragsmanagement',
		requires: 'rechnungen.sehen',
		defaults: ['geschaeftsfuehrer']
	},
	'rechnung.bezahlt': {
		label: 'Rechnung bezahlt',
		section: 'Auftragsmanagement',
		requires: 'rechnungen.sehen',
		defaults: ['geschaeftsfuehrer']
	},
	'rechnung.ueberfaellig': {
		label: 'Rechnung überfällig',
		section: 'Auftragsmanagement',
		hint: 'Am Tag nach „zahlbar bis“, einmal je Rechnung',
		requires: 'rechnungen.sehen',
		defaults: ['geschaeftsfuehrer', 'buchhaltung']
	},
	'rechnung.signatur': {
		label: 'Digitale Signatur einer Rechnung fehlgeschlagen',
		section: 'Auftragsmanagement',
		hint: 'Die Rechnung ist ausgestellt, aber nicht signiert – erneut versuchen',
		requires: 'rechnungen.sehen',
		defaults: ['admin', 'geschaeftsfuehrer', 'buchhaltung']
	},
	'rechnung.archiv': {
		label: 'Archivprüfung der Rechnungen mit Fehlern',
		section: 'Auftragsmanagement',
		hint: 'Nächtliche Prüfung: Datei fehlt, Prüfsumme oder Signatur stimmt nicht',
		requires: 'rechnungen.sehen',
		defaults: ['admin', 'geschaeftsfuehrer']
	},
	'tagesbericht.freigegeben': {
		label: 'Tagesbericht freigegeben',
		section: 'Dokumentation',
		hint: 'Wartet auf die Prüfung',
		requires: 'tagesberichte.sehen',
		all: 'tagesberichte.alle.sehen',
		defaults: ['bauleiter', 'buchhaltung']
	},
	'tagesbericht.unterschrieben': {
		label: 'Tagesbericht vom Kunden unterschrieben',
		section: 'Dokumentation',
		requires: 'tagesberichte.sehen',
		all: 'tagesberichte.alle.sehen',
		defaults: ['bauleiter', 'partiefuehrer']
	},
	'tagesbericht.geoeffnet': {
		label: 'Tagesbericht wieder geöffnet',
		section: 'Dokumentation',
		hint: 'Zum Korrigieren zurück an die Partie',
		requires: 'tagesberichte.sehen',
		all: 'tagesberichte.alle.sehen',
		defaults: ['partiefuehrer']
	},
	'stunden.freigegeben': {
		label: 'Stundenzettel freigegeben',
		section: 'Dokumentation',
		hint: 'Wartet auf die Prüfung',
		requires: 'stunden.sehen',
		all: 'stunden.alle.sehen',
		defaults: ['buchhaltung']
	},
	'stunden.geoeffnet': {
		label: 'Stundenzettel wieder geöffnet',
		section: 'Dokumentation',
		requires: 'stunden.sehen',
		all: 'stunden.alle.sehen',
		defaults: ['partiefuehrer']
	},
	'stunden.aushilfe': {
		label: 'Arbeiter hilft bei einer anderen Partie aus',
		section: 'Dokumentation',
		hint: 'An die eigene Partie des Arbeiters',
		requires: 'stunden.sehen',
		all: 'stunden.alle.sehen',
		defaults: ['partiefuehrer']
	},
	'planung.woche': {
		label: 'Wochenplan an die Partie geschickt',
		section: 'Planung',
		hint: 'Auf „An die Partien schicken" – an die eigene Partie',
		requires: 'planung.sehen',
		all: 'planung.alle.sehen',
		defaults: ['partiefuehrer', 'arbeiter']
	},
	'urlaub.beantragt': {
		label: 'Urlaub beantragt',
		section: 'Planung',
		requires: 'urlaub.genehmigen',
		defaults: ['geschaeftsfuehrer', 'bauleiter']
	},
	'urlaub.entschieden': {
		label: 'Urlaub genehmigt oder abgelehnt',
		section: 'Planung',
		hint: 'Geht immer an die Person, deren Urlaub es ist – hier nur, wer es zusätzlich bekommt',
		requires: 'urlaub.eigene.sehen',
		defaults: []
	},
	'krankenstand.gemeldet': {
		label: 'Krankenstand gemeldet',
		section: 'Planung',
		hint: 'Für die Partie nur, wenn es jemand aus der eigenen ist',
		requires: 'krankenstand.sehen',
		all: 'krankenstand.alle.sehen',
		defaults: ['geschaeftsfuehrer', 'bauleiter', 'buchhaltung', 'partiefuehrer']
	},
	'lager.mindestbestand': {
		label: 'Artikel am Mindestbestand',
		section: 'Lager',
		hint: 'Einmal je Artikel, bis er wieder darüber liegt',
		requires: 'lager.bestand.sehen',
		defaults: ['admin', 'bauleiter']
	}
} as const satisfies Record<string, NotificationEventDef>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

export function isNotificationEvent(v: string): v is NotificationEvent {
	return v in NOTIFICATION_EVENTS;
}

/** Ereignisse nach Abschnitt, in der Reihenfolge des Katalogs */
export function eventSections(): [string, NotificationEvent[]][] {
	const out = new Map<string, NotificationEvent[]>();
	for (const key of NOTIFICATION_EVENT_KEYS) {
		const s = NOTIFICATION_EVENTS[key].section;
		out.set(s, [...(out.get(s) ?? []), key]);
	}
	return [...out.entries()];
}

export interface Recipient {
	id: number;
	role: Role;
	partyId: number | null;
}

/**
 * Darf diese Person die Benachrichtigung bekommen? Sie muss das Ding sehen
 * dürfen; bei einer Partie nur die eigene, außer sie sieht alle. Ohne Partie am
 * Ereignis bleibt es bei denen, die alle sehen.
 */
export function mayReceive(
	r: Recipient,
	event: NotificationEvent,
	partyId: number | null | undefined,
	can: (role: Role, p: Permission) => boolean
): boolean {
	const def: NotificationEventDef = NOTIFICATION_EVENTS[event];
	if (!can(r.role, def.requires)) return false;
	if (!def.all) return true;
	if (can(r.role, def.all)) return true;
	return partyId != null && r.partyId === partyId;
}
