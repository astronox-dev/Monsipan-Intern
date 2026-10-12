/**
 * Einstellungen der Rechnungssignatur – in der Tabelle „settings" unter dem
 * Schlüssel „signatur". Geheimnisse (Schlüsselpasswort, Client-Secret, PIN,
 * Zugang zum Zeitstempeldienst) stehen nie hier, sondern ausschließlich in
 * Umgebungsvariablen des Containers.
 */
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { DATA_DIR, db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { PADES_LEVELS, type PadesLevel } from './pades';

export interface CscSettings {
	/** Vorlage: A-Trust oder ein anderer Anbieter mit CSC-API */
	preset: 'a-trust' | 'andere';
	/** Basisadresse der CSC-API, z. B. https://…/csc/v1 */
	baseUrl: string;
	version: 'v1' | 'v2';
	/** OAuth2 (Client Credentials) oder Benutzer/Passwort über /auth/login */
	auth: 'oauth2' | 'basic';
	/** Token-Adresse für OAuth2 */
	tokenUrl: string;
	/** Client-ID bzw. Benutzername – das Geheimnis dazu steht in SIGNATUR_CSC_SECRET */
	clientId: string;
	/** Kennung des Siegels beim Anbieter (credentialID) */
	credentialId: string;
}

export interface SignatureSettings {
	/** Ausgestellte Rechnungen digital signieren */
	enabled: boolean;
	provider: 'lokal' | 'csc';
	level: PadesLevel;
	/** Zeitstempeldienst nach RFC 3161 */
	tsaUrl: string;
	/** Öffentliche Prüfseite und Prüfcode auf der Rechnung */
	verifyEnabled: boolean;
	/** Adresse für den Prüfcode, z. B. https://portal.monsipan.at – leer: ORIGIN */
	verifyBaseUrl: string;
	/** Aufbewahrung in Jahren (BAO: 7) */
	retentionYears: number;
	/** Steht als Grund und Ort in der Signatur */
	reason: string;
	location: string;
	csc: CscSettings;
}

export const SIGNATURE_DEFAULTS: SignatureSettings = {
	enabled: false,
	provider: 'lokal',
	level: 'B-LT',
	tsaUrl: 'http://timestamp.digicert.com',
	verifyEnabled: true,
	verifyBaseUrl: '',
	retentionYears: 7,
	reason: 'Rechnung elektronisch gesiegelt',
	location: 'Schwechat',
	csc: { preset: 'a-trust', baseUrl: '', version: 'v1', auth: 'oauth2', tokenUrl: '', clientId: '', credentialId: '' }
};

const KEY = 'signatur';

export async function signatureSettings(): Promise<SignatureSettings> {
	const row = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
	let stored: Partial<SignatureSettings> = {};
	try {
		stored = row ? JSON.parse(row.value) : {};
	} catch {
		/* kaputter Eintrag – Standard */
	}
	const s: SignatureSettings = { ...SIGNATURE_DEFAULTS, ...stored, csc: { ...SIGNATURE_DEFAULTS.csc, ...(stored.csc ?? {}) } };
	if (!PADES_LEVELS.includes(s.level)) s.level = SIGNATURE_DEFAULTS.level;
	if (s.provider !== 'lokal' && s.provider !== 'csc') s.provider = 'lokal';
	s.retentionYears = Math.min(50, Math.max(7, Math.round(Number(s.retentionYears) || 7)));
	return s;
}

export async function saveSignatureSettings(s: SignatureSettings) {
	const value = JSON.stringify(s);
	await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Geheimnisse und Pfade aus der Umgebung */
export const secrets = {
	keyPassword: () => env.SIGNATUR_PASSWORT ?? '',
	keyFile: () => env.SIGNATUR_DATEI || path.join(DATA_DIR, 'signatur', 'siegel.pem'),
	cscSecret: () => env.SIGNATUR_CSC_SECRET ?? '',
	cscPin: () => env.SIGNATUR_CSC_PIN ?? '',
	tsaUser: () => env.SIGNATUR_TSA_BENUTZER ?? '',
	tsaPassword: () => env.SIGNATUR_TSA_PASSWORT ?? ''
};

/** Welche Umgebungsvariablen gesetzt sind – für die Einstellungsseite, ohne Werte */
export function secretStatus() {
	return {
		keyPassword: secrets.keyPassword().length >= 12,
		cscSecret: !!secrets.cscSecret(),
		cscPin: !!secrets.cscPin(),
		tsaAuth: !!secrets.tsaUser()
	};
}

/** Basisadresse für Prüfcode und Links */
export function verifyBase(s: SignatureSettings, fallback: string): string {
	return (s.verifyBaseUrl || env.ORIGIN || fallback).replace(/\/+$/, '');
}
