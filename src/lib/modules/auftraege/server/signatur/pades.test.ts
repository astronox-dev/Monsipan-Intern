import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkSignedData, sha256 } from './cms';
import { createSelfSigned, readKeyFile, readP12, writeKeyFile } from './keys';
import { setFetcher } from './net';
import { addDss, signPdf } from './pades';
import { readXref } from './pdf-update';
import { collectValidationData, RevokedError } from './revocation';
import { makeCert, makeCrl, makeToken, signerFor, tsaReply, type TestCert } from './testkit';
import { requestTimestamp, TimestampError } from './tsa';
import { inspectPdf } from './verify-pdf';

async function samplePdf(text = 'Rechnung Nr. 26 659'): Promise<Buffer> {
	const doc = new PDFDocument({ size: 'A4', pdfVersion: '1.7', info: { Title: 'Test' } });
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
	doc.on('data', (c: Buffer) => chunks.push(c));
	doc.fontSize(20).text(text);
	doc.addPage().text('Seite 2');
	doc.end();
	return done;
}

let ca: TestCert;
let leaf: TestCert;
let tsa: TestCert;
const CRL_URL = 'http://ca.test/ca.crl';

beforeAll(async () => {
	ca = await makeCert({ cn: 'Test-CA', ca: true });
	leaf = await makeCert({ cn: 'Monsipan Rechnungssiegel', issuer: ca, crlUrl: CRL_URL });
	tsa = await makeCert({ cn: 'Test-TSA', issuer: ca, tsa: true, crlUrl: CRL_URL });
});

afterEach(() => setFetcher());

describe('PAdES-B-B', () => {
	it('signiert, ohne die bisherigen Bytes zu ändern', async () => {
		const pdf = await samplePdf();
		const { pdf: signed, level } = await signPdf(pdf, { level: 'B-B', signer: signerFor(leaf, [ca]), name: 'Monsipan', reason: 'Rechnung gesiegelt' });
		expect(level).toBe('B-B');
		expect(signed.subarray(0, pdf.length).equals(pdf)).toBe(true);
		expect(signed.toString('latin1')).toContain('/SubFilter /ETSI.CAdES.detached');
		const check = inspectPdf(signed);
		expect(check.ok).toBe(true);
		expect(check.level).toBe('B-B');
		expect(check.signatures).toHaveLength(1);
		expect(check.signatures[0].signer?.name).toBe('Monsipan Rechnungssiegel');
		// CAdES-Baseline: signing-certificate-v2 ja, signing-time nein
		expect(check.signatures[0].hasSigningCertificate).toBe(true);
		expect(check.signatures[0].hasSigningTime).toBe(false);
		expect(check.unsignedTail).toBe(0);
		// Die neue Revision verweist auf die alte
		expect(readXref(signed).startxref).toBeGreaterThan(pdf.length);
	});

	it('erkennt jede Änderung im signierten Bereich', async () => {
		const pdf = await samplePdf();
		const { pdf: signed } = await signPdf(pdf, { level: 'B-B', signer: signerFor(leaf, [ca]) });
		const at = signed.indexOf('/Title', 0, 'latin1');
		const tampered = Buffer.from(signed);
		tampered[at + 8] ^= 0x01;
		const check = inspectPdf(tampered);
		expect(check.ok).toBe(false);
		expect(check.signatures[0].problems.join(' ')).toMatch(/verändert/);
	});

	it('meldet Angehängtes außerhalb der Signatur', async () => {
		const pdf = await samplePdf();
		const { pdf: signed } = await signPdf(pdf, { level: 'B-B', signer: signerFor(leaf, [ca]) });
		const check = inspectPdf(Buffer.concat([signed, Buffer.from('\n% nachträglich\n')]));
		expect(check.signatures[0].ok).toBe(true);
		expect(check.unsignedTail).toBeGreaterThan(0);
	});

	it('lehnt eine Signatur mit fremdem Schlüssel ab', async () => {
		const pdf = await samplePdf();
		const other = await makeCert({ cn: 'Fremd' });
		const signer = { ...signerFor(leaf, [ca]), sign: async (data: Buffer) => crypto.sign('sha256', data, other.key) };
		const { pdf: signed } = await signPdf(pdf, { level: 'B-B', signer });
		const check = inspectPdf(signed);
		expect(check.ok).toBe(false);
		expect(check.signatures[0].problems.join(' ')).toMatch(/mathematisch ungültig/);
	});
});

describe('PAdES-B-T bis B-LTA', () => {
	const timestamp = (data: Buffer) => makeToken(tsa, data, [ca]);

	it('B-T: Zeitstempel über den Signaturwert', async () => {
		const { pdf: signed, level, timestampAt } = await signPdf(await samplePdf(), { level: 'B-T', signer: signerFor(leaf, [ca]), timestamp });
		expect(level).toBe('B-T');
		expect(timestampAt).toBeInstanceOf(Date);
		const check = inspectPdf(signed);
		expect(check.ok).toBe(true);
		expect(check.level).toBe('B-T');
		expect(check.signatures[0].timestamp?.ok).toBe(true);
		expect(check.signatures[0].timestamp?.tsa?.name).toBe('Test-TSA');
	});

	it('B-LT: Zertifikate und Sperrliste im DSS', async () => {
		const crl = await makeCrl(ca);
		setFetcher(async (url) => {
			if (url === CRL_URL) return crl;
			throw new Error(`unerwartet: ${url}`);
		});
		const { pdf: signed, level, notes } = await signPdf(await samplePdf(), {
			level: 'B-LT',
			signer: signerFor(leaf, [ca]),
			timestamp,
			validation: collectValidationData
		});
		expect(notes).toEqual([]);
		expect(level).toBe('B-LT');
		const check = inspectPdf(signed);
		expect(check.ok).toBe(true);
		expect(check.level).toBe('B-LT');
		expect(check.dss?.certs).toBe(3);
		expect(check.dss?.crls).toBe(1);
		expect(check.unsignedTail).toBeGreaterThan(0);
	});

	it('B-LTA: Dokument-Zeitstempel über alles', async () => {
		const crl = await makeCrl(ca);
		setFetcher(async () => crl);
		const { pdf: signed, level } = await signPdf(await samplePdf(), { level: 'B-LTA', signer: signerFor(leaf, [ca]), timestamp, validation: collectValidationData });
		expect(level).toBe('B-LTA');
		const check = inspectPdf(signed);
		expect(check.ok).toBe(true);
		expect(check.level).toBe('B-LTA');
		expect(check.signatures.map((s) => s.kind)).toEqual(['signatur', 'zeitstempel']);
		expect(check.unsignedTail).toBe(0);
	});

	it('weist ohne Sperrinformation nur B-T aus', async () => {
		setFetcher(async () => {
			throw new Error('offline');
		});
		const { level, notes } = await signPdf(await samplePdf(), { level: 'B-LT', signer: signerFor(leaf, [ca]), timestamp, validation: collectValidationData });
		expect(level).toBe('B-T');
		expect(notes.join(' ')).toMatch(/Sperrinformation/);
	});

	it('signiert nicht mit einem gesperrten Zertifikat', async () => {
		const crl = await makeCrl(ca, [leaf]);
		setFetcher(async () => crl);
		await expect(signPdf(await samplePdf(), { level: 'B-LT', signer: signerFor(leaf, [ca]), timestamp, validation: collectValidationData })).rejects.toBeInstanceOf(RevokedError);
	});

	it('ergänzt einen bestehenden DSS', async () => {
		const { pdf: signed } = await signPdf(await samplePdf(), { level: 'B-T', signer: signerFor(leaf, [ca]), timestamp });
		const once = addDss(signed, { certs: [ca.der], ocsps: [], crls: [] });
		const twice = addDss(once, { certs: [leaf.der], ocsps: [], crls: [await makeCrl(ca)] });
		expect(inspectPdf(twice).dss).toMatchObject({ certs: 2, crls: 1 });
		expect(inspectPdf(twice).ok).toBe(true);
	});
});

describe('Zeitstempeldienst', () => {
	it('holt und prüft ein Token', async () => {
		setFetcher(async (_url, opts) => tsaReply(tsa, opts!.body as Buffer, [ca]));
		const data = Buffer.from('Signaturwert');
		const token = await requestTimestamp({ url: 'http://tsa.test' }, data);
		expect(token.length).toBeGreaterThan(500);
	});

	it('lehnt ein Token über andere Daten ab', async () => {
		setFetcher(async (_url, opts) => tsaReply(tsa, opts!.body as Buffer, [ca], { wrongImprint: true }));
		await expect(requestTimestamp({ url: 'http://tsa.test' }, Buffer.from('x'))).rejects.toBeInstanceOf(TimestampError);
	});

	it('meldet einen nicht erreichbaren Dienst', async () => {
		setFetcher(async () => {
			throw new Error('ECONNREFUSED');
		});
		await expect(requestTimestamp({ url: 'http://tsa.test' }, Buffer.from('x'))).rejects.toThrow(/nicht erreichbar/);
	});
});

describe('Schlüssel und Zertifikate', () => {
	it('erzeugt ein Siegel, legt es verschlüsselt ab und liest es wieder', async () => {
		const made = createSelfSigned({ organization: 'Monsipan Bautenschutz GesmbH', commonName: 'Monsipan – Rechnungssiegel', country: 'at', years: 5 });
		const file = writeKeyFile(made, 'ein-langes-passwort');
		expect(file).toContain('ENCRYPTED PRIVATE KEY');
		expect(() => readKeyFile(file, 'falsch-falsch-falsch')).toThrow(/Passwort/);
		const back = readKeyFile(file, 'ein-langes-passwort');
		const signer = { certificates: back.certificates, algorithm: 'rsa-sha256' as const, sign: async (d: Buffer) => crypto.sign('sha256', d, back.key) };
		const { pdf } = await signPdf(await samplePdf(), { level: 'B-B', signer });
		const check = inspectPdf(pdf);
		expect(check.ok).toBe(true);
		expect(check.signatures[0].signer).toMatchObject({ name: 'Monsipan – Rechnungssiegel', organization: 'Monsipan Bautenschutz GesmbH', selfSigned: true });
	});

	it('verlangt ein ausreichend langes Passwort', () => {
		const made = createSelfSigned({ organization: 'X', commonName: 'X', country: 'AT', years: 1 });
		expect(() => writeKeyFile(made, 'kurz')).toThrow(/12 Zeichen/);
	});

	it('liest eine .p12-Datei mit Kette', async () => {
		const forge = (await import('node-forge')).default;
		const made = createSelfSigned({ organization: 'Firma', commonName: 'Siegel', country: 'AT', years: 1 });
		const key = forge.pki.privateKeyFromPem(made.key.export({ type: 'pkcs1', format: 'pem' }) as string);
		const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(made.certificates[0].toString('binary'))));
		const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, [cert], 'geheim', { algorithm: '3des' })).getBytes();
		const back = readP12(Buffer.from(p12, 'binary'), 'geheim');
		expect(back.certificates[0].equals(made.certificates[0])).toBe(true);
		expect(() => readP12(Buffer.from(p12, 'binary'), 'falsch')).toThrow(/Passwort/);
	});
});

describe('CMS', () => {
	it('prüft den Inhalt gegen message-digest', async () => {
		const { createSignedData, encodeSignedData } = await import('./cms');
		const data = Buffer.from('Inhalt');
		const { signedData } = await createSignedData({ signer: signerFor(leaf, [ca]), contentDigest: sha256(data) });
		const der = encodeSignedData(signedData);
		expect(checkSignedData(der, data).ok).toBe(true);
		expect(checkSignedData(der, Buffer.from('Inhalt!')).ok).toBe(false);
	});
});
