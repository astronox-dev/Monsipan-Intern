import { db } from './db';
import { settings } from './db/schema';
import { ROLES, type Role } from '$lib/permissions';

export interface AppSettings {
	/**
	 * Früher „Warn-Mails zum Mindestbestand" – nur noch, um die Auswahl einmal in
	 * die Info-Mails unter Benachrichtigungen zu übernehmen
	 */
	alertRoles: Role[];
	alertEmailsEnabled: boolean;
	/** Vorlagen für neue Angebote – im einzelnen Angebot änderbar */
	offerIntro: string;
	offerClosing: string;
	/** Fußzeile der Angebote: drei Spalten */
	offerFooterAddress: string;
	offerFooterBank: string;
	offerFooterContact: string;
	/** Briefkopf als Bild (Dateiname unter /data/briefkopf) – ohne Bild wird er aus Text gesetzt */
	letterheadFile: string | null;
	/** Einleitung und Schlusstext im Auftrags-PDF – für alle Aufträge gleich */
	orderIntro: string;
	orderClosing: string;
	/** Vorlagen für neue Rechnungen – in der einzelnen Rechnung änderbar */
	invoiceIntro: string;
	invoiceClosing: string;
	/** Zahlungsziel in Tagen ab Rechnungsdatum */
	invoicePaymentDays: number;
}

const DEFAULTS: AppSettings = {
	alertRoles: ['admin', 'bauleiter'],
	alertEmailsEnabled: true,
	offerIntro: 'Sehr geehrte Damen und Herren,\nwir danken für Ihre Anfrage und bieten die Arbeiten nachstehend gerne an:',
	offerClosing:
		'Die angebotenen Preise gelten auf heutiger Kostenbasis und beinhalten sämtliche Lohn- und Nebenkosten sowie die Beistellung der erforderlichen Geräte, Werkzeuge und Materialien.\nBei unserer Kalkulation sind wir davon ausgegangen, dass die Markierungen zu Normalarbeitszeiten durchgeführt werden können.',
	offerFooterAddress: 'Monsipan Bautenschutz GesmbH\nHimberger Straße 76\n2320 Schwechat\nUID-Nummer: ATU14230606',
	offerFooterBank: 'AT47 1200 0006 1620 5407\nBKAUATWW',
	offerFooterContact: 'office@monsipan.com\nTel. 01/706 2006',
	letterheadFile: null,
	orderIntro: '',
	orderClosing: '',
	invoiceIntro: 'Sehr geehrte Damen und Herren,\nfür die ausgeführten Arbeiten erlauben wir uns, wie folgt in Rechnung zu stellen:',
	invoiceClosing: 'Wir danken für Ihren Auftrag und freuen uns auf die weitere Zusammenarbeit.',
	invoicePaymentDays: 30
};

let cache: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
	if (cache) return cache;
	const rows = await db.select().from(settings).all();
	const out: AppSettings = { ...DEFAULTS };
	for (const r of rows) {
		// Nur bekannte Einstellungen – in derselben Tabelle liegen auch Schlüssel (Push), die nicht ins Formular gehören
		if (!(r.key in DEFAULTS)) continue;
		try {
			(out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
		} catch {
			/* kaputte Einträge ignorieren */
		}
	}
	out.alertRoles = out.alertRoles.filter((r) => (ROLES as readonly string[]).includes(r));
	cache = out;
	return out;
}

/** Nach dem Einspielen einer Sicherung: gemerkte Einstellungen verwerfen */
export function clearSettingsCache() {
	cache = null;
}

export async function updateSettings(patch: Partial<AppSettings>) {
	for (const [key, value] of Object.entries(patch)) {
		const json = JSON.stringify(value);
		await db.insert(settings).values({ key, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } });
	}
	cache = null;
}
