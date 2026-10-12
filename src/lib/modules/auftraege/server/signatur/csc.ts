/**
 * Anbieter über die CSC-API (Cloud Signature Consortium, v1 und v2) – der
 * Standard für Fernsignatur und Fernsiegel bei europäischen
 * Vertrauensdiensteanbietern; A-Trust bietet darüber „Hash-Signing" an.
 * An den Anbieter geht nur der SHA-256 der signierten Attribute, nie die
 * Rechnung. Ablauf: Token holen → credentials/info (Zertifikatskette,
 * Algorithmen) → credentials/authorize (SAD, ggf. mit PIN) →
 * signatures/signHash.
 *
 * Die genauen Adressen, die Client-ID und die Kennung des Siegels gibt der
 * Anbieter beim Vertragsabschluss bekannt; Secret und PIN stehen nur in
 * Umgebungsvariablen.
 */
import type { SignAlgorithm } from './cms';
import { OID } from './cms';
import type { CscSettings } from './settings';
import type { SignatureProvider } from './provider';

export class CscError extends Error {}

type Json = Record<string, unknown>;

export class CscProvider implements SignatureProvider {
	readonly id = 'csc' as const;
	readonly label: string;
	private token: { value: string; until: number } | null = null;
	private info: Promise<{ certificates: Buffer[]; algos: string[] }> | null = null;

	constructor(
		private readonly config: CscSettings,
		private readonly secret: { secret: string; pin: string },
		private readonly http: typeof fetch = fetch
	) {
		this.label = config.preset === 'a-trust' ? 'A-Trust (CSC-API)' : 'CSC-API';
	}

	private base() {
		if (!/^https:\/\//i.test(this.config.baseUrl)) throw new CscError('Für den Signaturdienst ist keine https-Adresse eingetragen.');
		if (!this.config.credentialId) throw new CscError('Die Kennung des Siegels (credentialID) fehlt.');
		return this.config.baseUrl.replace(/\/+$/, '');
	}

	private async request(url: string, init: RequestInit): Promise<Json> {
		let res: Response;
		try {
			res = await this.http(url, { ...init, signal: AbortSignal.timeout(20_000) });
		} catch (err) {
			throw new CscError(`Signaturdienst nicht erreichbar: ${(err as Error).message}`);
		}
		const text = await res.text();
		let body: Json = {};
		try {
			body = text ? JSON.parse(text) : {};
		} catch {
			/* keine JSON-Antwort */
		}
		if (!res.ok) {
			const why = [body.error, body.error_description, body.message].filter(Boolean).join(': ');
			throw new CscError(`Signaturdienst antwortet mit ${res.status}${why ? ` (${why})` : ''}.`);
		}
		return body;
	}

	private async accessToken(): Promise<string> {
		if (this.token && this.token.until > Date.now() + 30_000) return this.token.value;
		if (!this.secret.secret) throw new CscError('Die Umgebungsvariable SIGNATUR_CSC_SECRET fehlt.');
		let body: Json;
		if (this.config.auth === 'basic') {
			body = await this.request(`${this.base()}/auth/login`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.secret.secret}`).toString('base64')}` },
				body: JSON.stringify({ rememberMe: false })
			});
		} else {
			if (!/^https:\/\//i.test(this.config.tokenUrl)) throw new CscError('Für OAuth2 ist keine https-Token-Adresse eingetragen.');
			body = await this.request(this.config.tokenUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.secret.secret, scope: 'service' }).toString()
			});
		}
		const value = String(body.access_token ?? '');
		if (!value) throw new CscError('Der Signaturdienst hat kein Zugriffstoken geliefert.');
		this.token = { value, until: Date.now() + Number(body.expires_in ?? 300) * 1000 };
		return value;
	}

	private async call(path: string, payload: Json): Promise<Json> {
		const token = await this.accessToken();
		return this.request(`${this.base()}/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify(payload)
		});
	}

	/** Zertifikat und Algorithmen – einmal gefragt, auch wenn mehrere gleichzeitig danach fragen */
	private credential() {
		this.info ??= this.loadCredential().catch((err) => {
			this.info = null;
			throw err;
		});
		return this.info;
	}

	private async loadCredential() {
		const body = await this.call('credentials/info', { credentialID: this.config.credentialId, certificates: 'chain', certInfo: true, authInfo: true });
		const cert = (body.cert ?? {}) as Json;
		const key = (body.key ?? {}) as Json;
		if (key.status && key.status !== 'enabled') throw new CscError('Das Siegel ist beim Anbieter gesperrt.');
		if (cert.status && cert.status !== 'valid') throw new CscError(`Das Zertifikat ist beim Anbieter nicht gültig (${cert.status}).`);
		const certificates = ((cert.certificates ?? []) as string[]).map((c) => Buffer.from(c, 'base64'));
		if (!certificates.length) throw new CscError('Der Anbieter liefert kein Zertifikat.');
		return { certificates, algos: ((key.algo ?? []) as string[]).map(String) };
	}

	async certificates() {
		return (await this.credential()).certificates;
	}

	async algorithm(): Promise<SignAlgorithm> {
		const { algos } = await this.credential();
		if (algos.some((a) => a === OID.ecPublicKey || a.startsWith('1.2.840.10045.4.3'))) return 'ecdsa-sha256';
		return 'rsa-sha256';
	}

	/** Das Signaturverfahren, wie es der Anbieter bezeichnet */
	private async signAlgo(): Promise<string> {
		const { algos } = await this.credential();
		if ((await this.algorithm()) === 'ecdsa-sha256') return OID.ecdsaSha256;
		return algos.includes(OID.sha256WithRsa) || !algos.includes(OID.rsaEncryption) ? OID.sha256WithRsa : OID.rsaEncryption;
	}

	async sign(_data: Buffer, digest: Buffer): Promise<Buffer> {
		const hash = digest.toString('base64');
		const v2 = this.config.version === 'v2';
		const auth = await this.call('credentials/authorize', {
			credentialID: this.config.credentialId,
			numSignatures: 1,
			...(v2 ? { hashes: [hash], hashAlgorithmOID: OID.sha256 } : { hash: [hash] }),
			...(this.secret.pin ? { PIN: this.secret.pin } : {})
		});
		const sad = String(auth.SAD ?? '');
		if (!sad) throw new CscError('Der Signaturdienst hat die Signatur nicht freigegeben (kein SAD).');
		const signAlgo = await this.signAlgo();
		const body = await this.call(
			'signatures/signHash',
			v2
				? { credentialID: this.config.credentialId, SAD: sad, hashes: [hash], hashAlgorithmOID: OID.sha256, signAlgo }
				: { credentialID: this.config.credentialId, SAD: sad, hash: [hash], hashAlgo: OID.sha256, signAlgo }
		);
		const [signature] = (body.signatures ?? []) as string[];
		if (!signature) throw new CscError('Der Signaturdienst hat keine Signatur geliefert.');
		return Buffer.from(signature, 'base64');
	}
}
