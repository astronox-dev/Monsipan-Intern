import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'info-mail-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false', ORIGIN: 'https://portal.example' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

// Mails nicht verschicken, sondern mitschreiben
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock('$lib/server/mail', async (original) => ({
	...(await original<typeof import('$lib/server/mail')>()),
	isMailConfigured: () => true,
	sendMail: async (m: { to: string; subject: string; text: string }) => (sent.push(m), true)
}));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { users } = await import('$lib/server/db/schema');
const { updateSettings } = await import('$lib/server/settings');
const { mailRecipientsFor, myNotificationEvents, notificationSettings, notify, resetNotificationSettings, saveNotificationSettings, setMuted } = await import(
	'./notifications'
);

let n = 0;
async function person(role: 'admin' | 'geschaeftsfuehrer' | 'bauleiter' | 'buchhaltung' | 'partiefuehrer', email: string | null) {
	const row = await db
		.insert(users)
		.values({ username: `mail${++n}`, firstName: 'Test', lastName: String(n), passwordHash: 'x', role, email })
		.returning({ id: users.id })
		.get();
	return row.id;
}

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Info-Mails', () => {
	it('übernimmt beim ersten Mal die bisherigen Warn-Mails zum Mindestbestand', async () => {
		await updateSettings({ alertEmailsEnabled: true, alertRoles: ['buchhaltung'] });
		const mail = await notificationSettings('mail');
		expect(mail.roles['lager.mindestbestand']).toEqual(['buchhaltung']);
		expect(mail.roles['rechnung.ueberfaellig']).toEqual([]);
		// Glocke und Push bleiben, wie sie sind
		expect((await notificationSettings('push')).roles['lager.mindestbestand'].sort()).toEqual(['admin', 'bauleiter']);
		// Zurücksetzen: die Vorgaben aus dem Katalog
		await resetNotificationSettings();
		expect((await notificationSettings('mail')).roles['lager.mindestbestand'].sort()).toEqual(['admin', 'bauleiter']);
	});

	it('gehen an die ausgewählten Gruppen und Personen mit E-Mail – abgeschaltet nicht', async () => {
		const chef = await person('geschaeftsfuehrer', 'Chef@Firma.at');
		const ohne = await person('geschaeftsfuehrer', null);
		const buero = await person('buchhaltung', 'buero@firma.at');
		const partie = await person('partiefuehrer', 'partie@firma.at');
		await saveNotificationSettings(
			new Set(['rechnung.ueberfaellig|geschaeftsfuehrer']),
			new Set([`rechnung.ueberfaellig|${buero}`, `rechnung.ueberfaellig|${partie}`]),
			'mail'
		);
		// Partieführer sehen keine Rechnungen – auch persönlich eingetragen nicht
		expect(await mailRecipientsFor({ event: 'rechnung.ueberfaellig' })).toEqual(['chef@firma.at', 'buero@firma.at']);
		expect(ohne).toBeGreaterThan(0);

		await setMuted(buero, 'rechnung.ueberfaellig', true, 'mail');
		expect(await mailRecipientsFor({ event: 'rechnung.ueberfaellig' })).toEqual(['chef@firma.at']);
		// Der Auslöser bekommt nichts
		expect(await mailRecipientsFor({ event: 'rechnung.ueberfaellig', actorId: chef })).toEqual([]);

		// Push abschalten ändert an der Mail nichts – und umgekehrt
		await setMuted(chef, 'rechnung.ueberfaellig', true, 'push');
		expect(await mailRecipientsFor({ event: 'rechnung.ueberfaellig' })).toEqual(['chef@firma.at']);
		const mine = await myNotificationEvents({ id: buero, role: 'buchhaltung', partyId: null });
		expect(mine.mail.find((e) => e.event === 'rechnung.ueberfaellig')).toMatchObject({ muted: true, viaGroup: false });
	});

	it('fest genannte Empfänger bekommen die Mail auch ohne Auswahl', async () => {
		const angelegt = await person('bauleiter', 'bau@firma.at');
		expect(await mailRecipientsFor({ event: 'angebot.aenderung' })).toEqual([]);
		expect(await mailRecipientsFor({ event: 'angebot.aenderung', mailUserIds: [angelegt] })).toEqual(['bau@firma.at']);
	});

	it('verschickt je Person eine Mail mit Link ins Portal', async () => {
		sent.length = 0;
		notify({ event: 'rechnung.ueberfaellig', title: 'Rechnung 26 001 überfällig', body: 'Strabag AG · € 120,00', url: '/rechnungen/1' });
		await vi.waitFor(() => expect(sent.length).toBe(1));
		expect(sent[0]).toMatchObject({ to: 'chef@firma.at', subject: 'Rechnung 26 001 überfällig' });
		expect(sent[0].text).toContain('https://portal.example/rechnungen/1');
		expect(sent[0].text).toContain('Strabag AG');
	});
});
