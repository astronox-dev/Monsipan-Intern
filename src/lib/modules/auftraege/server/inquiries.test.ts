import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anfragen-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { inquiries, offers, users } = await import('$lib/server/db/schema');
const { eq } = await import('drizzle-orm');
const { closeInquiry, countInquiries, inquiryDetail, listInquiries, setInquiryInProgress } = await import('./inquiries');

let n = 0;
async function inquiry(subject: string, offerStatus?: 'entwurf' | 'freigegeben' | 'angenommen') {
	const offer = offerStatus
		? await db
				.insert(offers)
				.values({ number: `26${String(++n).padStart(3, '0')}`, date: '2026-10-13', status: offerStatus })
				.returning({ id: offers.id })
				.get()
		: null;
	const row = await db
		.insert(inquiries)
		.values({ receivedOn: '2026-10-13', subject, offerId: offer?.id ?? null })
		.returning({ id: inquiries.id })
		.get();
	return row.id;
}

const subjects = async (state: string) => (await listInquiries({ state })).map((i) => i.subject).sort();

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

describe('Stand der Anfragen', () => {
	it('Neu, In Arbeit (von Hand oder Angebot im Entwurf), Ausstehend, Erledigt', async () => {
		const me = (await db.select({ id: users.id }).from(users).get())!.id;
		await inquiry('Neu');
		const working = await inquiry('Von Hand in Arbeit');
		await setInquiryInProgress(working, me);
		await inquiry('Angebot im Entwurf', 'entwurf');
		await inquiry('Angebot beim Kunden', 'freigegeben');
		await inquiry('Angenommen', 'angenommen');
		const closed = await inquiry('Abgelegt');
		await closeInquiry(closed, true);

		expect(await subjects('neu')).toEqual(['Neu']);
		expect(await subjects('inarbeit')).toEqual(['Angebot im Entwurf', 'Von Hand in Arbeit']);
		expect(await subjects('offen')).toEqual(['Angebot beim Kunden', 'Angebot im Entwurf', 'Neu', 'Von Hand in Arbeit']);
		expect(await subjects('erledigt')).toEqual(['Abgelegt', 'Angenommen']);
		// Unbekannter Stand: die offenen
		expect(await subjects('irgendwas')).toEqual(await subjects('offen'));
		expect(await countInquiries()).toMatchObject({ open: 4, neu: 1, working: 2, done: 2, fresh: 2 });

		const detail = await inquiryDetail(working);
		expect(detail?.inProgressAt).toBeInstanceOf(Date);
		expect(detail?.workerFirst).toBeTruthy();
	});

	it('zurück auf Neu – und wer in Arbeit hatte, darf gelöscht werden', async () => {
		const id = await inquiry('Wieder neu');
		const helper = await db
			.insert(users)
			.values({ username: 'aushilfe', firstName: 'Aus', lastName: 'Hilfe', passwordHash: 'x', role: 'buchhaltung' })
			.returning({ id: users.id })
			.get();
		await setInquiryInProgress(id, helper.id);
		expect(await subjects('inarbeit')).toContain('Wieder neu');
		await db.delete(users).where(eq(users.id, helper.id));
		// Ohne Person bleibt sie in Arbeit
		expect((await inquiryDetail(id))?.workerFirst).toBeNull();
		await setInquiryInProgress(id, null);
		expect(await subjects('neu')).toContain('Wieder neu');
	});
});
