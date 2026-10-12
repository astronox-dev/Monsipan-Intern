import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { CscError, CscProvider } from './csc';
import { signPdf } from './pades';
import { toRawSigner } from './provider';
import { SIGNATURE_DEFAULTS, type CscSettings } from './settings';
import { makeCert, type TestCert } from './testkit';
import { inspectPdf } from './verify-pdf';

/** SHA-256-DigestInfo – so signiert ein Dienst einen fertigen Hash mit RSA (PKCS#1 v1.5) */
const DIGEST_INFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');

let ca: TestCert;
let seal: TestCert;

beforeAll(async () => {
	ca = await makeCert({ cn: 'Test-Vertrauensdiensteanbieter', ca: true });
	seal = await makeCert({ cn: 'Monsipan Fernsiegel', issuer: ca });
});

const config: CscSettings = {
	...SIGNATURE_DEFAULTS.csc,
	baseUrl: 'https://csc.test/csc/v1',
	tokenUrl: 'https://csc.test/oauth2/token',
	clientId: 'monsipan',
	credentialId: 'siegel-1'
};

/** Nachgebauter CSC-Dienst: prüft Token, SAD und PIN wie ein echter */
function fakeService(o: { version?: 'v1' | 'v2'; pin?: string; failSign?: boolean } = {}) {
	const calls: string[] = [];
	const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push(url.replace('https://csc.test', ''));
		const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (url.endsWith('/oauth2/token')) {
			const form = new URLSearchParams(String(init?.body));
			if (form.get('client_secret') !== 'geheim') return json(401, { error: 'invalid_client' });
			return json(200, { access_token: 'token-1', expires_in: 600 });
		}
		if ((init?.headers as Record<string, string>)?.authorization !== 'Bearer token-1') return json(401, { error: 'invalid_token' });
		const body = JSON.parse(String(init?.body ?? '{}'));
		if (url.endsWith('/credentials/info')) {
			return json(200, {
				key: { status: 'enabled', algo: ['1.2.840.113549.1.1.1'], len: 2048 },
				cert: { status: 'valid', certificates: [seal.der.toString('base64'), ca.der.toString('base64')] },
				authMode: 'explicit'
			});
		}
		if (url.endsWith('/credentials/authorize')) {
			if (o.pin && body.PIN !== o.pin) return json(400, { error: 'invalid_pin' });
			const hashes = o.version === 'v2' ? body.hashes : body.hash;
			if (!Array.isArray(hashes) || hashes.length !== 1) return json(400, { error: 'invalid_request' });
			return json(200, { SAD: 'sad-1' });
		}
		if (url.endsWith('/signatures/signHash')) {
			if (o.failSign) return json(500, { error: 'server_error', error_description: 'HSM nicht erreichbar' });
			if (body.SAD !== 'sad-1') return json(400, { error: 'invalid_sad' });
			const hashes: string[] = o.version === 'v2' ? body.hashes : body.hash;
			const signatures = hashes.map((h) =>
				crypto.privateEncrypt({ key: seal.key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.concat([DIGEST_INFO, Buffer.from(h, 'base64')])).toString('base64')
			);
			return json(200, { signatures });
		}
		return json(404, { error: 'not_found' });
	}) as typeof fetch;
	return { http, calls };
}

async function samplePdf(): Promise<Buffer> {
	const doc = new PDFDocument({ size: 'A4', pdfVersion: '1.7' });
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
	doc.on('data', (c: Buffer) => chunks.push(c));
	doc.text('Rechnung');
	doc.end();
	return done;
}

describe('CSC-API (z. B. A-Trust)', () => {
	it('signiert über Hash-Signing und die Signatur ist gültig', async () => {
		const service = fakeService({ pin: '1234' });
		const provider = new CscProvider(config, { secret: 'geheim', pin: '1234' }, service.http);
		const signer = await toRawSigner(provider);
		expect(signer.certificates).toHaveLength(2);
		const { pdf } = await signPdf(await samplePdf(), { level: 'B-B', signer });
		const check = inspectPdf(pdf);
		expect(check.ok).toBe(true);
		expect(check.signatures[0].signer?.name).toBe('Monsipan Fernsiegel');
		expect(check.signatures[0].signer?.issuerName).toBe('Test-Vertrauensdiensteanbieter');
		expect(service.calls).toEqual(['/oauth2/token', '/csc/v1/credentials/info', '/csc/v1/credentials/authorize', '/csc/v1/signatures/signHash']);
	});

	it('spricht auch CSC v2', async () => {
		const service = fakeService({ version: 'v2' });
		const provider = new CscProvider({ ...config, baseUrl: 'https://csc.test/csc/v2', version: 'v2' }, { secret: 'geheim', pin: '' }, service.http);
		const { pdf } = await signPdf(await samplePdf(), { level: 'B-B', signer: await toRawSigner(provider) });
		expect(inspectPdf(pdf).ok).toBe(true);
	});

	it('meldet fehlende oder falsche Zugangsdaten verständlich', async () => {
		const service = fakeService();
		await expect(new CscProvider(config, { secret: '', pin: '' }, service.http).certificates()).rejects.toThrow(/SIGNATUR_CSC_SECRET/);
		await expect(new CscProvider(config, { secret: 'falsch', pin: '' }, service.http).certificates()).rejects.toThrow(/401.*invalid_client/);
		await expect(new CscProvider({ ...config, baseUrl: 'http://unsicher' }, { secret: 'geheim', pin: '' }, service.http).certificates()).rejects.toBeInstanceOf(CscError);
	});

	it('gibt einen Fehler des Dienstes beim Signieren weiter', async () => {
		const service = fakeService({ failSign: true });
		const provider = new CscProvider(config, { secret: 'geheim', pin: '' }, service.http);
		await expect(signPdf(await samplePdf(), { level: 'B-B', signer: await toRawSigner(provider) })).rejects.toThrow(/HSM nicht erreichbar/);
	});
});
