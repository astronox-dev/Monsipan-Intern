/**
 * CMS (RFC 5652) für PAdES: SignedData mit den signierten Attributen, die
 * CAdES-Baseline (ETSI EN 319 122-1) verlangt – content-type, message-digest
 * und signing-certificate-v2. Ohne signing-time: bei PAdES steht die Zeit im
 * Signaturfeld (/M) und verbindlich im Zeitstempel. Dazu das Prüfen von
 * Signaturen und Zeitstempeln. Aufgebaut mit pkijs/asn1js, gerechnet wird
 * mit node:crypto – der private Schlüssel verlässt nie den Anbieter.
 */
import crypto, { X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

export const OID = {
	data: '1.2.840.113549.1.7.1',
	signedData: '1.2.840.113549.1.7.2',
	contentType: '1.2.840.113549.1.9.3',
	messageDigest: '1.2.840.113549.1.9.4',
	signingTime: '1.2.840.113549.1.9.5',
	signingCertificate: '1.2.840.113549.1.9.16.2.12',
	signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
	timeStampToken: '1.2.840.113549.1.9.16.2.14',
	tstInfo: '1.2.840.113549.1.9.16.1.4',
	sha1: '1.3.14.3.2.26',
	sha256: '2.16.840.1.101.3.4.2.1',
	sha384: '2.16.840.1.101.3.4.2.2',
	sha512: '2.16.840.1.101.3.4.2.3',
	rsaEncryption: '1.2.840.113549.1.1.1',
	sha256WithRsa: '1.2.840.113549.1.1.11',
	sha384WithRsa: '1.2.840.113549.1.1.12',
	sha512WithRsa: '1.2.840.113549.1.1.13',
	rsaPss: '1.2.840.113549.1.1.10',
	ecPublicKey: '1.2.840.10045.2.1',
	ecdsaSha256: '1.2.840.10045.4.3.2',
	ecdsaSha384: '1.2.840.10045.4.3.3',
	ecdsaSha512: '1.2.840.10045.4.3.4'
} as const;

const HASH_NAMES: Record<string, string> = { [OID.sha1]: 'sha1', [OID.sha256]: 'sha256', [OID.sha384]: 'sha384', [OID.sha512]: 'sha512' };
const SIGNATURE_HASH: Record<string, string> = {
	[OID.sha256WithRsa]: 'sha256',
	[OID.sha384WithRsa]: 'sha384',
	[OID.sha512WithRsa]: 'sha512',
	[OID.ecdsaSha256]: 'sha256',
	[OID.ecdsaSha384]: 'sha384',
	[OID.ecdsaSha512]: 'sha512'
};

export type SignAlgorithm = 'rsa-sha256' | 'ecdsa-sha256';

/** Wer signiert: Zertifikate und eine Funktion, die die signierten Attribute signiert */
export interface RawSigner {
	/** Signaturzertifikat zuerst, dann die Kette (DER) */
	certificates: Buffer[];
	algorithm: SignAlgorithm;
	/**
	 * Signiert `data` (die DER-codierten signierten Attribute). `digest` ist
	 * deren SHA-256 – für Dienste, die nur den Hash bekommen (CSC-API).
	 */
	sign(data: Buffer, digest: Buffer): Promise<Buffer>;
}

export const sha256 = (data: Buffer | Uint8Array) => crypto.createHash('sha256').update(data).digest();
const u8 = (b: Buffer | Uint8Array) => new Uint8Array(b);
const raw = (block: asn1js.AsnType): Buffer => {
	const before = (block as { valueBeforeDecodeView?: Uint8Array }).valueBeforeDecodeView;
	return before?.byteLength ? Buffer.from(before) : Buffer.from(block.toBER(false));
};

export function hashName(oid: string): string | null {
	return HASH_NAMES[oid] ?? null;
}

/** Inhalt eines OCTET STRING – auch zerlegt (constructed) */
function octets(os: asn1js.OctetString): Buffer {
	if (os.idBlock.isConstructed) return Buffer.concat((os.valueBlock.value as asn1js.OctetString[]).map(octets));
	return Buffer.from(os.valueBlock.valueHexView);
}

export function parseCertificate(der: Buffer): pkijs.Certificate {
	return pkijs.Certificate.fromBER(u8(der));
}

/** ESS signing-certificate-v2: SHA-256 des Zertifikats mit Aussteller und Seriennummer */
function signingCertificateV2(der: Buffer, cert: pkijs.Certificate): pkijs.Attribute {
	const issuerSerial = new asn1js.Sequence({
		value: [new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 4, value: cert.issuer })] }).toSchema(), cert.serialNumber]
	});
	// hashAlgorithm fehlt mit Absicht: SHA-256 ist der Standardwert und wird in DER weggelassen
	const certId = new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: u8(sha256(der)) }), issuerSerial] });
	return new pkijs.Attribute({ type: OID.signingCertificateV2, values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [certId] })] })] });
}

/** DER verlangt die Elemente eines SET OF sortiert nach ihrer Codierung */
function sorted(attributes: pkijs.Attribute[]): pkijs.Attribute[] {
	return attributes
		.map((a) => ({ a, der: Buffer.from(a.toSchema().toBER()) }))
		.sort((x, y) => Buffer.compare(x.der, y.der))
		.map((x) => x.a);
}

function signatureAlgorithm(alg: SignAlgorithm): pkijs.AlgorithmIdentifier {
	return alg === 'ecdsa-sha256'
		? new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaSha256 })
		: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRsa, algorithmParams: new asn1js.Null() });
}

export interface SignedDataResult {
	signedData: pkijs.SignedData;
	/** Der Signaturwert – über ihn geht der Signatur-Zeitstempel */
	signature: Buffer;
}

/**
 * SignedData bauen. Ohne `eContent` „detached" (für PDF: signiert wird der
 * Hash der ByteRange), mit `eContent` eingebettet (z. B. ein Zeitstempel).
 */
export async function createSignedData(opts: { signer: RawSigner; contentDigest: Buffer; eContent?: { type: string; value: Buffer } }): Promise<SignedDataResult> {
	const [leafDer] = opts.signer.certificates;
	if (!leafDer) throw new Error('Kein Signaturzertifikat');
	const leaf = parseCertificate(leafDer);
	const contentType = opts.eContent?.type ?? OID.data;
	const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
		type: 0,
		attributes: sorted([
			new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: contentType })] }),
			new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: u8(opts.contentDigest) })] }),
			signingCertificateV2(leafDer, leaf)
		])
	});
	// Signiert wird die Codierung als SET (Tag 0x31), nicht als [0]
	const tbs = Buffer.from(signedAttrs.toSchema().toBER());
	tbs[0] = 0x31;
	const signature = await opts.signer.sign(tbs, sha256(tbs));
	const signerInfo = new pkijs.SignerInfo({
		version: 1,
		sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
		digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
		signedAttrs,
		signatureAlgorithm: signatureAlgorithm(opts.signer.algorithm),
		signature: new asn1js.OctetString({ valueHex: u8(signature) })
	});
	const signedData = new pkijs.SignedData({
		version: contentType === OID.data ? 1 : 3,
		encapContentInfo: new pkijs.EncapsulatedContentInfo(
			opts.eContent ? { eContentType: contentType, eContent: new asn1js.OctetString({ valueHex: u8(opts.eContent.value) }) } : { eContentType: contentType }
		),
		digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
		certificates: opts.signer.certificates.map(parseCertificate),
		signerInfos: [signerInfo]
	});
	return { signedData, signature };
}

/** Signatur-Zeitstempel (RFC 3161) als unsigniertes Attribut anhängen */
export function attachTimestamp(signedData: pkijs.SignedData, token: Buffer) {
	const parsed = asn1js.fromBER(u8(token));
	if (parsed.offset === -1) throw new Error('Zeitstempel nicht lesbar');
	signedData.signerInfos[0].unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
		type: 1,
		attributes: [new pkijs.Attribute({ type: OID.timeStampToken, values: [parsed.result] })]
	});
}

export function encodeSignedData(signedData: pkijs.SignedData): Buffer {
	const info = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
	return Buffer.from(info.toSchema().toBER());
}

/* ------------------------------------------------------------ Prüfen */

export interface CmsCheck {
	ok: boolean;
	problems: string[];
	/** Signaturzertifikat (DER) */
	signer: Buffer | null;
	/** Alle mitgelieferten Zertifikate (DER) */
	certificates: Buffer[];
	signature: Buffer | null;
	signatureAlgorithm: string;
	digestAlgorithm: string;
	hasSigningTime: boolean;
	hasSigningCertificate: boolean;
	/** Signatur-Zeitstempel aus den unsignierten Attributen */
	timestamps: Buffer[];
	eContentType: string;
	eContent: Buffer | null;
}

function attribute(attrs: pkijs.SignedAndUnsignedAttributes | undefined, type: string): pkijs.Attribute | undefined {
	return attrs?.attributes.find((a) => a.type === type);
}

function verifyRaw(algorithm: string, digest: string, data: Buffer, signature: Buffer, key: crypto.KeyObject): boolean {
	try {
		if (algorithm === OID.rsaPss) {
			return crypto.verify(digest, data, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO }, signature);
		}
		return crypto.verify(SIGNATURE_HASH[algorithm] ?? digest, data, key, signature);
	} catch {
		return false;
	}
}

function sameIssuerSerial(sid: pkijs.IssuerAndSerialNumber, cert: pkijs.Certificate) {
	return sid.issuer.isEqual(cert.issuer) && sid.serialNumber.isEqual(cert.serialNumber);
}

function subjectKeyId(cert: pkijs.Certificate): Buffer | null {
	const ext = cert.extensions?.find((e) => e.extnID === '2.5.29.14');
	if (!ext) return null;
	const parsed = asn1js.fromBER(ext.extnValue.valueBlock.valueHexView);
	return parsed.offset === -1 ? null : Buffer.from((parsed.result as asn1js.OctetString).valueBlock.valueHexView);
}

/**
 * SignedData prüfen: Hash des Inhalts gegen message-digest, Signatur über die
 * signierten Attribute mit dem öffentlichen Schlüssel des Zertifikats und das
 * signing-certificate-Attribut gegen das Zertifikat. `detached` sind die
 * signierten Bytes, wenn der Inhalt nicht eingebettet ist.
 */
export function checkSignedData(der: Buffer, detached?: Buffer): CmsCheck {
	const out: CmsCheck = {
		ok: false,
		problems: [],
		signer: null,
		certificates: [],
		signature: null,
		signatureAlgorithm: '',
		digestAlgorithm: '',
		hasSigningTime: false,
		hasSigningCertificate: false,
		timestamps: [],
		eContentType: '',
		eContent: null
	};
	let signedData: pkijs.SignedData;
	try {
		const parsed = asn1js.fromBER(u8(der));
		if (parsed.offset === -1) throw new Error();
		const info = new pkijs.ContentInfo({ schema: parsed.result });
		if (info.contentType !== OID.signedData) throw new Error();
		signedData = new pkijs.SignedData({ schema: info.content });
	} catch {
		out.problems.push('Die Signaturdaten (CMS) sind nicht lesbar.');
		return out;
	}
	const certs = (signedData.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
	out.certificates = certs.map((c) => raw(c.toSchema()));
	const info = signedData.signerInfos[0];
	if (!info) {
		out.problems.push('Die Signatur enthält keinen Unterzeichner.');
		return out;
	}
	out.signatureAlgorithm = info.signatureAlgorithm.algorithmId;
	out.digestAlgorithm = info.digestAlgorithm.algorithmId;
	out.signature = Buffer.from(info.signature.valueBlock.valueHexView);
	out.eContentType = signedData.encapContentInfo.eContentType;
	if (signedData.encapContentInfo.eContent) out.eContent = octets(signedData.encapContentInfo.eContent);

	const digestName = HASH_NAMES[out.digestAlgorithm];
	if (!digestName) out.problems.push('Unbekanntes Hash-Verfahren.');
	const content = out.eContent ?? detached;
	if (!content) out.problems.push('Die signierten Daten fehlen.');

	// Unterzeichner-Zertifikat über die sid finden
	let signerIndex = -1;
	if (info.sid instanceof pkijs.IssuerAndSerialNumber) {
		signerIndex = certs.findIndex((c) => sameIssuerSerial(info.sid as pkijs.IssuerAndSerialNumber, c));
	} else if (info.sid instanceof asn1js.Constructed || info.sid instanceof asn1js.Primitive) {
		const wanted = Buffer.from((info.sid as asn1js.Primitive).valueBlock?.valueHexView ?? new Uint8Array());
		signerIndex = certs.findIndex((c) => subjectKeyId(c)?.equals(wanted));
	}
	if (signerIndex < 0) {
		out.problems.push('Das Zertifikat des Unterzeichners fehlt in der Signatur.');
		return out;
	}
	out.signer = out.certificates[signerIndex];

	const signed = info.signedAttrs;
	if (!signed) {
		out.problems.push('Die Signatur hat keine signierten Attribute.');
		return out;
	}
	out.hasSigningTime = !!attribute(signed, OID.signingTime);
	const md = attribute(signed, OID.messageDigest);
	if (!md) out.problems.push('Das Attribut message-digest fehlt.');
	else if (content && digestName) {
		const expected = crypto.createHash(digestName).update(content).digest();
		if (!octets(md.values[0] as asn1js.OctetString).equals(expected)) out.problems.push('Der Inhalt wurde nach dem Signieren verändert (Hash stimmt nicht).');
	}
	const ct = attribute(signed, OID.contentType);
	if (!ct || (ct.values[0] as asn1js.ObjectIdentifier).getValue() !== out.eContentType) out.problems.push('Das Attribut content-type fehlt oder passt nicht.');

	// signing-certificate(-v2): bindet das Zertifikat an die Signatur
	const v2 = attribute(signed, OID.signingCertificateV2);
	const v1 = attribute(signed, OID.signingCertificate);
	if (v2 || v1) {
		out.hasSigningCertificate = true;
		try {
			const certIds = ((v2 ?? v1)!.values[0] as asn1js.Sequence).valueBlock.value[0] as asn1js.Sequence;
			const first = certIds.valueBlock.value[0] as asn1js.Sequence;
			let alg = v2 ? 'sha256' : 'sha1';
			let hashIndex = 0;
			const head = first.valueBlock.value[0];
			if (v2 && head instanceof asn1js.Sequence) {
				alg = HASH_NAMES[new pkijs.AlgorithmIdentifier({ schema: head }).algorithmId] ?? '';
				hashIndex = 1;
			}
			const hash = Buffer.from((first.valueBlock.value[hashIndex] as asn1js.OctetString).valueBlock.valueHexView);
			if (!alg || !crypto.createHash(alg).update(out.signer).digest().equals(hash)) out.problems.push('Das signing-certificate-Attribut passt nicht zum Zertifikat.');
		} catch {
			out.problems.push('Das signing-certificate-Attribut ist nicht lesbar.');
		}
	}

	const tbs = Buffer.from(signed.encodedValue);
	tbs[0] = 0x31;
	let key: crypto.KeyObject;
	try {
		key = new X509Certificate(out.signer).publicKey;
	} catch {
		out.problems.push('Das Zertifikat des Unterzeichners ist nicht lesbar.');
		return out;
	}
	if (!verifyRaw(out.signatureAlgorithm, digestName ?? 'sha256', tbs, out.signature, key)) out.problems.push('Die Signatur ist mathematisch ungültig.');

	for (const a of info.unsignedAttrs?.attributes ?? []) {
		if (a.type === OID.timeStampToken && a.values[0]) out.timestamps.push(raw(a.values[0]));
	}
	out.ok = out.problems.length === 0;
	return out;
}

export interface TimestampCheck {
	ok: boolean;
	problems: string[];
	time: Date | null;
	/** Zertifikat des Zeitstempeldienstes und die mitgelieferten */
	tsa: Buffer | null;
	certificates: Buffer[];
	nonce: Buffer | null;
}

/** Zeitstempel (RFC 3161) prüfen: Signatur des Dienstes und dass er über genau diese Daten geht */
export function checkTimestampToken(token: Buffer, data: Buffer): TimestampCheck {
	const cms = checkSignedData(token);
	const out: TimestampCheck = { ok: false, problems: [...cms.problems], time: null, tsa: cms.signer, certificates: cms.certificates, nonce: null };
	if (cms.eContentType !== OID.tstInfo || !cms.eContent) {
		out.problems.push('Kein Zeitstempel (TSTInfo fehlt).');
		return out;
	}
	try {
		const info = pkijs.TSTInfo.fromBER(u8(cms.eContent));
		out.time = info.genTime;
		if (info.nonce) out.nonce = Buffer.from(info.nonce.valueBlock.valueHexView);
		const alg = HASH_NAMES[info.messageImprint.hashAlgorithm.algorithmId];
		if (!alg) out.problems.push('Unbekanntes Hash-Verfahren im Zeitstempel.');
		else if (!crypto.createHash(alg).update(data).digest().equals(Buffer.from(info.messageImprint.hashedMessage.valueBlock.valueHexView))) {
			out.problems.push('Der Zeitstempel gehört nicht zu diesen Daten.');
		}
	} catch {
		out.problems.push('Der Zeitstempel ist nicht lesbar.');
	}
	out.ok = out.problems.length === 0;
	return out;
}
