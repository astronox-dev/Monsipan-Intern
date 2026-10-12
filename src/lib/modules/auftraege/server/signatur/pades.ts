/**
 * PAdES (ETSI EN 319 142-1) für fertige Rechnungs-PDFs:
 *
 * - B-B: unsichtbares Signaturfeld, /SubFilter /ETSI.CAdES.detached, CMS über
 *   die ByteRange (alles außer dem Signaturwert selbst)
 * - B-T: dazu ein Zeitstempel (RFC 3161) über den Signaturwert
 * - B-LT: dazu in einer weiteren Revision der Document Security Store (DSS)
 *   mit Zertifikaten und Sperrinformationen (OCSP/CRL) – prüfbar auch dann
 *   noch, wenn Aussteller und Dienste längst nicht mehr erreichbar sind
 * - B-LTA: dazu ein Dokument-Zeitstempel über alles, auch den DSS
 *
 * Jede Stufe hängt nur an – die Bytes davor bleiben, wie sie sind. Erreicht
 * wird nur, was tatsächlich drin ist: fehlen Sperrinformationen, heißt das
 * Ergebnis B-T, auch wenn B-LT gewünscht war.
 */
import zlib from 'node:zlib';
import {
	appendRevision,
	arrayRefs,
	firstPage,
	getRef,
	objectText,
	pdfDate,
	pdfText,
	readXref,
	setEntry,
	streamObject,
	PdfUpdateError,
	type NewObject
} from './pdf-update';
import { attachTimestamp, checkTimestampToken, createSignedData, encodeSignedData, sha256, type RawSigner } from './cms';
import type { ValidationData } from './revocation';

export const PADES_LEVELS = ['B-B', 'B-T', 'B-LT', 'B-LTA'] as const;
export type PadesLevel = (typeof PADES_LEVELS)[number];

const PLACEHOLDER = '/ByteRange [0 0000000000 0000000000 0000000000]';
/** Platz für CMS samt Kette und Zeitstempel bzw. für den Dokument-Zeitstempel (Bytes) */
const SIGNATURE_CAPACITY = 24_000;
const TIMESTAMP_CAPACITY = 16_000;

export interface Prepared {
	pdf: Buffer;
	/** Erstes Hex-Zeichen von /Contents */
	contentsAt: number;
	capacity: number;
	byteRange: [number, number, number, number];
}

export interface FieldOptions {
	kind: 'signatur' | 'zeitstempel';
	capacity: number;
	/** Name des Formularfelds */
	field: string;
	name?: string;
	reason?: string;
	location?: string;
	contact?: string;
	time?: Date;
}

/**
 * Unsichtbares Signaturfeld als neue Revision anlegen – mit Platzhalter für
 * den Signaturwert und fertig eingetragener ByteRange.
 */
export function prepareField(pdf: Buffer, o: FieldOptions): Prepared {
	const xref = readXref(pdf);
	const catalog = objectText(pdf, xref, xref.root.num);
	const pageNum = firstPage(pdf, xref);
	const page = objectText(pdf, xref, pageNum);
	let next = xref.size;
	const sigNum = next++;
	const widgetNum = next++;
	const objects: NewObject[] = [];

	const sig =
		o.kind === 'signatur'
			? ['/Type /Sig', '/Filter /Adobe.PPKLite', '/SubFilter /ETSI.CAdES.detached']
			: ['/Type /DocTimeStamp', '/Filter /Adobe.PPKLite', '/SubFilter /ETSI.RFC3161'];
	sig.push(PLACEHOLDER, `/Contents <${'0'.repeat(o.capacity * 2)}>`);
	if (o.time) sig.push(`/M ${pdfDate(o.time)}`);
	if (o.name) sig.push(`/Name ${pdfText(o.name)}`);
	if (o.reason) sig.push(`/Reason ${pdfText(o.reason)}`);
	if (o.location) sig.push(`/Location ${pdfText(o.location)}`);
	if (o.contact) sig.push(`/ContactInfo ${pdfText(o.contact)}`);
	objects.push({ num: sigNum, data: `<<\n${sig.join('\n')}\n>>` });
	objects.push({
		num: widgetNum,
		data: `<<\n/Type /Annot\n/Subtype /Widget\n/FT /Sig\n/F 132\n/Rect [0 0 0 0]\n/T ${pdfText(o.field)}\n/V ${sigNum} 0 R\n/P ${pageNum} 0 R\n>>`
	});

	// Formular: neues Feld eintragen, SigFlags 3 (signiert, nur anhängen)
	let newCatalog = catalog;
	const formRef = getRef(catalog, 'AcroForm');
	if (formRef) {
		const form = objectText(pdf, xref, formRef.num);
		const fields = arrayRefs(form, 'Fields') ?? [];
		objects.push({ num: formRef.num, data: setEntry(setEntry(form, 'Fields', `[${[...fields, `${widgetNum} 0 R`].join(' ')}]`), 'SigFlags', '3') });
	} else {
		if (/\/AcroForm\s*<</.test(catalog)) throw new PdfUpdateError('Eingebettete Formulare werden nicht unterstützt.');
		const formNum = next++;
		objects.push({ num: formNum, data: `<<\n/Fields [${widgetNum} 0 R]\n/SigFlags 3\n>>` });
		newCatalog = setEntry(newCatalog, 'AcroForm', `${formNum} 0 R`);
	}
	if (newCatalog !== catalog) objects.push({ num: xref.root.num, data: newCatalog });

	// Das Feld gehört auf die erste Seite
	const annotsRef = getRef(page, 'Annots');
	if (annotsRef) {
		const list = objectText(pdf, xref, annotsRef.num);
		if (!/\]\s*$/.test(list)) throw new PdfUpdateError('Die Anmerkungen der Seite sind nicht lesbar.');
		objects.push({ num: annotsRef.num, data: list.replace(/\]\s*$/, ` ${widgetNum} 0 R]`) });
	} else {
		if (/\/Annots\s*\[[^\]]*<</.test(page)) throw new PdfUpdateError('Eingebettete Anmerkungen werden nicht unterstützt.');
		const annots = arrayRefs(page, 'Annots') ?? [];
		objects.push({ num: pageNum, data: setEntry(page, 'Annots', `[${[...annots, `${widgetNum} 0 R`].join(' ')}]`) });
	}

	const out = appendRevision(pdf, { ...xref, size: next }, objects);
	const at = out.indexOf(PLACEHOLDER, pdf.length, 'latin1');
	const lt = out.indexOf('/Contents <', at, 'latin1') + '/Contents '.length;
	const gt = lt + 1 + o.capacity * 2;
	if (at < 0 || out[lt] !== 0x3c || out[gt] !== 0x3e) throw new PdfUpdateError('Der Platzhalter der Signatur fehlt.');
	const byteRange: Prepared['byteRange'] = [0, lt, gt + 1, out.length - gt - 1];
	const text = `/ByteRange [${byteRange.join(' ')}]`;
	if (text.length > PLACEHOLDER.length) throw new PdfUpdateError('Das PDF ist zu groß.');
	out.write(text.padEnd(PLACEHOLDER.length, ' '), at, 'latin1');
	return { pdf: out, contentsAt: lt + 1, capacity: o.capacity, byteRange };
}

/** Die Bytes, über die signiert wird: alles außer dem Platz für den Signaturwert */
export function signedBytes(p: Prepared): Buffer {
	const [, b, c, d] = p.byteRange;
	return Buffer.concat([p.pdf.subarray(0, b), p.pdf.subarray(c, c + d)]);
}

/** Signaturwert (DER) in den Platzhalter schreiben */
export function embed(p: Prepared, der: Buffer): Buffer {
	const hex = der.toString('hex').toUpperCase();
	if (hex.length > p.capacity * 2) throw new Error(`Die Signatur ist zu groß (${der.length} Bytes, Platz für ${p.capacity}).`);
	p.pdf.write(hex, p.contentsAt, 'latin1');
	return p.pdf;
}

/** Document Security Store anlegen bzw. ergänzen – als eigene Revision */
export function addDss(pdf: Buffer, data: Pick<ValidationData, 'certs' | 'ocsps' | 'crls'>): Buffer {
	const xref = readXref(pdf);
	let catalog = objectText(pdf, xref, xref.root.num);
	let next = xref.size;
	const objects: NewObject[] = [];
	const dssRef = getRef(catalog, 'DSS');
	const old = dssRef ? objectText(pdf, xref, dssRef.num) : '';
	const streams = (list: Buffer[]) => {
		const seen = new Set<string>();
		const refs: string[] = [];
		for (const item of list) {
			const key = sha256(item).toString('hex');
			if (seen.has(key)) continue;
			seen.add(key);
			const num = next++;
			objects.push({ num, data: streamObject(zlib.deflateSync(item)) });
			refs.push(`${num} 0 R`);
		}
		return refs;
	};
	const entries: [string, string[]][] = [
		['Certs', [...(arrayRefs(old, 'Certs') ?? []), ...streams(data.certs)]],
		['OCSPs', [...(arrayRefs(old, 'OCSPs') ?? []), ...streams(data.ocsps)]],
		['CRLs', [...(arrayRefs(old, 'CRLs') ?? []), ...streams(data.crls)]]
	];
	const dssNum = dssRef?.num ?? next++;
	objects.push({
		num: dssNum,
		data: `<<\n/Type /DSS\n${entries
			.filter(([, refs]) => refs.length)
			.map(([k, refs]) => `/${k} [${refs.join(' ')}]`)
			.join('\n')}\n>>`
	});
	if (!dssRef) catalog = setEntry(catalog, 'DSS', `${dssNum} 0 R`);
	// Hinweis für Prüfprogramme: PDF mit ETSI-Erweiterungen (DSS, Dokument-Zeitstempel)
	if (!/\/Extensions\b/.test(catalog)) {
		catalog = `${catalog.slice(0, catalog.lastIndexOf('>>')).trimEnd()}\n/Extensions << /ESIC << /BaseVersion /1.7 /ExtensionLevel 1 >> >>\n>>`;
	}
	objects.push({ num: xref.root.num, data: catalog });
	return appendRevision(pdf, { ...xref, size: next }, objects);
}

export interface PadesOptions {
	level: PadesLevel;
	signer: RawSigner;
	/** Zeitstempel über die Daten holen (Token, DER) – nötig ab B-T */
	timestamp?: (data: Buffer) => Promise<Buffer>;
	/** Zertifikatsketten prüfen und Validierungsdaten sammeln – nötig ab B-LT */
	validation?: (chains: Buffer[][]) => Promise<ValidationData>;
	field?: string;
	name?: string;
	reason?: string;
	location?: string;
	contact?: string;
	time?: Date;
}

export interface PadesResult {
	pdf: Buffer;
	/** Tatsächlich erreichte Stufe */
	level: PadesLevel;
	signedAt: Date;
	timestampAt: Date | null;
	/** Zeitstempeldienst: sein Zertifikat zuerst */
	tsaCertificates: Buffer[];
	notes: string[];
}

export async function signPdf(pdf: Buffer, o: PadesOptions): Promise<PadesResult> {
	const signedAt = o.time ?? new Date();
	const notes: string[] = [];
	const prepared = prepareField(pdf, {
		kind: 'signatur',
		capacity: SIGNATURE_CAPACITY,
		field: o.field ?? 'Signatur',
		name: o.name,
		reason: o.reason,
		location: o.location,
		contact: o.contact,
		time: signedAt
	});
	const { signedData, signature } = await createSignedData({ signer: o.signer, contentDigest: sha256(signedBytes(prepared)) });

	let level: PadesLevel = 'B-B';
	let timestampAt: Date | null = null;
	let tsaCertificates: Buffer[] = [];
	if (o.level !== 'B-B') {
		if (!o.timestamp) throw new Error('Für diese Stufe braucht es einen Zeitstempeldienst.');
		const token = await o.timestamp(signature);
		const check = checkTimestampToken(token, signature);
		if (!check.ok) throw new Error(`Zeitstempel ungültig: ${check.problems.join(' ')}`);
		attachTimestamp(signedData, token);
		timestampAt = check.time;
		tsaCertificates = check.tsa ? [check.tsa, ...check.certificates.filter((c) => !c.equals(check.tsa!))] : check.certificates;
		level = 'B-T';
	}
	let out = embed(prepared, encodeSignedData(signedData));

	if (o.level === 'B-LT' || o.level === 'B-LTA') {
		if (!o.validation) throw new Error('Für diese Stufe braucht es die Sammlung der Validierungsdaten.');
		const data = await o.validation([o.signer.certificates, tsaCertificates]);
		out = addDss(out, data);
		if (data.complete) level = 'B-LT';
		else notes.push(...data.notes, 'Validierungsdaten unvollständig – die Signatur gilt als PAdES-B-T.');
		if (o.level === 'B-LTA') {
			const ts = prepareField(out, { kind: 'zeitstempel', capacity: TIMESTAMP_CAPACITY, field: 'Archivzeitstempel' });
			const bytes = signedBytes(ts);
			const token = await o.timestamp!(bytes);
			const check = checkTimestampToken(token, bytes);
			if (!check.ok) throw new Error(`Archivzeitstempel ungültig: ${check.problems.join(' ')}`);
			out = embed(ts, token);
			if (level === 'B-LT') level = 'B-LTA';
		}
	}
	return { pdf: out, level, signedAt, timestampAt, tsaCertificates, notes };
}
