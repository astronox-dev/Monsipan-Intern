/**
 * „Verbindung testen" für die Einstellungen: Schritt für Schritt, was für eine
 * Signatur nötig ist – Zertifikat laden, Testdaten signieren und prüfen,
 * Zeitstempel holen, Sperrinformationen sammeln. Signiert wird dabei nur ein
 * zufälliger Testwert, keine Rechnung.
 */
import crypto, { X509Certificate } from 'node:crypto';
import { certInfo, qualification, QUALIFICATION_LABELS } from './cert';
import { createProvider, toRawSigner } from './provider';
import { collectValidationData } from './revocation';
import { secrets, type SignatureSettings } from './settings';
import { requestTimestamp } from './tsa';
import { checkTimestampToken, createSignedData, encodeSignedData, checkSignedData, sha256 } from './cms';

export interface TestStep {
	label: string;
	ok: boolean;
	detail: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export async function testConnection(s: SignatureSettings): Promise<TestStep[]> {
	const steps: TestStep[] = [];
	let chain: Buffer[] = [];
	try {
		const signer = await toRawSigner(createProvider(s));
		chain = signer.certificates;
		const info = certInfo(chain[0]);
		const now = new Date();
		const valid = now >= new Date(info.notBefore) && now <= new Date(info.notAfter);
		steps.push({
			label: 'Zertifikat laden',
			ok: valid,
			detail: `${info.name} · ausgestellt von ${info.issuerName} · gültig bis ${info.notAfter.slice(0, 10)} · ${QUALIFICATION_LABELS[qualification(info)]}${valid ? '' : ' – NICHT GÜLTIG'}`
		});
		const data = crypto.randomBytes(32);
		const { signedData } = await createSignedData({ signer, contentDigest: sha256(data) });
		const check = checkSignedData(encodeSignedData(signedData), data);
		steps.push({ label: 'Testwert signieren und prüfen', ok: check.ok, detail: check.ok ? `Signatur gültig (${signer.algorithm})` : check.problems.join(' ') });
		new X509Certificate(chain[0]);
	} catch (err) {
		steps.push({ label: 'Signaturanbieter', ok: false, detail: message(err) });
		return steps;
	}

	if (s.level === 'B-B') return steps;
	let tsaChain: Buffer[] = [];
	try {
		const data = crypto.randomBytes(32);
		const token = await requestTimestamp({ url: s.tsaUrl, user: secrets.tsaUser(), password: secrets.tsaPassword() }, data);
		const check = checkTimestampToken(token, data);
		tsaChain = check.tsa ? [check.tsa, ...check.certificates.filter((c) => !c.equals(check.tsa!))] : check.certificates;
		const tsa = check.tsa ? certInfo(check.tsa) : null;
		steps.push({ label: 'Zeitstempel holen', ok: check.ok, detail: `${tsa?.name ?? 'Zeitstempeldienst'} · ${check.time?.toISOString() ?? ''}` });
	} catch (err) {
		steps.push({ label: 'Zeitstempel holen', ok: false, detail: message(err) });
		return steps;
	}

	if (s.level === 'B-T') return steps;
	try {
		const data = await collectValidationData([chain, tsaChain]);
		steps.push({
			label: 'Sperrinformationen sammeln (Langzeitvalidierung)',
			ok: data.complete,
			detail: `${data.certs.length} Zertifikate, ${data.ocsps.length} OCSP-Antworten, ${data.crls.length} Sperrlisten${data.notes.length ? ` – ${data.notes.join(' ')}` : ''}`
		});
	} catch (err) {
		steps.push({ label: 'Sperrinformationen sammeln (Langzeitvalidierung)', ok: false, detail: message(err) });
	}
	return steps;
}
