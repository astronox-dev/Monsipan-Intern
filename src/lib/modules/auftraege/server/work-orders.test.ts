import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arbeitsauftrag-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { db, client, ensureDatabase } = await import('$lib/server/db');
const { orderPositions, orders, parties, planEntries, workOrders } = await import('$lib/server/db/schema');
const { deleteOrder, listOrders, orderDetail } = await import('./orders');
const {
	addBriefing,
	closeBlocker,
	createWorkOrder,
	deleteWorkOrder,
	getWorkOrder,
	hasWorkOrder,
	orderSource,
	prefill,
	removeBriefing,
	saveWorkOrderForm,
	setWorkOrderSignature,
	workScope
} = await import('./work-orders');
const { workOrderPdf } = await import('./work-order-pdf');
const { foilPdf } = await import('./foil-pdf');
const { closeMessage, creationForm, emptyForm, foilSignatures, guessLine, mergeForm, prefillFoil, readContent, sanitizeForm, maySign } = await import('../work-order');
const { backfillWorkOrderPlans, orderPlanDays, syncWorkOrderPlan } = await import('$lib/modules/planung/server/plan');
const { today } = await import('$lib/modules/stunden/week');

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

describe('Vorbelegen', () => {
	it('Art, RAL und MSK aus dem Positionstext', () => {
		expect(guessLine('Leitlinie 15 cm weiß, Kaltplastik, MSK D refl.')).toEqual({ kind: 'Kaltplastik', ral: '9016', msk: 'D refl.' });
		expect(guessLine('Haltelinie 50 cm gelb, Folie RAL 1003')).toEqual({ kind: 'Folie', ral: '1003', msk: '' });
		expect(guessLine('Markierungsfarbe rot, MSK C')).toEqual({ kind: 'Farbe', ral: '3020', msk: 'C' });
		expect(guessLine('Leitlinie 12 cm\nMSK D, reflektierend')).toEqual({ kind: '', ral: '', msk: 'D refl.' });
		// „rot" in „Protokoll" ist keine Farbe
		expect(guessLine('Protokoll erstellen')).toEqual({ kind: '', ral: '', msk: '' });
	});

	it('3M-Protokoll aus den Folien-Leistungen', () => {
		const foil = prefillFoil(
			{
				site: 'B17',
				startDate: '2026-10-20',
				lines: [
					{ text: 'Leitlinie 15 cm', kind: 'Farbe', ral: '', msk: '', quantity: 100, unit: 'lfm', done: null },
					{ text: 'Haltelinie 50 cm, Folie', kind: 'Folie', ral: '', msk: '', quantity: 24, unit: 'lfm', done: null }
				]
			},
			'3M Stamark 380'
		);
		expect(foil).toMatchObject({ place: 'B17', layingDate: '2026-10-20' });
		expect(foil.films[0]).toEqual({ type: '3M Stamark 380', width: '50', length: '24', primer: '', dryTime: '', lineType: 'Haltelinie' });
		expect(foil.films[1].type).toBe('');
	});

	it('im 3M-Protokoll unterschreiben Vorarbeiter (sonst Vertretung) und Auftraggeber des Arbeitsauftrags', () => {
		const sig = (name: string) => ({ path: SIG, name, at: 1 });
		const foil = { ...readContent({}).foil, signatures: { auftraggeber: sig('alt') } };
		expect(foilSignatures({ signatures: { vertretung: sig('V'), auftraggeber: sig('A') }, foil })).toEqual({ auftragnehmer: sig('V'), auftraggeber: sig('A') });
		expect(foilSignatures({ signatures: { vorarbeiter: sig('P'), vertretung: sig('V') }, foil })).toEqual({ auftragnehmer: sig('P'), auftraggeber: sig('alt') });
	});
});

describe('Arbeitsauftrag am Auftrag', () => {
	it('ohne Arbeitsauftrag kennt die Partie den Auftrag nicht', async () => {
		expect(await listOrders(person('partiefuehrer', partyId))).toEqual([]);
		expect((await listOrders(person('bauleiter'))).map((o) => o.id)).toEqual([orderId]);
	});

	it('wird mit dem ausgefüllten Kopf erstellt – vorbelegt aus Auftrag, Positionstext und Wochenplanung', async () => {
		const order = (await orderDetail(orderId))!;
		const start = await prefill(orderSource(order));
		expect(start).toMatchObject({
			title: 'Kreisverkehr Brunn',
			site: 'B17, Brunn am Gebirge',
			startDate: '2026-10-19',
			endDate: '2026-10-21',
			contacts: [{ name: 'Hr. Huber', phone: '0664 123' }, { name: '', phone: '' }],
			foilProtocol: ''
		});
		expect(start.lines[0]).toMatchObject({ text: 'Leitlinie 15 cm weiß', ral: '9016', msk: 'D refl.' });
		const form = sanitizeForm({
			...start,
			site: 'B17 Kreisverkehr Süd',
			evaluation: 'baustelle',
			foilProtocol: 'ja',
			attachments: { ...start.attachments, discussed: true },
			ppe: start.ppe.map((p, i) => (i === 0 ? { ...p, checked: true, detail: 'Warnkleidung Klasse 3' } : p)),
			lines: [{ text: 'Versuch', kind: 'Kaltplastik', ral: '9016', msk: 'D', quantity: 1, unit: 'Stk' }]
		});
		expect(await createWorkOrder(order, 1, form, { path: SIG, name: 'Bruno Leiter', at: 5 })).toBe(true);
		const w = (await getWorkOrder(orderId))!;
		expect(w.content).toMatchObject({ site: 'B17 Kreisverkehr Süd', evaluation: 'baustelle', foilProtocol: 'ja', signDate: today() });
		expect(w.content.signatures.bl?.name).toBe('Bruno Leiter');
		expect(w.content.lines.map((l) => [l.text, l.quantity, l.unit, l.kind, l.ral])).toEqual([
			['Leitlinie 15 cm weiß', 1250, 'lfm', 'Kaltplastik', '9016'],
			['Sperrfläche', 40, 'm²', '', '']
		]);
		expect(w.content.foil.place).toBe('B17 Kreisverkehr Süd');
		// Ein zweites Mal ändert nichts
		expect(await createWorkOrder(order, 1, form)).toBe(false);
		expect(await hasWorkOrder(orderId)).toBe(true);
	});

	it('der nächste übernimmt Beilagen, Evaluierung und Rückseite – und Folie heißt Verlegeprotokoll „ja"', async () => {
		const start = await prefill({
			title: 'Neu',
			location: 'B1',
			customerContact: '',
			customerPhone: '',
			lines: [{ kind: 'position', text: 'Haltelinie 50 cm, Folie', quantity: 12, unit: 'lfm' }]
		});
		expect(start.attachments.discussed).toBe(true);
		expect(start.evaluation).toBe('baustelle');
		expect(start.ppe[0]).toMatchObject({ checked: true, detail: 'Warnkleidung Klasse 3' });
		expect(start.foilProtocol).toBe('ja');
		expect(start.foil.films[0]).toMatchObject({ width: '50', length: '12', lineType: 'Haltelinie' });
	});

	it('mit Arbeitsauftrag sieht ihn die Partie', async () => {
		expect((await listOrders(person('partiefuehrer', partyId))).map((o) => o.id)).toEqual([orderId]);
		expect(await listOrders(person('partiefuehrer', partyId + 99))).toEqual([]);
	});

	it('das 3M-Protokoll wird mit dem Arbeitsauftrag gespeichert – von der Partie', async () => {
		const c = (await getWorkOrder(orderId))!.content;
		const foil = { place: 'B17', weather: { air: ['12', '14,5'] }, films: [{ type: '3M 380 AW', width: '15' }], release: 'nach', releaseDays: '1' };
		expect(await saveWorkOrderForm(orderId, sanitizeForm(c), { office: false, site: true }, 1, foil)).toBeNull();
		const saved = (await getWorkOrder(orderId))!.content.foil;
		expect(saved).toMatchObject({ place: 'B17', release: 'nach', releaseDays: '1' });
		expect(saved.weather.air).toEqual(['12', '14,5', '', '']);
		expect(saved.films[0]).toMatchObject({ type: '3M 380 AW', width: '15', length: '' });
		// Wer nur ansieht, ändert es nicht
		expect(await saveWorkOrderForm(orderId, sanitizeForm(c), { office: false, site: false }, 1, { place: 'X' })).toBeNull();
		expect((await getWorkOrder(orderId))!.content.foil.place).toBe('B17');
	});

	it('die Unterschrift des Auftraggebers setzt „Arbeit fertig am" und sperrt – bis sie entfernt wird', async () => {
		const form = { ...(await getWorkOrder(orderId))!.content, finishedOn: '' };
		expect(await saveWorkOrderForm(orderId, sanitizeForm(form), { office: false, site: true }, 1)).toBeNull();
		expect(await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Arbeit', signature: SIG, at: 1 }, 1)).toBeNull();
		expect(await setWorkOrderSignature(orderId, 'auftraggeber', { path: SIG, name: 'Hr. Huber', at: Date.now() }, 1)).toBeNull();
		expect((await getWorkOrder(orderId))!.content.finishedOn).toBe(today());

		expect(await saveWorkOrderForm(orderId, sanitizeForm({ ...form, finishedOn: '2026-10-23' }), { office: true, site: true }, 1)).toMatch(/Auftraggeber/);
		expect(await setWorkOrderSignature(orderId, 'bl', { path: SIG, name: 'BL', at: 1 }, 1)).toMatch(/Auftraggeber/);
		expect(await removeBriefing(orderId, 0, 1)).toMatch(/Auftraggeber/);

		expect(await setWorkOrderSignature(orderId, 'auftraggeber', null, 1)).toBeNull();
		expect(await removeBriefing(orderId, 0, 1)).toBeNull();
		const w = (await getWorkOrder(orderId))!;
		expect(w.content.briefings).toEqual([]);
		expect(w.content.signatures.auftraggeber).toBeUndefined();
	});

	it('die PDFs: Arbeitsauftrag zwei Seiten, mit Verlegeprotokoll dahinter drei; das Protokoll allein eine', async () => {
		await addBriefing(orderId, { date: '2026-10-19', name: 'Anna Kokić', signature: SIG, at: 1 }, 1);
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

describe('Termin in der Wochenplanung', () => {
	it('mit Partie und Ausführungsdatum steht der Auftrag dort – und zieht mit, wenn sich Termin oder Partie ändern', async () => {
		const [o] = await db.insert(orders).values({ number: '26050', title: 'Termin' }).returning({ id: orders.id });
		// Fr 23.10. bis Di 27.10. – Wochenende und Nationalfeiertag dazwischen
		const form = sanitizeForm({ ...emptyForm(), startDate: '2026-10-23', endDate: '2026-10-27' });
		expect(await createWorkOrder((await orderDetail(o.id))!, 1, form)).toBe(true);
		// Ohne Partie noch nicht
		expect((await orderPlanDays(o.id)).days).toEqual([]);

		await db.update(orders).set({ partyId }).where(eq(orders.id, o.id));
		expect(await syncWorkOrderPlan(o.id, 1)).toEqual({ partyName: 'Nord', days: ['2026-10-23', '2026-10-27'] });
		expect(await orderPlanDays(o.id)).toEqual({ days: ['2026-10-23', '2026-10-27'], parties: ['Nord'] });
		// Noch einmal ändert nichts
		await syncWorkOrderPlan(o.id, 1);
		expect(await db.select().from(planEntries).where(eq(planEntries.orderId, o.id)).all()).toHaveLength(2);

		// Selbst eingetragen – bleibt, was auch passiert
		await db.insert(planEntries).values({ date: '2026-10-28', partyId, orderId: o.id });
		// Das Büro verschiebt den Termin: 28. bis 29.
		expect(await saveWorkOrderForm(o.id, sanitizeForm({ ...form, startDate: '2026-10-28', endDate: '2026-10-29' }), { office: true, site: true }, 1)).toBeNull();
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-10-28', '2026-10-29']);
		expect(await db.select().from(planEntries).where(and(eq(planEntries.orderId, o.id), eq(planEntries.date, '2026-10-28'))).all()).toHaveLength(1);
		// Die Partie speichert nur ihren Teil – der Termin bleibt
		await saveWorkOrderForm(o.id, sanitizeForm({ ...form, startDate: '2026-11-02' }), { office: false, site: true }, 1);
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-10-28', '2026-10-29']);

		// Ohne Partie gehen die vom Arbeitsauftrag – der selbst eingetragene bleibt
		await db.update(orders).set({ partyId: null }).where(eq(orders.id, o.id));
		expect(await syncWorkOrderPlan(o.id, 1)).toBeNull();
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-10-28']);
	});
});

describe('Termin in der Wochenplanung – nachtragen und aufräumen', () => {
	it('bestehende Arbeitsaufträge mit Termin und Partie kommen einmalig hinein; gelöscht gehen ihre Einträge', async () => {
		// Ein Arbeitsauftrag von „vor dem Update": Termin und Partie, aber nichts in der Planung
		const [o] = await db.insert(orders).values({ number: '26060', title: 'Alt', partyId }).returning({ id: orders.id });
		const content = readContent({ ...emptyForm(), startDate: '2026-11-03', endDate: '2026-11-04' });
		await db.insert(workOrders).values({ orderId: o.id, content });
		// Ein abgeschlossener bleibt draußen
		const [done] = await db.insert(orders).values({ number: '26061', title: 'Fertig', partyId, status: 'abgeschlossen' }).returning({ id: orders.id });
		await db.insert(workOrders).values({ orderId: done.id, content });

		expect(await backfillWorkOrderPlans()).toBeGreaterThanOrEqual(1);
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-11-03', '2026-11-04']);
		expect((await orderPlanDays(done.id)).days).toEqual([]);

		// Einmal reicht – wer danach einen Eintrag löscht, bekommt ihn nicht wieder
		await db.delete(planEntries).where(and(eq(planEntries.orderId, o.id), eq(planEntries.date, '2026-11-04')));
		expect(await backfillWorkOrderPlans()).toBeNull();
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-11-03']);

		// Arbeitsauftrag gelöscht: seine Einträge gehen, selbst eingetragene bleiben
		await db.insert(planEntries).values({ date: '2026-11-05', partyId, orderId: o.id });
		await deleteWorkOrder(o.id);
		expect((await orderPlanDays(o.id)).days).toEqual(['2026-11-05']);

		// Auftrag gelöscht: keine leeren Einträge vom Arbeitsauftrag bleiben zurück
		const [p] = await db.insert(orders).values({ number: '26062', title: 'Weg', partyId }).returning({ id: orders.id });
		expect(await createWorkOrder((await orderDetail(p.id))!, 1, sanitizeForm({ ...emptyForm(), startDate: '2026-11-10' }))).toBe(true);
		expect((await orderPlanDays(p.id)).days).toEqual(['2026-11-10']);
		await deleteOrder(p.id);
		expect(await db.select().from(planEntries).where(and(eq(planEntries.date, '2026-11-10'), eq(planEntries.partyId, partyId))).all()).toEqual([]);
	});
});

describe('Abschließen', () => {
	it('erst mit abgehakter Vorarbeiter-Checkliste', async () => {
		expect(closeMessage(emptyForm())).toBe('Abschließen geht erst mit abgehakter Vorarbeiter-Checkliste – es fehlt: Mitarbeiter tragen PSA, Baustelle ist abgesichert, Ausrüstung ist in Ordnung.');
		const [o] = await db.insert(orders).values({ number: '26051', title: 'Abschluss', partyId }).returning({ id: orders.id });
		// Ohne Arbeitsauftrag gibt es keine Checkliste
		expect(await closeBlocker(o.id)).toBeNull();
		await createWorkOrder((await orderDetail(o.id))!, 1);
		expect(await closeBlocker(o.id)).toContain('Mitarbeiter tragen PSA');
		const w = (await getWorkOrder(o.id))!;
		await saveWorkOrderForm(o.id, { ...w.content, checklist: { ppe: true, secured: true, equipment: false } }, { office: false, site: true }, 1);
		expect(await closeBlocker(o.id)).toBe('Abschließen geht erst mit abgehakter Vorarbeiter-Checkliste – es fehlt: Ausrüstung ist in Ordnung.');
		await saveWorkOrderForm(o.id, { ...w.content, checklist: { ppe: true, secured: true, equipment: true } }, { office: false, site: true }, 1);
		expect(await closeBlocker(o.id)).toBeNull();
	});
});
