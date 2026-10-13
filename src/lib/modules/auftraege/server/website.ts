/**
 * Anfragen von der eigenen Webseite (monsipan.at, Repo Monsipan-Webseite): Deren
 * Kontaktformular (kontakt.php) schickt jede Anfrage nach seinen Spamprüfungen
 * als JSON an POST /api/anfragen/webseite – mit dem Schlüssel von hier als
 * Bearer-Token. Daraus wird eine Anfrage wie aus einer eingefügten E-Mail.
 *
 * Der Schlüssel entsteht unter Verwaltung → Einstellungen und kommt dort samt
 * Adresse des Portals in den Stack der Webseite (PORTAL_URL, PORTAL_KEY).
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { today } from '$lib/modules/stunden/week';
import { readWebsiteInquiry, websiteInquiryText } from '../inquiry';
import { createInquiry, matchCustomer } from './inquiries';
import { notifyInquiry } from './notify';

const SETTING = 'website_inquiries';

export const WEBSITE_SOURCE = 'webseite';

export interface WebsiteLink {
	key: string;
	/** Zuletzt eine Anfrage angekommen (ms) */
	lastAt: number | null;
}

export async function websiteLink(): Promise<WebsiteLink | null> {
	const row = await db.select().from(settings).where(eq(settings.key, SETTING)).get();
	if (!row) return null;
	try {
		const v = JSON.parse(row.value) as Partial<WebsiteLink>;
		return typeof v.key === 'string' && v.key ? { key: v.key, lastAt: typeof v.lastAt === 'number' ? v.lastAt : null } : null;
	} catch {
		return null;
	}
}

async function store(link: WebsiteLink | null) {
	if (!link) {
		await db.delete(settings).where(eq(settings.key, SETTING));
		return;
	}
	const value = JSON.stringify(link);
	await db.insert(settings).values({ key: SETTING, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Neuer Schlüssel – der alte gilt ab sofort nicht mehr */
export async function newWebsiteKey(): Promise<string> {
	const key = crypto.randomBytes(32).toString('base64url');
	await store({ key, lastAt: (await websiteLink())?.lastAt ?? null });
	return key;
}

export async function disconnectWebsite() {
	await store(null);
}

/** Passt der mitgeschickte Schlüssel? Vergleich in gleicher Zeit, egal wo er abweicht */
export async function isWebsiteKey(token: string): Promise<boolean> {
	const link = await websiteLink();
	if (!link || !token) return false;
	const hash = (s: string) => crypto.createHash('sha256').update(s).digest();
	return crypto.timingSafeEqual(hash(token), hash(link.key));
}

/** Anfrage anlegen und Bescheid geben – bei ungültigen Daten der Grund als Text */
export async function receiveWebsiteInquiry(raw: unknown): Promise<{ id: number } | { problem: string }> {
	const w = readWebsiteInquiry(raw);
	if (typeof w === 'string') return { problem: w };
	const { subject, body } = websiteInquiryText(w);
	const data = {
		receivedOn: today(),
		subject,
		body,
		senderName: w.name,
		senderEmail: w.email,
		senderPhone: w.phone,
		senderCompany: w.company,
		customerId: await matchCustomer(w.email),
		location: '',
		note: ''
	};
	const id = await createInquiry(null, data, WEBSITE_SOURCE);
	const link = await websiteLink();
	if (link) await store({ ...link, lastAt: Date.now() });
	notifyInquiry({ id, ...data, source: WEBSITE_SOURCE });
	return { id };
}
