/**
 * Digitale Rechnungssignatur: ein- und ausschalten, Anbieter und Verfahren,
 * Zeitstempeldienst, Prüfseite, Zertifikat, Verbindungstest, Archivprüfung.
 * Geheimnisse werden hier weder angezeigt noch gespeichert – nur, ob die
 * Umgebungsvariablen gesetzt sind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requirePermission } from '$lib/server/guard';
import { PADES_LEVELS, type PadesLevel } from '$lib/modules/auftraege/server/signatur/pades';
import { audit } from '$lib/modules/auftraege/server/signatur/audit';
import { certInfo, qualification, QUALIFICATION_LABELS, type CertInfo } from '$lib/modules/auftraege/server/signatur/cert';
import { testConnection } from '$lib/modules/auftraege/server/signatur/connection';
import { createSelfSigned, KeyFileError, readKeyFile, readP12, readPemUpload, writeKeyFile, type KeyMaterial } from '$lib/modules/auftraege/server/signatur/keys';
import { forgetLoadedKey } from '$lib/modules/auftraege/server/signatur/provider';
import { saveSignatureSettings, secrets, secretStatus, signatureSettings, verifyBase, type SignatureSettings } from '$lib/modules/auftraege/server/signatur/settings';
import { checkArchive, lastArchiveCheck } from '$lib/modules/auftraege/server/signatur/verification';
import type { Actions, PageServerLoad } from './$types';

/** Das hinterlegte eigene Zertifikat – ohne Schlüssel, nur die Angaben */
function localCertificate(): { info: (CertInfo & { label: string }) | null; chain: number; problem: string | null } {
	const file = secrets.keyFile();
	if (!fs.existsSync(file)) return { info: null, chain: 0, problem: null };
	if (!secretStatus().keyPassword) return { info: null, chain: 0, problem: 'Zertifikat vorhanden, aber SIGNATUR_PASSWORT fehlt oder ist zu kurz.' };
	try {
		const m = readKeyFile(fs.readFileSync(file, 'utf8'), secrets.keyPassword());
		const info = certInfo(m.certificates[0]);
		return { info: { ...info, label: QUALIFICATION_LABELS[qualification(info)] }, chain: m.certificates.length, problem: null };
	} catch (err) {
		return { info: null, chain: 0, problem: (err as Error).message };
	}
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePermission(locals, 'einstellungen.sehen');
	const settings = await signatureSettings();
	return {
		settings,
		secrets: secretStatus(),
		local: localCertificate(),
		keyFile: secrets.keyFile(),
		verifyExample: `${verifyBase(settings, url.origin)}/pruefen/…`,
		origin: env.ORIGIN ?? '',
		lastCheck: await lastArchiveCheck(),
		levels: PADES_LEVELS
	};
};

const httpUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);

function readSettings(f: FormData, old: SignatureSettings): SignatureSettings | { message: string } {
	const s = (k: string, max = 300) => String(f.get(k) ?? '').trim().slice(0, max);
	const level = s('level') as PadesLevel;
	if (!PADES_LEVELS.includes(level)) return { message: 'Bitte ein Signaturverfahren wählen.' };
	const provider = s('provider') === 'csc' ? 'csc' : 'lokal';
	const tsaUrl = s('tsaUrl');
	if (level !== 'B-B' && !httpUrl(tsaUrl)) return { message: 'Für dieses Verfahren braucht es die Adresse eines Zeitstempeldienstes (http oder https).' };
	const verifyBaseUrl = s('verifyBaseUrl').replace(/\/+$/, '');
	if (verifyBaseUrl && !/^https:\/\/[^\s/]+$/i.test(verifyBaseUrl)) return { message: 'Die Adresse für den Prüfcode muss mit https:// beginnen und ohne Pfad sein, z. B. https://portal.monsipan.at.' };
	const years = Number(s('retentionYears'));
	if (!Number.isInteger(years) || years < 7 || years > 50) return { message: 'Die Aufbewahrung muss zwischen 7 und 50 Jahren liegen (BAO: mindestens 7).' };
	const csc = {
		preset: s('cscPreset') === 'andere' ? ('andere' as const) : ('a-trust' as const),
		baseUrl: s('cscBaseUrl').replace(/\/+$/, ''),
		version: s('cscVersion') === 'v2' ? ('v2' as const) : ('v1' as const),
		auth: s('cscAuth') === 'basic' ? ('basic' as const) : ('oauth2' as const),
		tokenUrl: s('cscTokenUrl'),
		clientId: s('cscClientId', 200),
		credentialId: s('cscCredentialId', 200)
	};
	if (csc.baseUrl && !/^https:\/\//i.test(csc.baseUrl)) return { message: 'Die Adresse der CSC-API muss mit https:// beginnen.' };
	if (csc.tokenUrl && !/^https:\/\//i.test(csc.tokenUrl)) return { message: 'Die Token-Adresse muss mit https:// beginnen.' };
	return {
		...old,
		enabled: f.get('enabled') === 'on',
		provider,
		level,
		tsaUrl,
		verifyEnabled: f.get('verifyEnabled') === 'on',
		verifyBaseUrl,
		retentionYears: years,
		reason: s('reason', 120) || old.reason,
		location: s('location', 80),
		csc
	};
}

/** Neues Schlüsselmaterial ablegen – das bisherige bleibt als Sicherung daneben liegen */
function storeKey(m: KeyMaterial) {
	const password = secrets.keyPassword();
	if (password.length < 12) throw new KeyFileError('Zuerst die Umgebungsvariable SIGNATUR_PASSWORT setzen (mindestens 12 Zeichen) und den Container neu starten.');
	const pem = writeKeyFile(m, password);
	const file = secrets.keyFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file)) fs.renameSync(file, `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
	fs.writeFileSync(file, pem, { mode: 0o600 });
	forgetLoadedKey();
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const user = requirePermission(locals, 'einstellungen.bearbeiten');
		const old = await signatureSettings();
		const next = readSettings(await request.formData(), old);
		if ('message' in next) return fail(400, { action: 'save', message: next.message });
		if (next.enabled && next.provider === 'lokal' && !localCertificate().info) {
			return fail(400, { action: 'save', message: 'Zum Einschalten zuerst ein Zertifikat hinterlegen (unten) – oder den Anbieter wechseln.' });
		}
		await saveSignatureSettings(next);
		const changed = (Object.keys(next) as (keyof SignatureSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(old[k]));
		if (changed.length) await audit({ invoiceId: null, user, action: 'einstellungen', detail: Object.fromEntries(changed.map((k) => [k, next[k]])) });
		return { action: 'save', saved: true };
	},

	test: async ({ locals }) => {
		const user = requirePermission(locals, 'einstellungen.bearbeiten');
		const steps = await testConnection(await signatureSettings());
		await audit({ invoiceId: null, user, action: 'verbindungstest', detail: { ok: steps.every((s) => s.ok), schritte: steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.label}`) } });
		return { action: 'test', steps };
	},

	generate: async ({ request, locals }) => {
		const user = requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const organization = String(f.get('organization') ?? '').trim().slice(0, 64);
		const commonName = String(f.get('commonName') ?? '').trim().slice(0, 64);
		const years = Math.min(10, Math.max(1, Number(f.get('years')) || 5));
		if (!organization || !commonName) return fail(400, { action: 'generate', message: 'Bitte Firma und Bezeichnung eintragen.' });
		try {
			const m = createSelfSigned({ organization, commonName, country: 'AT', years });
			storeKey(m);
			const info = certInfo(m.certificates[0]);
			await audit({ invoiceId: null, user, action: 'zertifikat', detail: { art: 'selbst ausgestellt', name: info.name, fingerabdruck: info.fingerprint, gueltigBis: info.notAfter } });
		} catch (err) {
			return fail(400, { action: 'generate', message: (err as Error).message });
		}
		return { action: 'generate', saved: true };
	},

	upload: async ({ request, locals }) => {
		const user = requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const file = f.get('datei');
		const password = String(f.get('passwort') ?? '');
		if (!(file instanceof File) || !file.size) return fail(400, { action: 'upload', message: 'Bitte die Datei mit Zertifikat und Schlüssel wählen.' });
		if (file.size > 200_000) return fail(400, { action: 'upload', message: 'Die Datei ist zu groß für ein Zertifikat.' });
		try {
			const data = Buffer.from(await file.arrayBuffer());
			const m = data.toString('latin1').includes('-----BEGIN') ? readPemUpload(data.toString('utf8'), password) : readP12(data, password);
			const info = certInfo(m.certificates[0]);
			if (new Date(info.notAfter) < new Date()) return fail(400, { action: 'upload', message: `Das Zertifikat ist am ${info.notAfter.slice(0, 10)} abgelaufen.` });
			storeKey(m);
			await audit({
				invoiceId: null,
				user,
				action: 'zertifikat',
				detail: { art: 'hochgeladen', name: info.name, aussteller: info.issuerName, fingerabdruck: info.fingerprint, einstufung: QUALIFICATION_LABELS[qualification(info)] }
			});
		} catch (err) {
			return fail(400, { action: 'upload', message: err instanceof KeyFileError ? err.message : 'Die Datei ließ sich nicht lesen.' });
		}
		return { action: 'upload', saved: true };
	},

	check: async ({ locals }) => {
		const user = requirePermission(locals, 'einstellungen.bearbeiten');
		const result = await checkArchive(user);
		return { action: 'check', result };
	}
};
