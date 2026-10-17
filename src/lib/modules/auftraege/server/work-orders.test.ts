import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arbeitsauftrag-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { orderPositions, orders, parties, planEntries } = await import('$lib/server/db/schema');
const { orderDetail } = await import('./orders');
const { addBriefing, createWorkOrder, getWorkOrder, removeBriefing, saveWorkOrderForm, setWorkOrderSignature, workScope } = await import('./work-orders');
const { workOrderPdf } = await import('./work-order-pdf');
const { emptyForm, mergeForm, readContent, sanitizeForm, maySign } = await import('../work-order');

const SIG = 'M10 10L200 80L400 20';
type Who = Parameters<typeof workScope>[0];
const person = (role: string, partyId: number | null = null) =>
	({ id: 1, username: 'x', email: null, firstName: 'Max', lastName: 'Muster', role, partyId, owner: false, mustChangePassword: false }) as unknown as Who;

let orderId = 0;
let partyId = 0;

beforeAll(async () => {
	await ensureDatabase();
	const [party] = await db.insert(parties).values({ name: 'Nord' }).returning({ id: parties.id });
	partyId = party.id;
	const [order] = await db
		.insert(orders)
		.values({ number: '26001', title: 'Kreisverkehr Brunn', location: 'B17, Brunn am Gebirge', partyId, customerContact: 'Hr. Huber', customerPhone: '0664 123' })
		.returning({ id: orders.id });
	orderId = order.id;
	await db.insert(orderPositions).values([
		{ orderId, sortOrder: 0, kind: 'titel', text: 'Bodenmarkierung' },
		{ orderId, sortOrder: 1, kind: 'position', text: 'Leitlinie 15 cm weiß\nMSK D, reflektierend', quantity: 1250, unit: 'lfm' },
		{ orderId, sortOrder: 2, kind: 'position', text: 'Sperrfläche', quantity: 40, unit: 'm²' }
	]);
	await db.insert(planEntries).values([
		{ date: '2026-10-21', partyId, orderId },
		{ date: '2026-10-19', partyId, orderId }
	]);
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Formular prüfen', () => {
	it('unbrauchbare Eingaben werden leer, feste Zeilen der Rückseite behalten ihre Beschriftung', () => {
		const f = sanitizeForm({
			title: '  BV  ',
			startDate: '2026-02-30',
			endDate: '2026-10-21',
			evaluation: 'irgendwas',
			lines: [{ text: 'A', quantity: '1.250,5', done: 'x' }],
			ppe: [{ label: 'Fremd', checked: true, detail: 'Klasse 3' }, {}, {}, {}, { label: 'Gehörschutz', checked: true }],
			foilProtocol: 'ja'
		});
		expect(f.title).toBe('BV');
		expect(f.startDate).toBe('');
		expect(f.endDate).toBe('2026-10-21');
		expect(f.evaluation).toBe('');
		expect(f.lines[0]).toMatchObject({ text: 'A', quantity: 1250.5, done: null });
		expect(f.ppe[0]).toEqual({ label: 'Arbeitskleidung', checked: true, detail: 'Klasse 3' });
		expect(f.ppe[4]).toMatchObject({ label: 'Gehörschutz', checked: true });
		expect(f.ppe).toHaveLength(6);
		expect(f.foilProtocol).toBe('ja');
	});

	it('gespeicherte Unterschriften müssen gültige Pfade sein', () => {
		const c = readContent({ signatures: { bl: { path: SIG, name: 'A', at: 1 }, vorarbeiter: { path: '<script>', name: 'B', at: 1 } } });
		expect(Object.keys(c.signatures)).toEqual(['bl']);
	});
});

describe('Wer was ändern darf', () => {
	const old = { ...emptyForm(), title: 'Alt', lines: [{ text: 'Leitlinie', kind: '', ral: '', msk: '', quantity: 100, unit: 'lfm', done: null }] };
	const incoming = {
		...emptyForm(),
		title: 'Neu',
		finishedOn: '2026-10-22',
		checklist: { ppe: true, secured: true, equipment: false },
		lines: [
			{ text: 'Geändert', kind: '', ral: '', msk: '', quantity: 1, unit: 'm²', done: 95 },
			{ text: 'Dazu', kind: '', ral: '', msk: '', quantity: 5, unit: 'Stk', done: null }
		]
	};

	it('die Partie ändert nur ihren Teil – ausgeführte Mengen, Checkliste, fertig am', () => {
		const next = mergeForm(old, incoming, { office: false, site: true });
		expect(next.title).toBe('Alt');
		expect(next.lines).toEqual([{ ...old.lines[0], done: 95 }]);
		expect(next.checklist.ppe).toBe(true);
		expect(next.finishedOn).toBe('2026-10-22');
	});

	it('das Büro ändert alles', () => {
		const next = mergeForm(old, incoming, { office: true, site: true });
		expect(next.title).toBe('Neu');
		expect(next.lines.map((l) => l.text)).toEqual(['Geändert', 'Dazu']);
	});

	it('wer nur ansieht, ändert nichts', () => {
		expect(mergeForm(old, incoming, { office: false, site: false })).toEqual(old);
	});

	it('BL unterschreibt das Büro, alles andere die Baustelle', () => {
		expect(maySign('bl', { office: false, site: true })).toBe(false);
		expect(maySign('auftraggeber', { office: false, site: true })).toBe(true);
	});

	it('Rechte nach Rolle und Partie', async () => {
		const order = (await orderDetail(orderId))!;
		expect(workScope(person('bauleiter'), order)).toEqual({ office: true, site: true });
		expect(workScope(person('partiefuehrer', partyId), order)).toEqual({ office: false, site: true });
		expect(workScope(person('partiefuehrer', partyId + 99), order)).toEqual({ office: false, site: false });
		expect(workScope(person('arbeiter', partyId), order)).toEqual({ office: false, site: false });
	});
});

describe('Arbeitsauftrag am Auftrag', () => {
	it('wird aus dem Auftrag und der Wochenplanung vorbelegt', async () => {
		await createWorkOrder((await orderDetail(orderId))!, 1);
		const w = (await getWorkOrder(orderId))!;
		expect(w.content).toMatchObject({
			title: 'Kreisverkehr Brunn',
			site: 'B17, Brunn am Gebirge',
			startDate: '2026-10-19',
			endDate: '2026-10-21',
			contacts: [{ name: 'Hr. Huber', phone: '0664 123' }, { name: '', phone: '' }]
		});
		expect(w.content.lines.map((l) => [l.text, l.quantity, l.unit])).toEqual([
			['Leitlinie 15 cm weiß', 1250, 'lfm'],
			['Sperrfläche', 40, 'm²']
		]);
		// Ein zweites Mal ändert nichts
		await createWorkOrder((await orderDetail(orderId))!, 1);
		expect((await getWorkOrder(orderId))!.id).toBe(w.id);
	});

	it('nach der Unterschrift des Auftraggebers ist er gesperrt – bis sie entfernt wird', async () => {
		const form = { ...(await getWorkOrder(orderId))!.content, finishedOn: '2026-10-22' };
		expect(await saveWorkOrderForm(orderId, sanitizeForm(form), { office: false, site: true }, 1)).toBeNull();
		expect(await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Arbeit', signature: SIG, at: 1 }, 1)).toBeNull();
		expect(await setWorkOrderSignature(orderId, 'auftraggeber', { path: SIG, name: 'Hr. Huber', at: Date.now() }, 1)).toBeNull();

		expect(await saveWorkOrderForm(orderId, sanitizeForm({ ...form, finishedOn: '2026-10-23' }), { office: true, site: true }, 1)).toMatch(/Auftraggeber/);
		expect(await setWorkOrderSignature(orderId, 'bl', { path: SIG, name: 'BL', at: 1 }, 1)).toMatch(/Auftraggeber/);
		expect(await removeBriefing(orderId, 0, 1)).toMatch(/Auftraggeber/);

		expect(await setWorkOrderSignature(orderId, 'auftraggeber', null, 1)).toBeNull();
		expect(await removeBriefing(orderId, 0, 1)).toBeNull();
		const w = (await getWorkOrder(orderId))!;
		expect(w.content.finishedOn).toBe('2026-10-22');
		expect(w.content.briefings).toEqual([]);
		expect(w.content.signatures.auftraggeber).toBeUndefined();
	});

	it('das PDF hat zwei Seiten', async () => {
		await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Kokić', signature: SIG, at: 1 }, 1);
		await setWorkOrderSignature(orderId, 'bl', { path: SIG, name: 'Bruno Leiter', at: Date.now() }, 1);
		const res = await workOrderPdf({ number: '26001', content: (await getWorkOrder(orderId))!.content });
		const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
	});
});
