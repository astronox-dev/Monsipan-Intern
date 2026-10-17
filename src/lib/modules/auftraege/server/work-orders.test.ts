import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arbeitsauftrag-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { orderPositions, orders, parties, planEntries } = await import('$lib/server/db/schema');
const { listOrders, orderDetail } = await import('./orders');
const {
	addBriefing,
	createWorkOrder,
	getWorkOrder,
	hasWorkOrder,
	prefill,
	removeBriefing,
	saveFoilProtocol,
	saveWorkOrderForm,
	setFoilSignature,
	setWorkOrderSignature,
	workScope
} = await import('./work-orders');
const { workOrderPdf } = await import('./work-order-pdf');
const { foilPdf } = await import('./foil-pdf');
const { creationForm, emptyForm, mergeForm, readContent, sanitizeForm, maySign } = await import('../work-order');

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

	it('gespeicherte Unterschriften müssen gültige Pfade sein – auch im Verlegeprotokoll', () => {
		const c = readContent({
			signatures: { bl: { path: SIG, name: 'A', at: 1 }, vorarbeiter: { path: '<script>', name: 'B', at: 1 } },
			foil: { place: 'B17', release: 'bald', signatures: { auftragnehmer: { path: SIG, name: 'C', at: 1 }, auftraggeber: { path: 'x', at: 1 } } }
		});
		expect(Object.keys(c.signatures)).toEqual(['bl']);
		expect(c.foil.place).toBe('B17');
		expect(c.foil.release).toBe('');
		expect(Object.keys(c.foil.signatures)).toEqual(['auftragnehmer']);
		expect(c.foil.weather.air).toHaveLength(4);
	});
});

describe('Wer was ändern darf', () => {
	const old = { ...emptyForm(), title: 'Alt', lines: [{ text: 'Leitlinie', kind: 'Farbe', ral: '9016', msk: 'D', quantity: 100, unit: 'lfm', done: null }] };
	const incoming = {
		...emptyForm(),
		title: 'Neu',
		finishedOn: '2026-10-22',
		checklist: { ppe: true, secured: true, equipment: false },
		lines: [
			{ text: 'Geändert', kind: 'Folie', ral: '', msk: '', quantity: 1, unit: 'm²', done: 95 },
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

	it('das Büro ändert den Kopf – die Leistungen stehen nach dem Erstellen auch für das Büro fest', () => {
		const next = mergeForm(old, incoming, { office: true, site: true });
		expect(next.title).toBe('Neu');
		expect(next.lines).toEqual([{ ...old.lines[0], done: 95 }]);
	});

	it('wer nur ansieht, ändert nichts', () => {
		expect(mergeForm(old, incoming, { office: false, site: false })).toEqual(old);
	});

	it('beim Erstellen: Leistungen aus dem Auftrag, dazu Art, RAL und MSK aus dem Formular', () => {
		const made = creationForm(old, incoming);
		expect(made.title).toBe('Neu');
		expect(made.lines).toEqual([{ ...old.lines[0], kind: 'Folie', ral: '', msk: '' }]);
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
	it('ohne Arbeitsauftrag kennt die Partie den Auftrag nicht', async () => {
		expect(await listOrders(person('partiefuehrer', partyId))).toEqual([]);
		expect((await listOrders(person('bauleiter'))).map((o) => o.id)).toEqual([orderId]);
	});

	it('wird mit dem ausgefüllten Kopf erstellt – vorbelegt aus dem Auftrag und der Wochenplanung', async () => {
		const order = (await orderDetail(orderId))!;
		const start = await prefill(order);
		expect(start).toMatchObject({
			title: 'Kreisverkehr Brunn',
			site: 'B17, Brunn am Gebirge',
			startDate: '2026-10-19',
			endDate: '2026-10-21',
			contacts: [{ name: 'Hr. Huber', phone: '0664 123' }, { name: '', phone: '' }]
		});
		const form = sanitizeForm({
			...start,
			site: 'B17 Kreisverkehr Süd',
			evaluation: 'baustelle',
			foilProtocol: 'ja',
			lines: [{ text: 'Versuch', kind: 'Kaltplastik', ral: '9016', msk: 'D', quantity: 1, unit: 'Stk' }]
		});
		expect(await createWorkOrder(order, 1, form)).toBe(true);
		const w = (await getWorkOrder(orderId))!;
		expect(w.content).toMatchObject({ site: 'B17 Kreisverkehr Süd', evaluation: 'baustelle', foilProtocol: 'ja' });
		expect(w.content.lines.map((l) => [l.text, l.quantity, l.unit, l.kind, l.ral])).toEqual([
			['Leitlinie 15 cm weiß', 1250, 'lfm', 'Kaltplastik', '9016'],
			['Sperrfläche', 40, 'm²', '', '']
		]);
		expect(w.content.foil.place).toBe('B17 Kreisverkehr Süd');
		// Ein zweites Mal ändert nichts
		expect(await createWorkOrder(order, 1, form)).toBe(false);
		expect(await hasWorkOrder(orderId)).toBe(true);
	});

	it('mit Arbeitsauftrag sieht ihn die Partie', async () => {
		expect((await listOrders(person('partiefuehrer', partyId))).map((o) => o.id)).toEqual([orderId]);
		expect(await listOrders(person('partiefuehrer', partyId + 99))).toEqual([]);
	});

	it('nach der Unterschrift des Auftraggebers ist er gesperrt – bis sie entfernt wird', async () => {
		const form = { ...(await getWorkOrder(orderId))!.content, finishedOn: '2026-10-22' };
		expect(await saveWorkOrderForm(orderId, sanitizeForm(form), { office: false, site: true }, 1)).toBeNull();
		expect(await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Arbeit', signature: SIG, at: 1 }, 1)).toBeNull();
		expect(await setWorkOrderSignature(orderId, 'auftraggeber', { path: SIG, name: 'Hr. Huber', at: Date.now() }, 1)).toBeNull();

		expect(await saveWorkOrderForm(orderId, sanitizeForm({ ...form, finishedOn: '2026-10-23' }), { office: true, site: true }, 1)).toMatch(/Auftraggeber/);
		expect(await setWorkOrderSignature(orderId, 'bl', { path: SIG, name: 'BL', at: 1 }, 1)).toMatch(/Auftraggeber/);
		expect(await removeBriefing(orderId, 0, 1)).toMatch(/Auftraggeber/);
		expect(await saveFoilProtocol(orderId, { place: 'X' }, 1)).toMatch(/Auftraggeber/);

		expect(await setWorkOrderSignature(orderId, 'auftraggeber', null, 1)).toBeNull();
		expect(await removeBriefing(orderId, 0, 1)).toBeNull();
		const w = (await getWorkOrder(orderId))!;
		expect(w.content.finishedOn).toBe('2026-10-22');
		expect(w.content.briefings).toEqual([]);
		expect(w.content.signatures.auftraggeber).toBeUndefined();
	});

	it('das 3M-Verlegeprotokoll: speichern, anerkennen, gesperrt', async () => {
		expect(
			await saveFoilProtocol(orderId, { place: 'B17', weather: { air: ['12', '14,5'] }, films: [{ type: '3M 380 AW', width: '15' }], release: 'nach', releaseDays: '1' }, 1)
		).toBeNull();
		expect(await setFoilSignature(orderId, 'auftragnehmer', { path: SIG, name: 'Paul Führer', at: Date.now() }, 1)).toBeNull();
		expect(await setFoilSignature(orderId, 'auftraggeber', { path: SIG, name: 'Hr. Huber', at: Date.now() }, 1)).toBeNull();
		expect(await saveFoilProtocol(orderId, { place: 'Anders' }, 1)).toMatch(/Verlegeprotokoll/);
		expect(await setFoilSignature(orderId, 'auftragnehmer', null, 1)).toMatch(/Verlegeprotokoll/);
		const { foil } = (await getWorkOrder(orderId))!.content;
		expect(foil).toMatchObject({ place: 'B17', release: 'nach', releaseDays: '1' });
		expect(foil.weather.air).toEqual(['12', '14,5', '', '']);
		expect(foil.films[0]).toMatchObject({ type: '3M 380 AW', width: '15', length: '' });
		expect(Object.keys(foil.signatures).sort()).toEqual(['auftraggeber', 'auftragnehmer']);
	});

	it('die PDFs: Arbeitsauftrag zwei Seiten, mit Verlegeprotokoll dahinter drei; das Protokoll allein eine', async () => {
		await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Kokić', signature: SIG, at: 1 }, 1);
		await setWorkOrderSignature(orderId, 'bl', { path: SIG, name: 'Bruno Leiter', at: Date.now() }, 1);
		const { content } = (await getWorkOrder(orderId))!;
		const pages = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString('latin1').match(/\/Type \/Page\b/g)?.length;
		const work = await workOrderPdf({ number: '26001', content });
		expect(work.headers.get('content-type')).toBe('application/pdf');
		expect(content.foilProtocol).toBe('ja');
		expect(await pages(work)).toBe(3);
		expect(await pages(await workOrderPdf({ number: '26001', content: { ...content, foilProtocol: 'nein' } }))).toBe(2);
		expect(await pages(await foilPdf({ number: '26001', foil: content.foil }))).toBe(1);
	});
});
