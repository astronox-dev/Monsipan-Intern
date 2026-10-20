import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'positionen-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { offers, users } = await import('$lib/server/db/schema');
const { offerDetail, positionMemory, saveOffer } = await import('./offers');
const { createOrderFromOffer, orderDetail } = await import('./orders');
const { invoiceDraft, invoiceNotice, draftLines } = await import('./invoices');
const { contentHash } = await import('./signatur/archive');

type Line = { kind: 'position' | 'titel'; text: string; note?: string; quantity: string; unit: string; unitPrice: string };

const head = (number: string) => ({
	number,
	date: '2026-10-20',
	title: 'Test',
	location: '',
	customerId: null,
	customerName: 'Kunde',
	customerAddition: '',
	customerStreet: '',
	customerZip: '',
	customerCity: '',
	customerUid: '',
	intro: '',
	closing: '',
	vatRate: 20
});

async function offerWith(number: string, lines: Line[]) {
	const row = await db.insert(offers).values({ number, date: '2026-10-20' }).returning({ id: offers.id }).get();
	await saveOffer(row.id, { head: head(number), lines });
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

describe('Bemerkung zur Position', () => {
	it('geht vom Angebot in den Auftrag und in den Rechnungsentwurf', async () => {
		const id = await offerWith('26700', [
			{ kind: 'titel', text: 'Werkstättenring', note: 'bei Überschriften nicht', quantity: '', unit: '', unitPrice: '' },
			{ kind: 'position', text: 'Leitlinie 15 cm weiß', note: '  inkl. Vorreinigung  ', quantity: '100', unit: 'lfm', unitPrice: '2,5' },
			{ kind: 'position', text: 'Sperrfläche', quantity: '1', unit: 'Pauschal', unitPrice: '300' }
		]);
		const offer = (await offerDetail(id))!;
		expect(offer.lines.map((l) => l.note)).toEqual(['', 'inkl. Vorreinigung', '']);

		await db.update(offers).set({ status: 'angenommen' }).where(eq(offers.id, id));
		const me = (await db.select({ id: users.id }).from(users).get())!.id;
		const orderId = (await createOrderFromOffer(id, null, '', me))!;
		expect((await orderDetail(orderId))!.lines.map((l) => l.note)).toEqual(['', 'inkl. Vorreinigung', '']);

		// Rechnung als Entwurf – auch wenn der Auftrag noch nicht begonnen hat
		const draft = (await invoiceDraft(orderId))!;
		expect(draft.notice).toContain('noch nicht begonnen');
		const lines = draftLines(draft);
		expect(lines.find((l) => l.text === 'Leitlinie 15 cm weiß')?.note).toBe('inkl. Vorreinigung');
		// Ohne Bemerkung kommt das Feld gar nicht erst dazu
		expect('note' in lines.find((l) => l.text === 'Sperrfläche')!).toBe(false);
	});

	it('ändert die Prüfsumme älterer Rechnungen nicht – zählt nur, wenn eine da ist', () => {
		const base = {
			number: '26001',
			kind: 'rechnung',
			date: '2026-10-20',
			dueDate: '2026-11-19',
			serviceFrom: null,
			serviceTo: null,
			projectNumber: '',
			title: 'Test',
			location: '',
			customerName: 'Kunde',
			customerAddition: '',
			customerStreet: '',
			customerZip: '',
			customerCity: '',
			customerUid: '',
			intro: '',
			closing: '',
			state: '',
			section: '',
			vatRate: 20,
			reverseCharge: false
		};
		const line = { number: '1', kind: 'position', text: 'Leitlinie', quantity: 100, unit: 'lfm', unitPrice: 2.5 };
		const before = contentHash({ ...base, lines: [line] });
		expect(contentHash({ ...base, lines: [{ ...line, note: '' }] })).toBe(before);
		expect(contentHash({ ...base, lines: [{ ...line, note: 'inkl. Vorreinigung' }] })).not.toBe(before);
	});
});

describe('Rechnung aus jedem Stand', () => {
	it('sperrt nichts – sagt nur, was zu prüfen ist', () => {
		expect(invoiceNotice({ status: 'erstellt', previous: 0, available: 0 })).toContain('noch nicht begonnen');
		expect(invoiceNotice({ status: 'in_arbeit', previous: 0, available: 0 })).toContain('Noch kein geprüfter Tagesbericht');
		expect(invoiceNotice({ status: 'in_arbeit', previous: 1, available: 0 })).toContain('schon abgerechnet');
		expect(invoiceNotice({ status: 'in_arbeit', previous: 0, available: 2 })).toBeNull();
		expect(invoiceNotice({ status: 'abgeschlossen', previous: 0, available: 0 })).toBeNull();
	});
});

describe('Positionen merken', () => {
	it('je Bezeichnung einmal, mit Einheit, Preis und Bemerkung vom letzten Mal – die häufigsten zuerst', async () => {
		await offerWith('26710', [
			{ kind: 'position', text: 'Haltelinie 50 cm', quantity: '2', unit: 'stk', unitPrice: '40' },
			{ kind: 'position', text: 'Pfeil Geradeaus', quantity: '1', unit: 'stk', unitPrice: '55' }
		]);
		await offerWith('26711', [
			{ kind: 'position', text: 'Haltelinie 50 cm', note: 'Thermoplast', quantity: '3', unit: 'stk', unitPrice: '45' },
			{ kind: 'titel', text: 'Überschrift kommt nicht vor', quantity: '', unit: '', unitPrice: '' },
			{ kind: 'position', text: '', quantity: '1', unit: 'stk', unitPrice: '10' }
		]);
		const memory = await positionMemory();
		const halt = memory.find((m) => m.text === 'Haltelinie 50 cm')!;
		expect(halt).toEqual({ text: 'Haltelinie 50 cm', note: 'Thermoplast', unit: 'stk', unitPrice: 45, uses: 2 });
		expect(memory.some((m) => m.text === 'Überschrift kommt nicht vor' || m.text === '')).toBe(false);
		expect(memory[0].uses).toBeGreaterThanOrEqual(memory[memory.length - 1].uses);
		expect(memory.indexOf(halt)).toBeLessThan(memory.findIndex((m) => m.text === 'Pfeil Geradeaus'));
	});
});
