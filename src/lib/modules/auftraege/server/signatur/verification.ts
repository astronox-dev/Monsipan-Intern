/**
 * InvoiceVerificationService – prüft eine ausgestellte Rechnung vollständig:
 *
 * - Archiv: Dateien vorhanden, SHA-256 wie beim Ablegen
 * - Datenbank: Rechnungsdaten wie beim Ausstellen (Prüfsumme der Inhalte)
 * - Signatur: PAdES-Signatur gültig, vom eingetragenen Zertifikat, über
 *   genau das archivierte Original; Zeitstempel gültig
 *
 * Daraus das Ergebnis für Rechnungsdetails und öffentliche Prüfseite:
 * gültig, ungültig, storniert oder nicht feststellbar. Dazu die nächtliche
 * Prüfung des ganzen Archivs samt Protokoll-Kette.
 */
import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invoiceFiles, invoices, invoiceSignatures, settings as settingsTable } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/settings';
import { notify } from '$lib/server/notifications';
import type { SessionUser } from '$lib/server/auth';
import { invoiceLabel, spacedNumber } from '../../offer';
import { CHECK_LABELS, type CheckResult, type InvoiceStage } from '../../signature';
import { audit, verifyAuditChain } from './audit';
import { currentContentHash, readArchiveFile, sha256Hex } from './archive';
import { QUALIFICATION_LABELS, type CertInfo, type Qualification } from './cert';
import { signatureSettings } from './settings';
import { inspectPdf } from './verify-pdf';

export interface PartCheck {
	ok: boolean | null;
	detail: string;
}

export interface InvoiceVerification {
	result: CheckResult;
	checkedAt: Date;
	stage: InvoiceStage;
	archive: PartCheck;
	database: PartCheck;
	signature: PartCheck & {
		level: string | null;
		signedAt: string | null;
		timestampAt: string | null;
		tsa: string | null;
		signer: CertInfo | null;
		qualification: string | null;
	};
	problems: string[];
}

export async function verifyInvoice(id: number, opts: { user?: SessionUser | null; record?: boolean } = {}): Promise<InvoiceVerification | null> {
	const row = await db.select().from(invoices).where(eq(invoices.id, id)).get();
	if (!row) return null;
	const out: InvoiceVerification = {
		result: 'unbekannt',
		checkedAt: new Date(),
		stage: row.stage,
		archive: { ok: null, detail: '' },
		database: { ok: null, detail: '' },
		signature: { ok: null, detail: '', level: null, signedAt: null, timestampAt: null, tsa: null, signer: null, qualification: null },
		problems: []
	};
	if (row.stage === 'entwurf') {
		out.archive.detail = 'Noch nicht ausgestellt.';
		return out;
	}
	const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all();
	const sigRow = await db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, id)).get();
	const original = files.find((f) => f.kind === 'original');
	const signedRow = files.find((f) => f.kind === 'signiert');

	// Archiv
	const read = (f: typeof original) => {
		if (!f) return null;
		const data = readArchiveFile(f.fileName);
		if (!data) out.problems.push(`Archivdatei fehlt (${f.kind}).`);
		else if (sha256Hex(data) !== f.sha256) out.problems.push(`Archivdatei verändert – Prüfsumme stimmt nicht (${f.kind}).`);
		else return data;
		return null;
	};
	if (!original) out.problems.push('Für diese Rechnung ist kein Original archiviert.');
	const originalPdf = read(original);
	const signedPdf = read(signedRow);
	out.archive = out.problems.length ? { ok: false, detail: out.problems.join(' ') } : { ok: true, detail: `${files.length} Datei${files.length === 1 ? '' : 'en'}, SHA-256 unverändert.` };

	// Datenbank gegen den Stand beim Ausstellen
	if (original?.contentHash) {
		const now = await currentContentHash(id);
		out.database =
			now === original.contentHash
				? { ok: true, detail: 'Rechnungsdaten wie beim Ausstellen.' }
				: { ok: false, detail: 'Die Rechnungsdaten in der Datenbank weichen vom Stand beim Ausstellen ab.' };
		if (!out.database.ok) out.problems.push(out.database.detail);
	}

	// Signatur
	if (signedRow || sigRow || row.stage === 'signiert') {
		const problems: string[] = [];
		if (!signedRow || !sigRow) problems.push('Die signierte Fassung oder ihre Angaben fehlen.');
		if (signedPdf && originalPdf && !signedPdf.subarray(0, originalPdf.length).equals(originalPdf)) problems.push('Die signierte Fassung enthält nicht das archivierte Original.');
		if (signedPdf) {
			const check = inspectPdf(signedPdf);
			const sig = check.signatures.find((s) => s.kind === 'signatur');
			problems.push(...check.signatures.flatMap((s) => s.problems));
			if (!sig) problems.push('In der Datei steht keine Signatur.');
			if (sig?.signer && sigRow && sig.signer.fingerprint !== sigRow.certFingerprint) problems.push('Die Signatur stammt nicht vom eingetragenen Zertifikat.');
			if (sigRow && check.level !== sigRow.level) problems.push(`Die Signaturstufe ist ${check.level ?? 'unbekannt'} statt ${sigRow.level}.`);
			out.signature.level = check.level;
			out.signature.signer = sig?.signer ?? null;
			out.signature.signedAt = sig?.claimedTime ?? null;
			out.signature.timestampAt = sig?.timestamp?.time ?? null;
			out.signature.tsa = sig?.timestamp?.tsa?.name ?? null;
		}
		if (sigRow) out.signature.qualification = QUALIFICATION_LABELS[sigRow.qualification as Qualification] ?? sigRow.qualification;
		out.signature.ok = problems.length === 0;
		out.signature.detail = problems.length ? problems.join(' ') : 'Signatur mathematisch gültig, vom eingetragenen Zertifikat, über das archivierte Original.';
		out.problems.push(...problems.filter((p) => !out.problems.includes(p)));
	} else {
		out.signature.detail = row.stage === 'fehlgeschlagen' ? `Nicht signiert – die Signierung ist fehlgeschlagen.` : 'Nicht digital signiert.';
	}

	out.result = out.problems.length ? 'ungueltig' : row.stage === 'storniert' ? 'storniert' : out.signature.ok ? 'gueltig' : 'unbekannt';

	if (opts.record !== false) {
		const detail = out.problems.length ? out.problems.join(' ') : out.signature.ok ? out.signature.detail : out.signature.detail || out.archive.detail;
		await db
			.update(invoices)
			.set({ checkedAt: out.checkedAt, checkResult: out.result, checkDetail: detail.slice(0, 1000) })
			.where(eq(invoices.id, id));
		// Händische Prüfungen immer ins Protokoll, automatische nur, wenn etwas nicht stimmt
		if (opts.user || out.result === 'ungueltig') {
			await audit({
				invoiceId: id,
				invoiceNumber: row.number,
				user: opts.user ?? null,
				action: out.result === 'ungueltig' ? 'pruefung_fehler' : 'geprueft',
				detail: { ergebnis: CHECK_LABELS[out.result].label, probleme: out.problems }
			});
		}
	}
	return out;
}

/* ------------------------------------------------------- Prüfseite */

export interface PublicVerification {
	number: string;
	kindLabel: string;
	date: string;
	issuedAt: string | null;
	issuer: string;
	stage: InvoiceStage;
	result: CheckResult;
	signed: boolean;
	level: string | null;
	signedAt: string | null;
	timestampAt: string | null;
	sealName: string | null;
	qualification: string | null;
	archive: boolean | null;
	cancelledAt: string | null;
	/** Prüfsummen der archivierten Dateien – zum Vergleich mit einer vorliegenden PDF */
	hashes: string[];
}

const cache = new Map<string, { at: number; value: PublicVerification }>();
const CACHE_MS = 5 * 60_000;

/**
 * Für die öffentliche Seite: nur, was nicht vertraulich ist – keine Beträge,
 * keine Positionen, kein Kunde. Das Ergebnis wird kurz gemerkt, damit häufige
 * Aufrufe nicht jedes Mal das Archiv lesen.
 */
export async function publicVerification(token: string): Promise<PublicVerification | 'aus' | null> {
	if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
	const settings = await signatureSettings();
	if (!settings.verifyEnabled) return 'aus';
	const hit = cache.get(token);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
	const row = await db
		.select({ id: invoices.id, number: invoices.number, kind: invoices.kind, date: invoices.date, issuedAt: invoices.issuedAt, cancelledAt: invoices.cancelledAt })
		.from(invoices)
		.where(and(eq(invoices.verifyToken, token), ne(invoices.stage, 'entwurf')))
		.get();
	if (!row) return null;
	const [check, appSettings, files, sig] = await Promise.all([
		verifyInvoice(row.id, { record: true }),
		getSettings(),
		db.select({ sha256: invoiceFiles.sha256 }).from(invoiceFiles).where(eq(invoiceFiles.invoiceId, row.id)).all(),
		db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, row.id)).get()
	]);
	if (!check) return null;
	const value: PublicVerification = {
		number: row.number,
		kindLabel: invoiceLabel(row.kind),
		date: row.date,
		issuedAt: row.issuedAt?.toISOString() ?? null,
		issuer: appSettings.offerFooterAddress.split('\n')[0]?.trim() || 'Monsipan Bautenschutz GesmbH',
		stage: check.stage,
		result: check.result,
		signed: !!sig,
		level: check.signature.level ?? sig?.level ?? null,
		signedAt: check.signature.signedAt ?? sig?.signedAt.toISOString() ?? null,
		timestampAt: check.signature.timestampAt ?? sig?.timestampAt?.toISOString() ?? null,
		sealName: sig ? sig.certOrganization || sig.certName : null,
		qualification: check.signature.qualification,
		archive: check.archive.ok,
		cancelledAt: row.cancelledAt?.toISOString() ?? null,
		hashes: files.map((f) => f.sha256)
	};
	cache.set(token, { at: Date.now(), value });
	if (cache.size > 500) cache.delete(cache.keys().next().value!);
	return value;
}

/** Nach Storno oder Signierung: die Prüfseite sofort neu rechnen */
export function forgetVerification(token: string | null | undefined) {
	if (token) cache.delete(token);
}

/* ------------------------------------------------- Archiv prüfen */

export interface ArchiveCheck {
	at: string;
	invoices: number;
	problems: { id: number; number: string; detail: string }[];
	audit: { ok: boolean; entries: number; brokenAt: number | null };
}

const LAST_CHECK = 'signatur.pruefung';

/** Ergebnis der letzten Archivprüfung */
export async function lastArchiveCheck(): Promise<ArchiveCheck | null> {
	const row = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, LAST_CHECK)).get();
	try {
		return row ? (JSON.parse(row.value) as ArchiveCheck) : null;
	} catch {
		return null;
	}
}

/** Alle ausgestellten Rechnungen und die Protokoll-Kette prüfen */
export async function checkArchive(user: SessionUser | null = null): Promise<ArchiveCheck> {
	const issued = await db.select({ id: invoices.id, number: invoices.number, kind: invoices.kind }).from(invoices).where(ne(invoices.stage, 'entwurf')).all();
	const problems: ArchiveCheck['problems'] = [];
	for (const i of issued) {
		const check = await verifyInvoice(i.id, { record: true });
		if (check?.result === 'ungueltig') problems.push({ id: i.id, number: i.number, detail: check.problems.join(' ') });
	}
	const chain = await verifyAuditChain();
	const result: ArchiveCheck = { at: new Date().toISOString(), invoices: issued.length, problems, audit: chain };
	const value = JSON.stringify(result);
	await db.insert(settingsTable).values({ key: LAST_CHECK, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value } });
	await audit({ invoiceId: null, user, action: 'archivpruefung', detail: { rechnungen: issued.length, fehler: problems.length, protokoll: chain.ok } });
	if (problems.length || !chain.ok) {
		notify({
			event: 'rechnung.archiv',
			title: 'Archivprüfung: Rechnungen mit Fehlern',
			body: [
				...problems.slice(0, 3).map((p) => `${spacedNumber(p.number)}: ${p.detail}`),
				...(chain.ok ? [] : [`Protokoll-Kette unterbrochen bei Eintrag ${chain.brokenAt}`])
			].join(' · '),
			url: problems[0] ? `/rechnungen/${problems[0].id}` : '/verwaltung/einstellungen/signatur'
		});
	}
	return result;
}
