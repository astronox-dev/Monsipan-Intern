/**
 * Nur für Tests: eine kleine Zertifizierungsstelle mit Siegel- und
 * Zeitstempelzertifikaten, Sperrlisten und ein Zeitstempeldienst – alles
 * lokal, ohne Netz.
 */
import crypto from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { createSignedData, encodeSignedData, OID, sha256, type RawSigner } from './cms';

export interface TestCert {
	der: Buffer;
	key: crypto.KeyObject;
	cryptoKey: CryptoKey;
	cert: pkijs.Certificate;
}

const subtle = crypto.webcrypto.subtle as SubtleCrypto;

function ext(id: string, value: { toSchema(): asn1js.AsnType }, critical = false) {
	return new pkijs.Extension({ extnID: id, critical, extnValue: value.toSchema().toBER(false) });
}

function bits(byte: number, unused: number) {
	return { toSchema: () => new asn1js.BitString({ valueHex: new Uint8Array([byte]).buffer, unusedBits: unused }) };
}

export async function makeCert(o: {
	cn: string;
	issuer?: TestCert;
	ca?: boolean;
	tsa?: boolean;
	crlUrl?: string;
	ocspUrl?: string;
	notBefore?: Date;
	notAfter?: Date;
}): Promise<TestCert> {
	const keys = (await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
		'sign',
		'verify'
	])) as CryptoKeyPair;
	const cert = new pkijs.Certificate();
	cert.version = 2;
	const serial = crypto.randomBytes(8);
	serial[0] &= 0x7f;
	cert.serialNumber = new asn1js.Integer({ valueHex: new Uint8Array(serial).buffer });
	cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: o.cn }) }));
	if (o.issuer) cert.issuer = o.issuer.cert.subject;
	else cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: o.cn }) }));
	cert.notBefore.value = o.notBefore ?? new Date(Date.now() - 86_400_000);
	cert.notAfter.value = o.notAfter ?? new Date(Date.now() + 365 * 86_400_000);
	const extensions = [
		ext('2.5.29.19', new pkijs.BasicConstraints({ cA: !!o.ca }), true),
		ext('2.5.29.15', o.ca ? bits(0x06, 1) : bits(0xc0, 6), true)
	];
	if (o.tsa) extensions.push(ext('2.5.29.37', new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }), true));
	if (o.crlUrl) {
		extensions.push(
			ext('2.5.29.31', new pkijs.CRLDistributionPoints({ distributionPoints: [new pkijs.DistributionPoint({ distributionPoint: [new pkijs.GeneralName({ type: 6, value: o.crlUrl })] })] }))
		);
	}
	if (o.ocspUrl) {
		extensions.push(
			ext(
				'1.3.6.1.5.5.7.1.1',
				new pkijs.InfoAccess({ accessDescriptions: [new pkijs.AccessDescription({ accessMethod: '1.3.6.1.5.5.7.48.1', accessLocation: new pkijs.GeneralName({ type: 6, value: o.ocspUrl }) })] })
			)
		);
	}
	cert.extensions = extensions;
	await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
	await cert.sign(o.issuer?.cryptoKey ?? keys.privateKey, 'SHA-256');
	const der = Buffer.from(cert.toSchema(true).toBER());
	return { der, key: crypto.KeyObject.from(keys.privateKey), cryptoKey: keys.privateKey, cert: pkijs.Certificate.fromBER(new Uint8Array(der)) };
}

export function signerFor(leaf: TestCert, chain: TestCert[] = []): RawSigner {
	return {
		certificates: [leaf.der, ...chain.map((c) => c.der)],
		algorithm: 'rsa-sha256',
		sign: async (data) => crypto.sign('sha256', data, leaf.key)
	};
}

/** Sperrliste der Stelle `ca`, optional mit gesperrten Zertifikaten */
export async function makeCrl(ca: TestCert, revoked: TestCert[] = []): Promise<Buffer> {
	const crl = new pkijs.CertificateRevocationList();
	crl.version = 1;
	crl.issuer = ca.cert.subject;
	crl.thisUpdate = new pkijs.Time({ type: 0, value: new Date(Date.now() - 60_000) });
	crl.nextUpdate = new pkijs.Time({ type: 0, value: new Date(Date.now() + 86_400_000) });
	if (revoked.length) {
		crl.revokedCertificates = revoked.map((r) => new pkijs.RevokedCertificate({ userCertificate: r.cert.serialNumber, revocationDate: new pkijs.Time({ type: 0, value: new Date() }) }));
	}
	await crl.sign(ca.cryptoKey, 'SHA-256');
	return Buffer.from(crl.toSchema(true).toBER());
}

let serial = 1;

/** Zeitstempel-Token wie von einem Dienst nach RFC 3161 */
export async function makeToken(tsa: TestCert, data: Buffer, chain: TestCert[] = [], nonce?: asn1js.Integer, imprint = sha256(data)): Promise<Buffer> {
	const info = new pkijs.TSTInfo({
		version: 1,
		policy: '1.3.6.1.4.1.99999.1',
		messageImprint: new pkijs.MessageImprint({
			hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
			hashedMessage: new asn1js.OctetString({ valueHex: new Uint8Array(imprint) })
		}),
		serialNumber: new asn1js.Integer({ value: serial++ }),
		genTime: new Date(),
		...(nonce ? { nonce } : {})
	});
	const eContent = Buffer.from(info.toSchema().toBER());
	const { signedData } = await createSignedData({ signer: signerFor(tsa, chain), contentDigest: sha256(eContent), eContent: { type: OID.tstInfo, value: eContent } });
	return encodeSignedData(signedData);
}

/** Antwort eines Zeitstempeldienstes auf eine Anfrage (TimeStampResp) */
export async function tsaReply(tsa: TestCert, request: Buffer, chain: TestCert[] = [], { wrongImprint = false } = {}): Promise<Buffer> {
	const req = pkijs.TimeStampReq.fromBER(new Uint8Array(request));
	const imprint = wrongImprint ? sha256(Buffer.from('anderes')) : Buffer.from(req.messageImprint.hashedMessage.valueBlock.valueHexView);
	const token = await makeToken(tsa, Buffer.alloc(0), chain, req.nonce, imprint);
	const parsed = asn1js.fromBER(new Uint8Array(token));
	const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: new pkijs.ContentInfo({ schema: parsed.result }) });
	return Buffer.from(resp.toSchema().toBER());
}
