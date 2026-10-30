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
const { closeInquiry, countInquiries, inquiryDetail, listInquiries, offerFromInquiry, openInquiryCount } = await import('./inquiries');

async function inquiry(subject: string) {
	const row = await db.insert(inquiries).values({ receivedOn: '2026-10-13', subject }).returning({ id: inquiries.id }).get();
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
	it('offen oder erledigt – erledigt mit Angebot oder von Hand abgelegt', async () => {
		await inquiry('Neu');
		const closed = await inquiry('Abgelegt');
		await closeInquiry(closed, true);

		expect(await subjects('offen')).toEqual(['Neu']);
		expect(await subjects('erledigt')).toEqual(['Abgelegt']);
		// Unbekannter Stand: die offenen
		expect(await subjects('irgendwas')).toEqual(await subjects('offen'));
		expect(await countInquiries()).toEqual({ open: 1, done: 1 });
		expect(await openInquiryCount()).toBe(1);

		await closeInquiry(closed, false);
		expect(await subjects('offen')).toEqual(['Abgelegt', 'Neu']);
	});

	it('mit dem Angebot ist die Anfrage erledigt', async () => {
		const id = await inquiry('Mit Angebot');
		const me = await db.select().from(users).get();
		const detail = (await inquiryDetail(id))!;
		const offerId = await offerFromInquiry({ ...me!, effectiveRole: me!.role } as never, detail, {
			number: 'A-' + id,
			projectNumber: '',
			date: '2026-10-13',
			title: 'Bodenmarkierungen',
			customerId: null
		});
		const after = (await inquiryDetail(id))!;
		expect(after.offerId).toBe(offerId);
		expect(after.closedAt).toBeInstanceOf(Date);
		expect(await subjects('erledigt')).toContain('Mit Angebot');
		await db.delete(offers).where(eq(offers.id, offerId));
		// Angebot wieder gelöscht: bleibt erledigt, bis jemand sie wieder öffnet
		expect(await subjects('erledigt')).toContain('Mit Angebot');
	});
});
