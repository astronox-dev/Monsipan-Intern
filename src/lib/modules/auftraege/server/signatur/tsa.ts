/**
 * Zeitstempel nach RFC 3161: an den Dienst geht nur der SHA-256 der Daten –
 * nie die Rechnung selbst. Zurück kommt ein vom Dienst signiertes Token mit
 * der Uhrzeit; es wird vor der Verwendung geprüft (Signatur, Hash, Nonce).
 */
import crypto from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { checkTimestampToken, OID } from './cms';
import { fetchBinary } from './net';

export class TimestampError extends Error {}

export interface TsaConfig {
	url: string;
	/** Benutzer und Passwort, falls der Dienst sie verlangt (z. B. qualifizierte Zeitstempel) */
	user?: string;
	password?: string;
}

/** Holt einen Zeitstempel über `data` und gibt das Token (ContentInfo, DER) zurück */
export async function requestTimestamp(config: TsaConfig, data: Buffer): Promise<Buffer> {
	if (!/^https?:\/\//i.test(config.url)) throw new TimestampError('Keine gültige Adresse für den Zeitstempeldienst eingetragen.');
	const imprint = crypto.createHash('sha256').update(data).digest();
	const nonce = crypto.randomBytes(8);
	nonce[0] &= 0x7f; // positiv
	const request = new pkijs.TimeStampReq({
		version: 1,
		messageImprint: new pkijs.MessageImprint({
			hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
			hashedMessage: new asn1js.OctetString({ valueHex: new Uint8Array(imprint) })
		}),
		nonce: new asn1js.Integer({ valueHex: new Uint8Array(nonce) }),
		certReq: true
	});
	const headers: Record<string, string> = { 'content-type': 'application/timestamp-query', accept: 'application/timestamp-reply' };
	if (config.user) headers.authorization = `Basic ${Buffer.from(`${config.user}:${config.password ?? ''}`).toString('base64')}`;
	let reply: Buffer;
	try {
		reply = await fetchBinary(config.url, { method: 'POST', headers, body: Buffer.from(request.toSchema().toBER()) });
	} catch (err) {
		throw new TimestampError(`Zeitstempeldienst nicht erreichbar: ${(err as Error).message}`);
	}
	const parsed = asn1js.fromBER(new Uint8Array(reply));
	if (parsed.offset === -1 || !(parsed.result instanceof asn1js.Sequence)) throw new TimestampError('Antwort des Zeitstempeldienstes nicht lesbar.');
	const response = new pkijs.TimeStampResp({ schema: parsed.result });
	const status = response.status.status;
	if (status !== 0 && status !== 1) {
		const why = response.status.statusStrings?.map((s) => s.valueBlock.value).join(' ') ?? '';
		throw new TimestampError(`Der Zeitstempeldienst hat abgelehnt (Status ${status}${why ? `: ${why}` : ''}).`);
	}
	const tokenBlock = parsed.result.valueBlock.value[1];
	if (!tokenBlock) throw new TimestampError('Der Zeitstempeldienst hat kein Token geliefert.');
	const token = Buffer.from(tokenBlock.valueBeforeDecodeView);
	const check = checkTimestampToken(token, data);
	if (!check.ok) throw new TimestampError(`Zeitstempel ungültig: ${check.problems.join(' ')}`);
	if (!check.nonce || !stripZeros(check.nonce).equals(stripZeros(nonce))) throw new TimestampError('Zeitstempel ungültig: Die Nonce stimmt nicht.');
	return token;
}

function stripZeros(b: Buffer): Buffer {
	let i = 0;
	while (i < b.length - 1 && b[i] === 0) i++;
	return b.subarray(i);
}
