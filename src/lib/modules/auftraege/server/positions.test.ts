import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'positionen-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { invoices, offers, users } = await import('$lib/server/db/schema');
const { createOffer, listOffers, offerDetail, positionMemory, releaseProblem, saveOffer } = await import('./offers');
const { createCustomer } = await import('./customers');
const { createOrderFromOffer, orderDetail } = await import('./orders');
const { invoiceDraft, invoiceNotice, draftLines } = await import('./invoices');
const { contentHash } = await import('./signatur/archive');
const { afterSkonto, lineTotal, money, offerTotals, paymentTermsText, readPaymentTerms, shownTotal } = await import('../offer');

type Line = { kind: 'position' | 'titel'; text: string; note?: string; quantity: string; unit: string; unitPrice: string; alternative?: boolean };

/** Angebot annehmen und den Auftrag dazu erstellen */
async function orderOf(offerId: number) {
	await db.update(offers).set({ status: 'angenommen' }).where(eq(offers.id, offerId));
	const me = (await db.select({ id: users.id }).from(users).get())!.id;
	return (await createOrderFromOffer(offerId, null, '', me))!;
}

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
	vatRate: 20,
	reverseCharge: false,
	paymentDays: 30,
	skontoPercent: 0,
	skontoDays: 0
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

describe('Alternativpositionen', () => {
	it('stehen mit Menge und Preis da, der GP ist 0 und zählt nicht – auch nicht in Liste, Auftrag und Rechnungsentwurf', async () => {
		const id = await offerWith('26720', [
			{ kind: 'position', text: 'Bodenmarkierung', quantity: '10', unit: 'm²', unitPrice: '20' },
			{ kind: 'position', text: 'Vortrocknen', alternative: true, quantity: '300', unit: 'lfm', unitPrice: '1' },
			{ kind: 'position', text: 'Absicherung', alternative: true, quantity: '1', unit: 'Pauschal', unitPrice: '150' },
			{ kind: 'titel', text: 'Überschrift bleibt Überschrift', alternative: true, quantity: '', unit: '', unitPrice: '' }
		]);
		const offer = (await offerDetail(id))!;
		expect(offer.lines.map((l) => l.alternative)).toEqual([false, true, true, false]);
		expect(lineTotal(offer.lines[1])).toBe(300);
		expect(shownTotal(offer.lines[1])).toBe(0);
		expect(offerTotals(offer.lines, 20)).toEqual({ net: 200, vat: 40, gross: 240 });
		expect((await listOffers({}, 500)).find((o) => o.number === '26720')?.net).toBe(200);

		const orderId = await orderOf(id);
		expect((await orderDetail(orderId))!.lines.map((l) => l.alternative)).toEqual([false, true, true, false]);
		// Die Pauschale kommt als Alternative nicht von selbst auf die Rechnung – nur, wenn sie gemacht wurde
		const lines = draftLines((await invoiceDraft(orderId))!);
		expect(lines.find((l) => l.text === 'Absicherung')).toMatchObject({ quantity: null, alternative: true });
	});
});

describe('Steuer: Bauunternehmen', () => {
	it('ein Kunde als Bauunternehmen bringt 0 % mit Übergang der Steuerschuld – bis in den Rechnungsentwurf', async () => {
		const customerId = await createCustomer({
			name: 'Baufirma GmbH',
			addition: '',
			street: '',
			zip: '',
			city: '',
			uid: 'ATU12345678',
			email: '',
			phone: '',
			contact: '',
			note: '',
			reverseCharge: true
		});
		const me = (await db.select({ id: users.id }).from(users).get())!.id;
		const id = await createOffer({ id: me } as never, { number: '26730', projectNumber: '', date: '2026-10-20', title: 'Halle', customerId });
		const offer = (await offerDetail(id))!;
		expect(offer).toMatchObject({ reverseCharge: true, customerUid: 'ATU12345678', paymentDays: 30 });
		expect(offerTotals([{ kind: 'position', quantity: 10, unitPrice: 10 }], 20, true)).toEqual({ net: 100, vat: 0, gross: 100 });
		// Ohne UID kein Übergang der Steuerschuld
		const priced = { ...offer, lines: [{ kind: 'position', quantity: 1, unitPrice: 100 }] };
		expect(releaseProblem({ ...priced, customerUid: '' })).toMatch(/UID/);
		expect(releaseProblem(priced)).toBeNull();

		const draft = (await invoiceDraft(await orderOf(id)))!;
		expect(draft.head.reverseCharge).toBe(true);
	});
});

describe('Zahlungsbedingungen mit Skonto', () => {
	it('rechnen gleich aus, was nach Skonto zu zahlen ist', () => {
		expect(afterSkonto(22766.4, 3)).toBe(22083.41);
		expect(paymentTermsText({ paymentDays: 30, skontoPercent: 3, skontoDays: 14 }, 22766.4, { due: '19.11.2026', skonto: '03.11.2026' })).toEqual([
			'Zahlbar bis 19.11.2026 ohne Abzug.',
			`Bei Zahlung bis 03.11.2026 gewähren wir 3 % Skonto – zu zahlen sind dann ${money(22083.41)}.`
		]);
		expect(paymentTermsText({ paymentDays: 30, skontoPercent: 0, skontoDays: 14 }, 100)).toEqual(['Zahlbar innerhalb von 30 Tagen ab Rechnungsdatum ohne Abzug.']);
		expect(paymentTermsText({ paymentDays: 0, skontoPercent: 0, skontoDays: 0 }, 100)).toEqual(['Zahlbar sofort nach Erhalt der Rechnung ohne Abzug.']);
	});

	it('prüfen das Formular', () => {
		const read = (v: Record<string, string>) => readPaymentTerms((k) => v[k] ?? '');
		expect(read({ ziel: '30', skonto: '3', skontotage: '14' })).toEqual({ paymentDays: 30, skontoPercent: 3, skontoDays: 14 });
		expect(read({ ziel: '30', skonto: '2,5', skontotage: '10' })).toEqual({ paymentDays: 30, skontoPercent: 2.5, skontoDays: 10 });
		// Ohne Prozent kein Skonto – auch wenn Tage dastehen
		expect(read({ ziel: '30', skonto: '', skontotage: '14' })).toEqual({ paymentDays: 30, skontoPercent: 0, skontoDays: 0 });
		expect(read({ ziel: '30', skonto: '3' })).toHaveProperty('message');
		expect(read({ ziel: '14', skonto: '3', skontotage: '30' })).toHaveProperty('message');
		expect(read({ ziel: '-1' })).toHaveProperty('message');
		expect(read({ ziel: '30', skonto: '25', skontotage: '10' })).toHaveProperty('message');
	});

	it('kommen aus dem Angebot in den Rechnungsentwurf', async () => {
		const id = await offerWith('26740', [{ kind: 'position', text: 'Leitlinie', quantity: '100', unit: 'lfm', unitPrice: '2' }]);
		const offer = (await offerDetail(id))!;
		await saveOffer(id, {
			head: { ...head('26740'), paymentDays: 21, skontoPercent: 3, skontoDays: 14 },
			lines: offer.lines.map((l) => ({ kind: l.kind, text: l.text, quantity: String(l.quantity), unit: l.unit, unitPrice: String(l.unitPrice) }))
		});
		const draft = (await invoiceDraft(await orderOf(id)))!;
		expect(draft.paymentDays).toBe(21);
		expect(draft.head).toMatchObject({ skontoPercent: 3, skontoDays: 14 });
		expect(draft.head.dueDate > draft.head.date).toBe(true);
	});

	it('ändern die Prüfsumme älterer Rechnungen nicht – und sind nach dem Ausstellen gesperrt', async () => {
		const base = {
			number: '26002',
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
			reverseCharge: false,
			lines: [{ number: '1', kind: 'position', text: 'Leitlinie', quantity: 100, unit: 'lfm', unitPrice: 2.5 }]
		};
		const before = contentHash(base);
		expect(contentHash({ ...base, skontoPercent: 0, skontoDays: 0 })).toBe(before);
		expect(contentHash({ ...base, skontoPercent: 3, skontoDays: 14 })).not.toBe(before);

		const row = await db
			.insert(invoices)
			.values({ number: '26002', date: '2026-10-20', dueDate: '2026-11-19', skontoPercent: 3, skontoDays: 14 })
			.returning({ id: invoices.id })
			.get();
		await db.update(invoices).set({ stage: 'ausgestellt' }).where(eq(invoices.id, row.id));
		await expect(db.update(invoices).set({ skontoPercent: 5 }).where(eq(invoices.id, row.id))).rejects.toThrow();
		await expect(db.update(invoices).set({ skontoDays: 30 }).where(eq(invoices.id, row.id))).rejects.toThrow();
	});
});
