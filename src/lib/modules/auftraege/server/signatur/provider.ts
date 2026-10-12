/**
 * SignatureProviderInterface – einheitliche Schnittstelle für alle, die
 * signieren: das eigene Zertifikat am Server oder ein Vertrauensdiensteanbieter
 * über seine API (CSC, z. B. A-Trust). Ein Anbieter liefert Zertifikatskette
 * und Signaturwert; den Rest (PDF, CMS, Zeitstempel, DSS) erledigt pades.ts.
 * Private Schlüssel bleiben beim Anbieter – im Browser landet nie einer.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { RawSigner, SignAlgorithm } from './cms';
import { readKeyFile, type KeyMaterial } from './keys';
import { secrets, type SignatureSettings } from './settings';
import { CscProvider } from './csc';

export type ProviderId = 'lokal' | 'csc';

export interface SignatureProvider {
	readonly id: ProviderId;
	readonly label: string;
	/** Signaturzertifikat zuerst, dann die Kette (DER) */
	certificates(): Promise<Buffer[]>;
	algorithm(): Promise<SignAlgorithm>;
	/** Signiert `data`; `digest` ist deren SHA-256 (für Dienste, die nur den Hash signieren) */
	sign(data: Buffer, digest: Buffer): Promise<Buffer>;
}

export class ProviderError extends Error {}

/* ------------------------------------------------- Eigenes Zertifikat */

let cached: { file: string; mtime: number; size: number; material: KeyMaterial } | null = null;

export class LocalProvider implements SignatureProvider {
	readonly id = 'lokal' as const;
	readonly label = 'Eigenes Zertifikat';

	constructor(
		private readonly file = secrets.keyFile(),
		private readonly password = secrets.keyPassword()
	) {}

	private load(): KeyMaterial {
		if (!this.password) throw new ProviderError('Die Umgebungsvariable SIGNATUR_PASSWORT fehlt – ohne sie lässt sich der Schlüssel nicht öffnen.');
		let stat: fs.Stats;
		try {
			stat = fs.statSync(this.file);
		} catch {
			throw new ProviderError('Es ist noch kein Zertifikat hinterlegt (Verwaltung → Einstellungen → Rechnungssignatur).');
		}
		if (cached && cached.file === this.file && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.material;
		const material = readKeyFile(fs.readFileSync(this.file, 'utf8'), this.password);
		cached = { file: this.file, mtime: stat.mtimeMs, size: stat.size, material };
		return material;
	}

	async certificates() {
		return this.load().certificates;
	}

	async algorithm(): Promise<SignAlgorithm> {
		const type = this.load().key.asymmetricKeyType;
		if (type === 'rsa') return 'rsa-sha256';
		if (type === 'ec') return 'ecdsa-sha256';
		throw new ProviderError(`Schlüsseltyp ${type} wird nicht unterstützt.`);
	}

	async sign(data: Buffer) {
		return crypto.sign('sha256', data, this.load().key);
	}
}

/** Nach dem Hinterlegen eines neuen Zertifikats */
export function forgetLoadedKey() {
	cached = null;
}

/* ------------------------------------------------------------ Auswahl */

export function createProvider(s: SignatureSettings): SignatureProvider {
	if (s.provider === 'csc') return new CscProvider(s.csc, { secret: secrets.cscSecret(), pin: secrets.cscPin() });
	return new LocalProvider();
}

export async function toRawSigner(p: SignatureProvider): Promise<RawSigner> {
	const [certificates, algorithm] = await Promise.all([p.certificates(), p.algorithm()]);
	if (!certificates.length) throw new ProviderError('Der Anbieter liefert kein Zertifikat.');
	return { certificates, algorithm, sign: (data, digest) => p.sign(data, digest) };
}
