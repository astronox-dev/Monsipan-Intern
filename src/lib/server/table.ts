/**
 * Tabellen lesen und schreiben – Excel (.xlsx) und CSV.
 *
 * Beim Lesen von CSV werden Trennzeichen (Semikolon, Komma, Tabulator) und
 * Zeichensatz erkannt: UTF-8, UTF-16 (Excel „Unicode-Text") oder
 * Windows-1252, wie ihn ältere Programme schreiben. Geschrieben wird CSV wie
 * die übrigen Exporte: Semikolon, Dezimalkomma, UTF-8 mit BOM.
 */
import readExcelFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

export type TableCell = string | number | boolean | Date | null;

export interface Table {
	/** Alle Blätter (bei CSV nur eines) */
	sheets: string[];
	sheet: string;
	rows: TableCell[][];
}

export class TableError extends Error {}

export const MAX_TABLE_BYTES = 15 * 1024 * 1024;
export const MAX_TABLE_ROWS = 20_000;

const isZip = (data: Buffer) => data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;

/** Zeichensatz erkennen: BOM, sonst UTF-8 – und wenn das nicht passt, Windows-1252 */
export function decodeText(data: Buffer): string {
	if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString('utf8');
	if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2));
	if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2));
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch {
		return new TextDecoder('windows-1252').decode(data);
	}
}

/** CSV zerlegen – Anführungszeichen mit verdoppelten "", Zeilenumbrüche in Feldern */
export function parseCsv(text: string): string[][] {
	const firstLine = text.slice(0, Math.max(0, text.search(/\r?\n/)) || text.length);
	const count = (c: string) => firstLine.split(c).length - 1;
	const delimiter = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"' && field === '') quoted = true;
		else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

const empty = (row: TableCell[]) => row.every((c) => c == null || (typeof c === 'string' && !c.trim()));

/** Datei lesen – `sheet` wählt bei Excel das Blatt (ohne Angabe das erste) */
export async function readTable(data: Buffer, sheet?: string | null): Promise<Table> {
	if (data.length > MAX_TABLE_BYTES) throw new TableError('Die Datei ist zu groß (höchstens 15 MB).');
	let out: Table;
	if (isZip(data)) {
		let all: { sheet: string; data: TableCell[][] }[];
		try {
			all = (await readExcelFile(data)) as { sheet: string; data: TableCell[][] }[];
		} catch {
			throw new TableError('Die Excel-Datei lässt sich nicht lesen.');
		}
		if (!all.length) throw new TableError('Die Excel-Datei hat kein Blatt.');
		const chosen = all.find((s) => s.sheet === sheet) ?? all[0];
		out = { sheets: all.map((s) => s.sheet), sheet: chosen.sheet, rows: chosen.data };
	} else {
		const text = decodeText(data);
		if (text.includes('\u0000')) throw new TableError('Das ist weder eine Excel- noch eine CSV-Datei.');
		out = { sheets: ['CSV'], sheet: 'CSV', rows: parseCsv(text) };
	}
	while (out.rows.length && empty(out.rows[out.rows.length - 1])) out.rows.pop();
	while (out.rows.length && empty(out.rows[0])) out.rows.shift();
	if (out.rows.length > MAX_TABLE_ROWS + 1) throw new TableError(`Die Datei hat mehr als ${MAX_TABLE_ROWS.toLocaleString('de-AT')} Zeilen.`);
	return out;
}

/* ------------------------------------------------------------ Schreiben */

const dec = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 4, useGrouping: false });
const pad = (n: number) => String(n).padStart(2, '0');
/** Datum als „TT.MM.JJJJ" (für Datumsfelder um Mitternacht UTC) */
const dateText = (d: Date) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

function csvCell(v: TableCell): string {
	if (v == null) return '';
	let s: string;
	if (v instanceof Date) s = dateText(v);
	else if (typeof v === 'number') s = Number.isFinite(v) ? dec.format(v) : '';
	else if (typeof v === 'boolean') s = v ? 'ja' : 'nein';
	else {
		s = v;
		// Formeln in Excel verhindern
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	}
	return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function writeTable(format: 'xlsx' | 'csv', sheet: string, header: string[], rows: TableCell[][], widths: number[] = []): Promise<Buffer> {
	if (format === 'csv') {
		return Buffer.from('﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n', 'utf8');
	}
	const data = [
		header.map((h) => ({ value: h, fontWeight: 'bold' as const })),
		...rows.map((r) =>
			r.map((v) => {
				if (v == null || v === '') return null;
				if (v instanceof Date) return { value: v, type: Date, format: 'dd.mm.yyyy' };
				if (typeof v === 'boolean') return { value: v ? 'ja' : 'nein' };
				if (typeof v === 'number') return { value: v, type: Number };
				return { value: v, type: String };
			})
		)
	];
	return writeXlsxFile(data as never, { sheet: sheet.slice(0, 31), stickyRowsCount: 1, columns: header.map((_, i) => ({ width: widths[i] ?? 16 })) }).toBuffer();
}

export function tableResponse(format: 'xlsx' | 'csv', name: string, body: Buffer): Response {
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}.${format}"`,
			'content-length': String(body.length),
			'cache-control': 'no-store'
		}
	});
}
