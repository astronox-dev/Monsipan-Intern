/**
 * Inkrementelle Aktualisierung von PDF-Dateien – nur so viel, wie Signaturen
 * brauchen: das Querverweisverzeichnis lesen (klassische xref-Tabellen, wie
 * pdfkit sie schreibt), einzelne Objekte holen und neue oder geänderte Objekte
 * hinten anhängen. Die bisherigen Bytes bleiben unverändert – genau das
 * verlangt eine PDF-Signatur: jede Ergänzung kommt als eigene Revision dazu.
 */

export class PdfUpdateError extends Error {}

export interface Ref {
	num: number;
	gen: number;
}

export interface PdfXref {
	/** /Size des neuesten Trailers – die nächste freie Objektnummer */
	size: number;
	root: Ref;
	info: Ref | null;
	/** /ID-Eintrag, wie er im Trailer steht */
	id: string | null;
	/** Wo das neueste xref steht – wird zu /Prev der nächsten Revision */
	startxref: number;
	/** Neueste Fassung je Objekt: Nummer → Byte-Position */
	offsets: Map<number, number>;
}

const latin = (buf: Buffer, start: number, end?: number) => buf.toString('latin1', start, end);
const refText = (r: Ref) => `${r.num} ${r.gen} R`;

function parseRef(text: string, key: string): Ref | null {
	const m = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(text);
	return m ? { num: Number(m[1]), gen: Number(m[2]) } : null;
}

/** Querverweise aller Revisionen lesen – die neueste Fassung eines Objekts gewinnt */
export function readXref(pdf: Buffer): PdfXref {
	const tail = latin(pdf, Math.max(0, pdf.length - 2048));
	const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
	if (!m) throw new PdfUpdateError('Das PDF-Ende fehlt (startxref/%%EOF).');
	const startxref = Number(m[1]);
	const offsets = new Map<number, number>();
	const known = new Set<number>();
	let newest: string | null = null;
	const visited = new Set<number>();
	let at: number | null = startxref;
	while (at != null) {
		if (visited.has(at) || at >= pdf.length) throw new PdfUpdateError('Das Querverweisverzeichnis ist beschädigt.');
		visited.add(at);
		if (latin(pdf, at, at + 4) !== 'xref') throw new PdfUpdateError('Querverweis-Streams werden nicht unterstützt.');
		const trailerAt = pdf.indexOf('trailer', at, 'latin1');
		if (trailerAt < 0) throw new PdfUpdateError('Der Trailer fehlt.');
		const lines = latin(pdf, at + 4, trailerAt)
			.split(/\r\n|\r|\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		let num = 0;
		let left = 0;
		for (const line of lines) {
			if (left === 0) {
				const head = /^(\d+)\s+(\d+)$/.exec(line);
				if (!head) throw new PdfUpdateError('Das Querverweisverzeichnis ist beschädigt.');
				num = Number(head[1]);
				left = Number(head[2]);
				continue;
			}
			const entry = /^(\d{10})\s+(\d{5})\s+([nf])$/.exec(line);
			if (!entry) throw new PdfUpdateError('Das Querverweisverzeichnis ist beschädigt.');
			if (!known.has(num)) {
				known.add(num);
				if (entry[3] === 'n') offsets.set(num, Number(entry[1]));
			}
			num++;
			left--;
		}
		const endAt = pdf.indexOf('startxref', trailerAt, 'latin1');
		const trailer = latin(pdf, trailerAt + 7, endAt < 0 ? undefined : endAt);
		newest ??= trailer;
		const prev = /\/Prev\s+(\d+)/.exec(trailer);
		at = prev ? Number(prev[1]) : null;
	}
	const trailer = newest ?? '';
	const size = /\/Size\s+(\d+)/.exec(trailer);
	const root = parseRef(trailer, 'Root');
	if (!size || !root) throw new PdfUpdateError('Im Trailer fehlen /Size oder /Root.');
	const id = /\/ID\s*(\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\])/.exec(trailer);
	return { size: Number(size[1]), root, info: parseRef(trailer, 'Info'), id: id ? id[1] : null, startxref, offsets };
}

/** Das Wörterbuch eines Objekts als Text (ohne „n g obj" und ohne Stream-Daten) */
export function objectText(pdf: Buffer, xref: PdfXref, num: number): string {
	const at = xref.offsets.get(num);
	if (at == null) throw new PdfUpdateError(`Objekt ${num} fehlt.`);
	const head = new RegExp(`^${num}\\s+(\\d+)\\s+obj`).exec(latin(pdf, at, at + 40));
	if (!head) throw new PdfUpdateError(`Objekt ${num} steht nicht dort, wo das Verzeichnis es erwartet.`);
	if (head[1] !== '0') throw new PdfUpdateError(`Objekt ${num} hat Generation ${head[1]} – nicht unterstützt.`);
	const end = pdf.indexOf('endobj', at, 'latin1');
	if (end < 0) throw new PdfUpdateError(`Objekt ${num} ist nicht abgeschlossen.`);
	let body = latin(pdf, at + head[0].length, end);
	const stream = /(>>)\s*stream[\r\n]/.exec(body);
	if (stream) body = body.slice(0, stream.index + 2);
	return body.trim();
}

export function getRef(dict: string, key: string): Ref | null {
	return parseRef(dict, key);
}

/** Verweise in einem Array-Eintrag (`/Key [1 0 R 2 0 R]`); null, wenn es keinen gibt */
export function arrayRefs(dict: string, key: string): string[] | null {
	const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
	if (!m) return null;
	return [...m[1].matchAll(/(\d+)\s+(\d+)\s+R/g)].map((r) => `${r[1]} ${r[2]} R`);
}

/**
 * Einen Eintrag setzen – ein schlichter Wert (Verweis, Name, Zahl oder
 * flaches Array) wird ersetzt, sonst kommt er vor das schließende „>>".
 */
export function setEntry(dict: string, key: string, value: string): string {
	const re = new RegExp(`/${key}(?![A-Za-z0-9])\\s*(\\d+\\s+\\d+\\s+R|\\[[^\\]]*\\]|/[^\\s/<>\\[\\]()]+|-?[\\d.]+)`);
	if (re.test(dict)) return dict.replace(re, `/${key} ${value}`);
	const end = dict.lastIndexOf('>>');
	if (end < 0) throw new PdfUpdateError('Kein Wörterbuch.');
	return `${dict.slice(0, end).trimEnd()}\n/${key} ${value}\n>>`;
}

/** Text für Namen, Gründe usw.: UTF-16BE mit BOM, damit Umlaute stimmen */
export function pdfText(text: string): string {
	const be = Buffer.from(text, 'utf16le').swap16();
	return `<FEFF${be.toString('hex').toUpperCase()}>`;
}

/** Datum im PDF-Format, in UTC */
export function pdfDate(d: Date): string {
	const p = (n: number, w = 2) => String(n).padStart(w, '0');
	return `(D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

export interface NewObject {
	num: number;
	/** Inhalt zwischen „n 0 obj" und „endobj" */
	data: Buffer | string;
}

/** Stream-Objekt (komprimierte Daten mit Länge) */
export function streamObject(compressed: Buffer, extra = ''): Buffer {
	return Buffer.concat([
		Buffer.from(`<<\n/Length ${compressed.length}\n/Filter /FlateDecode${extra ? `\n${extra}` : ''}\n>>\nstream\n`, 'latin1'),
		compressed,
		Buffer.from('\nendstream', 'latin1')
	]);
}

/**
 * Objekte als neue Revision anhängen: Objekte, eigenes xref, Trailer mit
 * /Prev auf das bisherige. Die alten Bytes bleiben unberührt.
 */
export function appendRevision(pdf: Buffer, xref: PdfXref, objects: NewObject[]): Buffer {
	if (!objects.length) return pdf;
	const parts: Buffer[] = [pdf];
	let pos = pdf.length;
	const last = pdf[pdf.length - 1];
	if (last !== 0x0a && last !== 0x0d) {
		parts.push(Buffer.from('\n', 'latin1'));
		pos += 1;
	}
	const placed = new Map<number, number>();
	for (const o of [...objects].sort((a, b) => a.num - b.num)) {
		if (placed.has(o.num)) throw new PdfUpdateError(`Objekt ${o.num} doppelt.`);
		placed.set(o.num, pos);
		const chunk = Buffer.concat([
			Buffer.from(`${o.num} 0 obj\n`, 'latin1'),
			typeof o.data === 'string' ? Buffer.from(o.data, 'latin1') : o.data,
			Buffer.from('\nendobj\n', 'latin1')
		]);
		parts.push(chunk);
		pos += chunk.length;
	}
	const nums = [...placed.keys()].sort((a, b) => a - b);
	let table = 'xref\n';
	for (let i = 0; i < nums.length; ) {
		let j = i;
		while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
		table += `${nums[i]} ${j - i + 1}\n`;
		for (let k = i; k <= j; k++) table += `${String(placed.get(nums[k])).padStart(10, '0')} 00000 n \n`;
		i = j + 1;
	}
	const size = Math.max(xref.size, nums[nums.length - 1] + 1);
	table += 'trailer\n<<\n';
	table += `/Size ${size}\n/Root ${refText(xref.root)}\n`;
	if (xref.info) table += `/Info ${refText(xref.info)}\n`;
	if (xref.id) table += `/ID ${xref.id}\n`;
	table += `/Prev ${xref.startxref}\n>>\nstartxref\n${pos}\n%%EOF\n`;
	parts.push(Buffer.from(table, 'latin1'));
	return Buffer.concat(parts);
}

/** Die erste Seite (Seitenbaum hinunter) – dort hängt das unsichtbare Signaturfeld */
export function firstPage(pdf: Buffer, xref: PdfXref): number {
	const catalog = objectText(pdf, xref, xref.root.num);
	let node = getRef(catalog, 'Pages');
	for (let depth = 0; node && depth < 20; depth++) {
		const dict = objectText(pdf, xref, node.num);
		if (!/\/Type\s*\/Pages\b/.test(dict)) return node.num;
		const kids = arrayRefs(dict, 'Kids');
		if (!kids?.length) break;
		node = { num: Number(kids[0].split(' ')[0]), gen: 0 };
	}
	throw new PdfUpdateError('Keine Seite gefunden.');
}
