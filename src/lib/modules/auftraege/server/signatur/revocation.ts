/**
 * Validierungsdaten für PAdES-B-LT: die Zertifikatsketten von Siegel und
 * Zeitstempel vervollständigen (fehlende Aussteller über „CA Issuers") und je
 * Zertifikat den Sperrstatus holen – erst per OCSP, sonst als Sperrliste
 * (CRL). Ist ein Zertifikat gesperrt, wird nicht signiert. Fehlt für ein
 * Zertifikat jede Sperrinformation, ist das Ergebnis „unvollständig" – die
 * Signatur bleibt dann B-T und wird nicht als B-LT ausgewiesen.
 */
import crypto, { X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { fetchBinary } from './net';
import { parseCertificate } from './cms';

export interface ValidationData {
	certs: Buffer[];
	ocsps: Buffer[];
	crls: Buffer[];
	/** Für jedes Zertifikat (außer den Wurzeln) liegt eine Sperrinformation bei */
	complete: boolean;
	notes: string[];
}

export class RevokedError extends Error {}

interface Entry {
	der: Buffer;
	x509: X509Certificate;
	cert: pkijs.Certificate;
}

const fingerprint = (der: Buffer) => crypto.createHash('sha256').update(der).digest('hex');

export function commonName(x: X509Certificate | string): string {
	const text = typeof x === 'string' ? x : x.subject;
	const lines = text.split('\n');
	const pick = (k: string) => lines.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1);
	return pick('CN') ?? pick('O') ?? text.replace(/\n/g, ', ');
}

function selfSigned(x: X509Certificate): boolean {
	try {
		return x.subject === x.issuer && x.verify(x.publicKey);
	} catch {
		return false;
	}
}

function issuedBy(child: X509Certificate, parent: X509Certificate): boolean {
	try {
		return child.checkIssued(parent) && child.verify(parent.publicKey);
	} catch {
		return false;
	}
}

function fromPem(data: Buffer): Buffer[] {
	const text = data.toString('latin1');
	if (!text.includes('-----BEGIN')) return [data];
	return [...text.matchAll(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/g)].map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
}

/** Adressen aus den Erweiterungen: OCSP und Aussteller (AIA), Sperrlisten (CDP) */
function urls(cert: pkijs.Certificate, kind: 'ocsp' | 'issuer' | 'crl'): string[] {
	const out: string[] = [];
	for (const ext of cert.extensions ?? []) {
		if (kind !== 'crl' && ext.extnID === '1.3.6.1.5.5.7.1.1') {
			const method = kind === 'ocsp' ? '1.3.6.1.5.5.7.48.1' : '1.3.6.1.5.5.7.48.2';
			for (const d of (ext.parsedValue as pkijs.InfoAccess | undefined)?.accessDescriptions ?? []) {
				if (d.accessMethod === method && d.accessLocation.type === 6) out.push(String(d.accessLocation.value));
			}
		}
		if (kind === 'crl' && ext.extnID === '2.5.29.31') {
			for (const p of (ext.parsedValue as pkijs.CRLDistributionPoints | undefined)?.distributionPoints ?? []) {
				const names = Array.isArray(p.distributionPoint) ? p.distributionPoint : [];
				for (const n of names) if (n.type === 6) out.push(String(n.value));
			}
		}
	}
	return out.filter((u) => /^https?:\/\//i.test(u));
}

function hasOcspNoCheck(cert: pkijs.Certificate) {
	return !!cert.extensions?.some((e) => e.extnID === '1.3.6.1.5.5.7.48.1.5');
}

function entry(der: Buffer): Entry | null {
	try {
		return { der, x509: new X509Certificate(der), cert: parseCertificate(der) };
	} catch {
		return null;
	}
}

/** Fehlende Aussteller über „CA Issuers" holen (DER, PEM oder PKCS#7) */
async function fetchIssuers(cert: pkijs.Certificate): Promise<Buffer[]> {
	const found: Buffer[] = [];
	for (const url of urls(cert, 'issuer')) {
		try {
			const body = await fetchBinary(url, { timeout: 10_000, maxBytes: 2 * 1024 * 1024 });
			for (const der of fromPem(body)) {
				const parsed = asn1js.fromBER(new Uint8Array(der));
				if (parsed.offset === -1) continue;
				try {
					const info = new pkijs.ContentInfo({ schema: parsed.result });
					const sd = new pkijs.SignedData({ schema: info.content });
					for (const c of sd.certificates ?? []) if (c instanceof pkijs.Certificate) found.push(Buffer.from(c.toSchema().toBER()));
				} catch {
					found.push(der);
				}
			}
		} catch {
			/* nächste Adresse */
		}
	}
	return found;
}

async function ocsp(cert: pkijs.Certificate, issuer: pkijs.Certificate, url: string) {
	const request = new pkijs.OCSPRequest();
	await request.createForCertificate(cert, { hashAlgorithm: 'SHA-1', issuerCertificate: issuer });
	const der = await fetchBinary(url, {
		method: 'POST',
		headers: { 'content-type': 'application/ocsp-request', accept: 'application/ocsp-response' },
		body: Buffer.from(request.toSchema(true).toBER()),
		timeout: 10_000,
		maxBytes: 1024 * 1024
	});
	const response = pkijs.OCSPResponse.fromBER(new Uint8Array(der));
	if (response.responseStatus.valueBlock.valueDec !== 0 || !response.responseBytes) throw new Error('OCSP ohne Ergebnis');
	const basic = pkijs.BasicOCSPResponse.fromBER(new Uint8Array(response.responseBytes.response.valueBlock.valueHexView));
	const status = await basic.getCertificateStatus(cert, issuer);
	if (!status.isForCertificate) throw new Error('OCSP-Antwort betrifft ein anderes Zertifikat');
	return { der, status: status.status, responders: (basic.certs ?? []).map((c) => Buffer.from(c.toSchema().toBER())) };
}

async function crl(cert: pkijs.Certificate, issuer: pkijs.Certificate, url: string) {
	const [der] = fromPem(await fetchBinary(url, { timeout: 20_000, maxBytes: 20 * 1024 * 1024 }));
	const list = pkijs.CertificateRevocationList.fromBER(new Uint8Array(der));
	if (!(await list.verify({ issuerCertificate: issuer }))) throw new Error('Sperrliste nicht vom Aussteller signiert');
	const revoked = !!list.revokedCertificates?.some((r) => r.userCertificate.isEqual(cert.serialNumber));
	return { der, revoked };
}

/**
 * Für jede Kette (Signaturzertifikat zuerst) Aussteller und Sperrstatus
 * sammeln. Wirft RevokedError, wenn ein Zertifikat gesperrt ist.
 */
export async function collectValidationData(chains: Buffer[][]): Promise<ValidationData> {
	const pool = new Map<string, Entry>();
	const add = (der: Buffer) => {
		const key = fingerprint(der);
		if (!pool.has(key)) {
			const e = entry(der);
			if (e) pool.set(key, e);
		}
		return pool.get(key) ?? null;
	};
	for (const chain of chains) for (const der of chain) add(der);

	const out: ValidationData = { certs: [], ocsps: [], crls: [], complete: true, notes: [] };
	const inPaths = new Map<string, Entry>();
	const pairs: { cert: Entry; issuer: Entry }[] = [];
	for (const chain of chains) {
		if (!chain.length) continue;
		let current = add(chain[0]);
		for (let depth = 0; current && depth < 8; depth++) {
			inPaths.set(fingerprint(current.der), current);
			if (selfSigned(current.x509)) break;
			const find = () => [...pool.values()].find((p) => p !== current && issuedBy(current!.x509, p.x509));
			let issuer = find();
			if (!issuer) {
				for (const der of await fetchIssuers(current.cert)) add(der);
				issuer = find();
			}
			if (!issuer) {
				out.complete = false;
				out.notes.push(`Aussteller von „${commonName(current.x509)}" nicht gefunden.`);
				break;
			}
			if (!pairs.some((p) => p.cert === current)) pairs.push({ cert: current, issuer });
			current = issuer;
		}
	}

	const extra: Buffer[] = [];
	for (const { cert, issuer } of pairs) {
		const name = commonName(cert.x509);
		if (hasOcspNoCheck(cert.cert)) continue;
		let done = false;
		for (const url of urls(cert.cert, 'ocsp')) {
			try {
				const r = await ocsp(cert.cert, issuer.cert, url);
				if (r.status === 1) throw new RevokedError(`Das Zertifikat „${name}" ist gesperrt.`);
				if (r.status !== 0) continue;
				out.ocsps.push(r.der);
				extra.push(...r.responders);
				done = true;
				break;
			} catch (err) {
				if (err instanceof RevokedError) throw err;
			}
		}
		if (!done) {
			for (const url of urls(cert.cert, 'crl')) {
				try {
					const r = await crl(cert.cert, issuer.cert, url);
					if (r.revoked) throw new RevokedError(`Das Zertifikat „${name}" steht auf der Sperrliste.`);
					out.crls.push(r.der);
					done = true;
					break;
				} catch (err) {
					if (err instanceof RevokedError) throw err;
				}
			}
		}
		if (!done) {
			out.complete = false;
			out.notes.push(`Keine Sperrinformation für „${name}" erhältlich.`);
		}
	}
	const seen = new Set<string>();
	for (const der of [...[...inPaths.values()].map((e) => e.der), ...extra]) {
		const key = fingerprint(der);
		if (seen.has(key)) continue;
		seen.add(key);
		out.certs.push(der);
	}
	return out;
}
