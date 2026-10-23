/**
 * Benachrichtigungen: welche Ereignisse es gibt und wer sie von Haus aus bekommt.
 *
 * Zwei Wege: unter der Glocke samt Push, und als Info-Mail. Was tatsächlich
 * gilt, stellt der Admin unter Verwaltung → Benachrichtigungen ein – je Weg und
 * Ereignis Gruppen und einzelne Personen. Bekommen kann eine
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
	/** Glocke und Push von Haus aus */
	defaults: readonly Role[];
	/** Info-Mail von Haus aus – ohne Angabe niemand */
	mailDefaults?: readonly Role[];
	/** Wer die Info-Mail außerdem immer bekommt (Hinweis für die Einstellungen) */
	mailAlways?: string;
}

export const NOTIFICATION_CHANNELS = ['push', 'mail'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const CHANNEL_LABELS: Record<NotificationChannel, string> = { push: 'Glocke und Push', mail: 'Info-Mail' };

export const NOTIFICATION_EVENTS = {
	'anfrage.neu': {
		label: 'Neue Anfrage',
		section: 'Auftragsmanagement',
		hint: 'Eine E-Mail wurde als Anfrage angelegt oder kam über das Kontaktformular der Webseite',
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
		defaults: ['geschaeftsfuehrer', 'bauleiter', 'buchhaltung'],
		mailAlways: 'Nimmt der Kunde über den Link an, geht die Info-Mail immer auch an die Person, die das Angebot angelegt bzw. freigegeben hat'
	},
	'angebot.aenderung': {
		label: 'Kunde wünscht Änderungen am Angebot',
		section: 'Auftragsmanagement',
		requires: 'angebote.sehen',
		defaults: ['geschaeftsfuehrer', 'bauleiter', 'buchhaltung'],
		mailAlways: 'Die Info-Mail geht immer auch an die Person, die das Angebot angelegt bzw. freigegeben hat'
	},
	'auftrag.zugeordnet': {
		label: 'Arbeitsauftrag für eine Partie',
		section: 'Auftragsmanagement',
		hint: 'Neuer Arbeitsauftrag oder Wechsel der Partie',
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
	'planung.einteilung': {
		label: 'Bei einer anderen Partie eingeteilt',
		section: 'Planung',
		hint: 'Geht an die Person, die in der Wochenplanung (für eine Woche oder einzelne Tage) zu einer anderen Partie kommt – oder wieder zurück',
		requires: 'planung.sehen',
		defaults: []
	},
	'planung.partiefuehrer': {
		label: 'Vorübergehend Partieführer',
		section: 'Planung',
		hint: 'Geht an die Person, die in der Wochenplanung vorübergehend zum Partieführer gemacht wird – oder es nicht mehr ist',
		requires: 'planung.sehen',
		defaults: []
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
		defaults: ['admin', 'bauleiter'],
		mailDefaults: ['admin', 'bauleiter']
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
