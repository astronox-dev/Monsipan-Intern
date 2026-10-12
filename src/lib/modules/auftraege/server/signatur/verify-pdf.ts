/**
 * Signaturen in einem PDF prüfen – unabhängig davon, wer sie erstellt hat:
 * jede ByteRange finden, die signierten Bytes hashen, das CMS bzw. den
 * Dokument-Zeitstempel prüfen und feststellen, welche PAdES-Stufe vorliegt.
 */
import { checkSignedData, checkTimestampToken } from './cms';
import { certInfo, validAt, type CertInfo } from './cert';
import { arrayRefs, getRef, objectText, readXref } from './pdf-update';
import type { PadesLevel } from './pades';

export interface TimestampResult {
	ok: boolean;
	time: string | null;
	tsa: CertInfo | null;
	problems: string[];
}

export interface PdfSignature {
	kind: 'signatur' | 'zeitstempel';
	subFilter: string;
	byteRange: number[];
	/** Ende der signierten Revision (Byte-Position) */
	revisionEnd: number;
	ok: boolean;
	problems: string[];
	signer: CertInfo | null;
	/** Mitgelieferte Zertifikate (DER), Signaturzertifikat zuerst */
	certificates: Buffer[];
	/** Angegebene Signaturzeit (/M) – verbindlich ist der Zeitstempel */
	claimedTime: string | null;
	timestamp: TimestampResult | null;
	hasSigningCertificate: boolean;
	hasSigningTime: boolean;
}

export interface PdfInspection {
	signatures: PdfSignature[];
	dss: { certs: number; ocsps: number; crls: number; offset: number } | null;
	/** Erreichte PAdES-Stufe der ersten Signatur */
	level: PadesLevel | null;
	/** Bytes nach der letzten signierten Revision (z. B. Validierungsdaten) */
	unsignedTail: number;
	/** Alle Signaturen gültig und mindestens eine vorhanden */
	ok: boolean;
}

function pdfDateToIso(text: string | undefined): string | null {
	const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(text ?? '');
	if (!m) return null;
	const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m;
	const zone = !sign || sign === 'Z' ? 'Z' : `${sign}${oh}:${om}`;
	const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestampResult(token: Buffer, data: Buffer): TimestampResult {
	const check = checkTimestampToken(token, data);
	let tsa: CertInfo | null = null;
	try {
		tsa = check.tsa ? certInfo(check.tsa) : null;
	} catch {
		/* ohne Angaben */
	}
	return { ok: check.ok, time: check.time?.toISOString() ?? null, tsa, problems: check.problems };
}

export function inspectPdf(pdf: Buffer): PdfInspection {
	const text = pdf.toString('latin1');
	const signatures: PdfSignature[] = [];
	for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
		const br = m.slice(1, 5).map(Number);
		const start = text.lastIndexOf(' obj', m.index);
		const end = text.indexOf('endobj', m.index);
		const dict = text.slice(start < 0 ? m.index : start, end < 0 ? undefined : end);
		const subFilter = /\/SubFilter\s*\/([^\s/<>[\]()]+)/.exec(dict)?.[1] ?? '';
		const kind = /\/Type\s*\/DocTimeStamp\b/.test(dict) || subFilter === 'ETSI.RFC3161' ? 'zeitstempel' : 'signatur';
		const sig: PdfSignature = {
			kind,
			subFilter,
			byteRange: br,
			revisionEnd: br[2] + br[3],
			ok: false,
			problems: [],
			signer: null,
			certificates: [],
			claimedTime: pdfDateToIso(/\/M\s*\((D:[^)]*)\)/.exec(dict)?.[1]),
			timestamp: null,
			hasSigningCertificate: false,
			hasSigningTime: false
		};
		signatures.push(sig);
		const [a, b, c, d] = br;
		if (a !== 0 || b <= 0 || c <= b || c + d > pdf.length || pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) {
			sig.problems.push('Der signierte Bereich (ByteRange) ist ungültig.');
			continue;
		}
		const hex = text.slice(b + 1, c - 1);
		if (!/^[0-9A-Fa-f]*$/.test(hex)) {
			sig.problems.push('Der Signaturwert ist kein Hex-Text.');
			continue;
		}
		if (!/%%EOF\s*$/.test(text.slice(Math.max(0, c + d - 16), c + d))) sig.problems.push('Die signierte Revision endet nicht sauber mit %%EOF.');
		const contents = Buffer.from(hex, 'hex');
		const signed = Buffer.concat([pdf.subarray(0, b), pdf.subarray(c, c + d)]);

		if (kind === 'zeitstempel') {
			sig.timestamp = timestampResult(contents, signed);
			sig.problems.push(...sig.timestamp.problems);
			sig.signer = sig.timestamp.tsa;
		} else {
			if (subFilter !== 'ETSI.CAdES.detached') sig.problems.push(`Kein PAdES-Format (/SubFilter ${subFilter || 'fehlt'}).`);
			const cms = checkSignedData(contents, signed);
			sig.problems.push(...cms.problems);
			sig.hasSigningCertificate = cms.hasSigningCertificate;
			sig.hasSigningTime = cms.hasSigningTime;
			if (cms.signer) {
				sig.certificates = [cms.signer, ...cms.certificates.filter((x) => !x.equals(cms.signer!))];
				try {
					sig.signer = certInfo(cms.signer);
				} catch {
					sig.problems.push('Das Signaturzertifikat ist nicht lesbar.');
				}
			}
			if (cms.timestamps[0] && cms.signature) {
				sig.timestamp = timestampResult(cms.timestamps[0], cms.signature);
				sig.problems.push(...sig.timestamp.problems.map((p) => `Zeitstempel: ${p}`));
			}
			// Zertifikat zur Signaturzeit gültig – maßgeblich der Zeitstempel, sonst /M
			const when = sig.timestamp?.time ?? sig.claimedTime;
			if (sig.signer && when && !validAt(sig.signer, new Date(when))) sig.problems.push('Das Zertifikat war zum Zeitpunkt der Signatur nicht gültig.');
		}
		sig.ok = sig.problems.length === 0;
	}
	signatures.sort((x, y) => x.revisionEnd - y.revisionEnd);

	let dss: PdfInspection['dss'] = null;
	try {
		const xref = readXref(pdf);
		const ref = getRef(objectText(pdf, xref, xref.root.num), 'DSS');
		if (ref) {
			const dict = objectText(pdf, xref, ref.num);
			dss = {
				certs: arrayRefs(dict, 'Certs')?.length ?? 0,
				ocsps: arrayRefs(dict, 'OCSPs')?.length ?? 0,
				crls: arrayRefs(dict, 'CRLs')?.length ?? 0,
				offset: xref.offsets.get(ref.num) ?? 0
			};
		}
	} catch {
		/* fremdes PDF mit Querverweis-Streams – ohne DSS-Angabe */
	}

	const main = signatures.find((s) => s.kind === 'signatur');
	let level: PadesLevel | null = null;
	if (main && main.subFilter === 'ETSI.CAdES.detached') {
		level = main.timestamp ? 'B-T' : 'B-B';
		if (level === 'B-T' && dss && dss.offset > main.revisionEnd) {
			level = 'B-LT';
			if (signatures.some((s) => s.kind === 'zeitstempel' && s.revisionEnd > dss!.offset)) level = 'B-LTA';
		}
	}
	const lastEnd = signatures.reduce((m, s) => Math.max(m, s.revisionEnd), 0);
	return {
		signatures,
		dss,
		level,
		unsignedTail: signatures.length ? pdf.length - lastEnd : pdf.length,
		ok: signatures.length > 0 && signatures.every((s) => s.ok)
	};
}
