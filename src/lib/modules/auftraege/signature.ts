/**
 * Ausstellen, Signieren und Prüfen von Rechnungen – Bezeichnungen für
 * Oberfläche, Prüfseite und Protokoll (läuft auch im Browser).
 */

/** Entwurf → ausgestellt → (Signierung läuft) → signiert bzw. fehlgeschlagen; jederzeit danach storniert */
export const INVOICE_STAGES = ['entwurf', 'ausgestellt', 'signierung', 'signiert', 'fehlgeschlagen', 'storniert'] as const;
export type InvoiceStage = (typeof INVOICE_STAGES)[number];

export const INVOICE_STAGE_LABELS: Record<InvoiceStage, { label: string; tone: string }> = {
	entwurf: { label: 'Entwurf', tone: '' },
	ausgestellt: { label: 'Ausgestellt', tone: 'badge-info' },
	signierung: { label: 'Signierung läuft', tone: 'badge-info' },
	signiert: { label: 'Signiert', tone: 'badge-ok' },
	fehlgeschlagen: { label: 'Signierung fehlgeschlagen', tone: 'badge-danger' },
	storniert: { label: 'Storniert', tone: 'badge-warn' }
};

export const isIssued = (stage: string) => stage !== 'entwurf';

export const PADES_LEVEL_LABELS: Record<string, string> = {
	'B-B': 'PAdES-B-B (Basis)',
	'B-T': 'PAdES-B-T (mit Zeitstempel)',
	'B-LT': 'PAdES-B-LT (Langzeitvalidierung)',
	'B-LTA': 'PAdES-B-LTA (Langzeitarchivierung)'
};

export const PROVIDER_LABELS: Record<string, string> = {
	lokal: 'Eigenes Zertifikat (Datei am Server)',
	csc: 'Vertrauensdiensteanbieter über CSC-API (z. B. A-Trust)'
};

/** Ergebnis einer Prüfung – so steht es auch auf der öffentlichen Prüfseite */
export const CHECK_RESULTS = ['gueltig', 'ungueltig', 'storniert', 'unbekannt'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const CHECK_LABELS: Record<CheckResult, { label: string; text: string; tone: string }> = {
	gueltig: {
		label: 'Rechnung gültig',
		text: 'Die gespeicherte Rechnung ist unverändert und die digitale Signatur wurde erfolgreich überprüft.',
		tone: 'ok'
	},
	ungueltig: {
		label: 'Signatur ungültig',
		text: 'Die Integrität oder die digitale Signatur konnte nicht erfolgreich bestätigt werden.',
		tone: 'danger'
	},
	storniert: {
		label: 'Rechnung storniert',
		text: 'Die Rechnung wurde ursprünglich ausgestellt, ist inzwischen jedoch storniert.',
		tone: 'warn'
	},
	unbekannt: {
		label: 'Verifizierung nicht möglich',
		text: 'Der Signaturstatus konnte nicht zuverlässig festgestellt werden.',
		tone: 'muted'
	}
};

/** Was im Protokoll steht */
export const AUDIT_LABELS: Record<string, string> = {
	erstellt: 'Entwurf angelegt',
	geaendert: 'Entwurf geändert',
	geloescht: 'Entwurf gelöscht',
	ausgestellt: 'Endgültig ausgestellt',
	archiviert: 'Original archiviert',
	signierung: 'Signierung gestartet',
	signiert: 'Digital signiert',
	fehlgeschlagen: 'Signierung fehlgeschlagen',
	geprueft: 'Signatur geprüft',
	pruefung_fehler: 'Prüfung fehlgeschlagen',
	heruntergeladen: 'Archivierte Rechnung heruntergeladen',
	storniert: 'Storniert',
	storno: 'Stornorechnung ausgestellt',
	bezahlt: 'Als bezahlt markiert',
	offen: 'Wieder offen',
	einstellungen: 'Signatur-Einstellungen geändert',
	zertifikat: 'Zertifikat hinterlegt',
	verbindungstest: 'Verbindung getestet',
	archivpruefung: 'Archiv geprüft'
};

/** Prüfcode auf der Rechnung: wohin er zeigt */
export const verifyPath = (token: string) => `/pruefen/${token}`;
