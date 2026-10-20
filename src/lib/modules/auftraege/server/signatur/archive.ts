/**
 * InvoiceArchiveService – ausgestellte Rechnungen unverändert aufbewahren:
 * Dateien unter /data/rechnungen/<Jahr>/, einmal geschrieben und nie
 * überschrieben (nur anlegen, nicht ersetzen; schreibgeschützt), nach dem
 * Schreiben zurückgelesen und gegen die Prüfsumme verglichen. Die Prüfsumme
 * (SHA-256) steht zusätzlich in der Datenbank und im Protokoll.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { DATA_DIR, db, type Tx } from '$lib/server/db';
import { invoicePositions, invoices } from '$lib/server/db/schema';

export const ARCHIVE_DIR = path.join(DATA_DIR, 'rechnungen');

export class ArchiveError extends Error {}

export const sha256Hex = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

function fullPath(fileName: string): string {
	const root = path.resolve(ARCHIVE_DIR);
	const full = path.resolve(root, fileName);
	if (!full.startsWith(root + path.sep)) throw new ArchiveError('Ungültiger Dateiname im Archiv.');
	return full;
}

/** Neue Archivdatei – vorhandene werden nie ersetzt */
export function writeArchiveFile(o: { year: string; number: string; kind: string; pdf: Buffer }): { fileName: string; sha256: string; size: number } {
	const hash = sha256Hex(o.pdf);
	const fileName = `${o.year}/${o.number.replace(/[^\w.-]/g, '_')}_${o.kind}_${hash.slice(0, 12)}.pdf`;
	const full = fullPath(fileName);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	if (fs.existsSync(full)) {
		// Schon da (z. B. nach einem Abbruch): nur in Ordnung, wenn es genau dieselbe Datei ist
		if (sha256Hex(fs.readFileSync(full)) === hash) return { fileName, sha256: hash, size: o.pdf.length };
		throw new ArchiveError('Im Archiv liegt unter diesem Namen schon eine andere Datei.');
	}
	const fd = fs.openSync(full, 'wx', 0o444);
	try {
		fs.writeSync(fd, o.pdf);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	if (sha256Hex(fs.readFileSync(full)) !== hash) throw new ArchiveError('Die Archivdatei wurde nicht vollständig geschrieben.');
	return { fileName, sha256: hash, size: o.pdf.length };
}

export function readArchiveFile(fileName: string): Buffer | null {
	try {
		return fs.readFileSync(fullPath(fileName));
	} catch {
		return null;
	}
}

/** Nur für Dateien, die nie in der Datenbank ankamen (Abbruch zwischen Schreiben und Eintragen) */
export function removeUnreferenced(fileName: string) {
	try {
		const full = fullPath(fileName);
		fs.chmodSync(full, 0o644);
		fs.rmSync(full, { force: true });
	} catch {
		/* bleibt liegen – schadet nicht */
	}
}

/**
 * Aufbewahrungsfrist: nach § 132 BAO sieben Jahre ab Ende des Kalenderjahres
 * der Rechnung – längere Fristen (z. B. Grundstücke) lassen sich einstellen.
 */
export function retentionDate(invoiceDate: string, years: number): string {
	return `${Number(invoiceDate.slice(0, 4)) + years}-12-31`;
}

/** Was auf der Rechnung steht – als Prüfsumme, um Änderungen an der Datenbank vorbei zu erkennen */
export interface InvoiceContent {
	number: string;
	kind: string;
	date: string;
	dueDate: string;
	serviceFrom: string | null;
	serviceTo: string | null;
	projectNumber: string;
	/** Kam später dazu – zählt nur, wenn eine eingetragen ist, damit frühere Prüfsummen stimmen */
	costCenter?: string;
	title: string;
	location: string;
	customerName: string;
	customerAddition: string;
	customerStreet: string;
	customerZip: string;
	customerCity: string;
	customerUid: string;
	intro: string;
	closing: string;
	state: string;
	section: string;
	vatRate: number;
	reverseCharge: boolean;
	skontoPercent?: number;
	skontoDays?: number;
	lines: { number: string; kind: string; text: string; note?: string; quantity: number | null; unit: string; unitPrice: number | null }[];
}

export function contentHash(i: InvoiceContent): string {
	return sha256Hex(
		JSON.stringify([
			i.number,
			i.kind,
			i.date,
			i.dueDate,
			i.serviceFrom,
			i.serviceTo,
			i.projectNumber,
			i.title,
			i.location,
			i.customerName,
			i.customerAddition,
			i.customerStreet,
			i.customerZip,
			i.customerCity,
			i.customerUid,
			i.intro,
			i.closing,
			i.state,
			i.section,
			i.vatRate,
			i.reverseCharge,
			// Die Bemerkung nur, wenn eine da ist – so bleibt die Prüfsumme älterer Rechnungen gleich
			i.lines.map((l) => [l.number, l.kind, l.text, l.quantity, l.unit, l.unitPrice, ...(l.note ? [l.note] : [])]),
			...(i.costCenter ? [i.costCenter] : []),
			// Skonto ebenso nur, wenn eines gewährt wird
			...(i.skontoPercent ? [['skonto', i.skontoPercent, i.skontoDays ?? 0]] : [])
		])
	);
}

/** Die Rechnungsdaten, wie sie gerade in der Datenbank stehen */
export async function readContent(tx: Tx, id: number) {
	const head = await tx.select().from(invoices).where(eq(invoices.id, id)).get();
	if (!head) return null;
	const lines = await tx
		.select({
			number: invoicePositions.number,
			kind: invoicePositions.kind,
			text: invoicePositions.text,
			note: invoicePositions.note,
			quantity: invoicePositions.quantity,
			unit: invoicePositions.unit,
			unitPrice: invoicePositions.unitPrice
		})
		.from(invoicePositions)
		.where(eq(invoicePositions.invoiceId, id))
		.orderBy(asc(invoicePositions.sortOrder), asc(invoicePositions.id))
		.all();
	return { head, hash: contentHash({ ...head, lines }) };
}

/** Rechnungsdaten aus der Datenbank gegen die beim Ausstellen gemerkte Prüfsumme */
export async function currentContentHash(id: number): Promise<string | null> {
	return (await readContent(db as unknown as Tx, id))?.hash ?? null;
}

