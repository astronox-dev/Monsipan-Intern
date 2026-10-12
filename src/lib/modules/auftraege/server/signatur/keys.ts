/**
 * Schlüssel und Zertifikate für den Anbieter „eigenes Zertifikat":
 *
 * - abgelegt als eine PEM-Datei: privater Schlüssel verschlüsselt (PKCS#8,
 *   AES-256) plus die Zertifikatskette – das Passwort kommt ausschließlich aus
 *   der Umgebungsvariable, nie aus der Datenbank oder dem Browser
 * - erzeugen: selbst ausgestelltes Siegelzertifikat (RSA 3072, SHA-256) –
 *   technisch eine vollwertige PAdES-Signatur, aber nicht qualifiziert
 * - einlesen: .p12/.pfx (RSA) oder PEM eines gekauften Zertifikats
 */
import crypto, { X509Certificate } from 'node:crypto';
import forge from 'node-forge';

export class KeyFileError extends Error {}

export interface KeyMaterial {
	key: crypto.KeyObject;
	/** Signaturzertifikat zuerst, dann die Kette (DER) */
	certificates: Buffer[];
}

const toPem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----\n`;

function pemBlocks(text: string, label: RegExp): string[] {
	return [...text.matchAll(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g)].filter((m) => label.test(m[1])).map((m) => m[0]);
}

const pemToDer = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

/** Kette ordnen: das Zertifikat zum Schlüssel zuerst, dann jeweils sein Aussteller */
export function orderChain(key: crypto.KeyObject, certificates: Buffer[]): Buffer[] {
	const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
	const all = certificates.map((der) => ({ der, x: new X509Certificate(der) }));
	const leaf = all.find((c) => c.x.publicKey.export({ type: 'spki', format: 'der' }).equals(pub));
	if (!leaf) throw new KeyFileError('Kein Zertifikat passt zum privaten Schlüssel.');
	const chain = [leaf];
	const rest = all.filter((c) => c !== leaf);
	for (let cur = leaf; rest.length; ) {
		const i = rest.findIndex((c) => {
			try {
				return cur.x.checkIssued(c.x) && cur.x.verify(c.x.publicKey);
			} catch {
				return false;
			}
		});
		if (i < 0) break;
		cur = rest.splice(i, 1)[0];
		chain.push(cur);
	}
	return chain.map((c) => c.der);
}

/** Abgelegte Datei lesen (Passwort aus der Umgebung) */
export function readKeyFile(pem: string, password: string): KeyMaterial {
	const [keyPem] = pemBlocks(pem, /PRIVATE KEY/);
	if (!keyPem) throw new KeyFileError('In der Datei steht kein privater Schlüssel.');
	let key: crypto.KeyObject;
	try {
		key = crypto.createPrivateKey({ key: keyPem, format: 'pem', passphrase: password });
	} catch {
		throw new KeyFileError('Der Schlüssel lässt sich nicht öffnen – stimmt das Passwort (SIGNATUR_PASSWORT)?');
	}
	const certificates = pemBlocks(pem, /^CERTIFICATE$/).map(pemToDer);
	if (!certificates.length) throw new KeyFileError('In der Datei steht kein Zertifikat.');
	return { key, certificates: orderChain(key, certificates) };
}

/** Für die Ablage: Schlüssel verschlüsselt, Kette dazu */
export function writeKeyFile(m: KeyMaterial, password: string): string {
	if (password.length < 12) throw new KeyFileError('Das Passwort in SIGNATUR_PASSWORT muss mindestens 12 Zeichen haben.');
	const key = m.key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password }) as string;
	return key + m.certificates.map(toPem).join('');
}

/** .p12/.pfx einlesen – mit dem Passwort, das zur Datei gehört */
export function readP12(der: Buffer, password: string): KeyMaterial {
	let p12: forge.pkcs12.Pkcs12Pfx;
	try {
		const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
		p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
	} catch (err) {
		const msg = (err as Error).message ?? '';
		if (/OID is not RSA/i.test(msg)) throw new KeyFileError('In .p12-Dateien werden nur RSA-Schlüssel gelesen – bitte Schlüssel und Zertifikat als PEM hochladen.');
		throw new KeyFileError('Die Datei lässt sich nicht öffnen – stimmt das Passwort?');
	}
	const bags = (type: string) => p12.getBags({ bagType: type })[type] ?? [];
	const keyBag = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)][0];
	if (!keyBag?.key) throw new KeyFileError('In der Datei steht kein (RSA-)Schlüssel.');
	const key = crypto.createPrivateKey(forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey));
	const certificates = bags(forge.pki.oids.certBag)
		.map((b) => (b.cert ? forge.pki.certificateToAsn1(b.cert) : (b as { asn1?: forge.asn1.Asn1 }).asn1))
		.filter((a): a is forge.asn1.Asn1 => !!a)
		.map((a) => Buffer.from(forge.asn1.toDer(a).getBytes(), 'binary'));
	if (!certificates.length) throw new KeyFileError('In der Datei steht kein Zertifikat.');
	return { key, certificates: orderChain(key, certificates) };
}

/** PEM mit Schlüssel (auch verschlüsselt) und Zertifikaten einlesen */
export function readPemUpload(pem: string, password: string): KeyMaterial {
	const [keyPem] = pemBlocks(pem, /PRIVATE KEY/);
	if (!keyPem) throw new KeyFileError('In der Datei steht kein privater Schlüssel.');
	let key: crypto.KeyObject;
	try {
		key = crypto.createPrivateKey({ key: keyPem, format: 'pem', passphrase: password || undefined });
	} catch {
		throw new KeyFileError('Der Schlüssel lässt sich nicht öffnen – stimmt das Passwort?');
	}
	const certificates = pemBlocks(pem, /^CERTIFICATE$/).map(pemToDer);
	if (!certificates.length) throw new KeyFileError('In der Datei steht kein Zertifikat.');
	return { key, certificates: orderChain(key, certificates) };
}

/** Selbst ausgestelltes Siegelzertifikat (nicht qualifiziert) */
export function createSelfSigned(o: { organization: string; commonName: string; country: string; years: number }): KeyMaterial {
	const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
	const forgeKey = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }) as string);
	const cert = forge.pki.createCertificate();
	cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
	const serial = crypto.randomBytes(16);
	serial[0] &= 0x7f;
	cert.serialNumber = serial.toString('hex');
	const now = new Date();
	cert.validity.notBefore = new Date(now.getTime() - 60_000);
	cert.validity.notAfter = new Date(now.getTime() + o.years * 365.25 * 86_400_000);
	const attrs = [
		{ name: 'countryName', value: o.country.toUpperCase().slice(0, 2) },
		{ name: 'organizationName', value: o.organization, valueTagClass: forge.asn1.Type.UTF8 },
		{ name: 'commonName', value: o.commonName, valueTagClass: forge.asn1.Type.UTF8 }
	] as forge.pki.CertificateField[];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false, critical: true },
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
		{ name: 'subjectKeyIdentifier' }
	]);
	cert.sign(forgeKey, forge.md.sha256.create());
	const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
	return { key: privateKey, certificates: [der] };
}
