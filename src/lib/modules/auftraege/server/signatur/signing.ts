/**
 * InvoiceSigningService – eine Rechnung endgültig ausstellen und signieren:
 *
 * 1. Entwurf prüfen, Prüfcode-Schlüssel erzeugen (zufällig, 144 Bit)
 * 2. das endgültige PDF genau einmal erzeugen (mit Prüfcode)
 * 3. archivieren (SHA-256, schreibgeschützt, nie überschrieben) und in einer
 *    Transaktion als „ausgestellt" eintragen – nur, wenn sich der Entwurf
 *    seit dem Erzeugen nicht geändert hat
 * 4. ist die Signatur eingeschaltet: „Signierung läuft", PAdES-Signatur über
 *    das archivierte Original, Selbstprüfung, signierte Fassung archivieren,
 *    „signiert". Scheitert etwas, heißt es „Signierung fehlgeschlagen" – nie
 *    „signiert" – und lässt sich erneut versuchen.
 *
 * Korrekturen gehen danach nur über ein Storno: eine eigene Stornorechnung
 * mit umgekehrten Mengen, selbst ausgestellt und signiert.
 */
import crypto from 'node:crypto';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dailyReports, invoiceFiles, invoicePositions, invoices, invoiceSignatures, type InvoiceFile } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth';
import { notify } from '$lib/server/notifications';
import { today } from '$lib/modules/stunden/week';
import { date as dateLabel } from '$lib/format';
import { invoiceLabel, invoiceNo } from '../../offer';
import { nextInvoiceNumber } from '../../summary';
import { verifyPath, type InvoiceStage } from '../../signature';
import { invoiceDetail, type InvoiceDetail } from '../invoices';
import { syncOfferBilling } from '../billing';
import { invoicePdfBuffer } from '../pdf';
import { audit } from './audit';
import { contentHash, readArchiveFile, readContent, removeUnreferenced, retentionDate, sha256Hex, writeArchiveFile } from './archive';
import { forgetVerification } from './verification';
import { certInfo, qualification } from './cert';
import { signPdf } from './pades';
import { createProvider, toRawSigner } from './provider';
import { collectValidationData } from './revocation';
import { secrets, signatureSettings, verifyBase, type SignatureSettings } from './settings';
import { requestTimestamp } from './tsa';
import { inspectPdf } from './verify-pdf';

export type IssueResult = { ok: true; stage: InvoiceStage; warning?: string } | { ok: false; message: string };

/** Signierung, die länger als so lange „läuft", gilt als abgebrochen (Neustart mittendrin) */
const STALE_SIGNING_MS = 5 * 60_000;
const running = new Set<number>();

class Conflict extends Error {}

/** Meldungen nach außen: verständlich, ohne Geheimnisse */
function reason(err: unknown): string {
	const text = err instanceof Error ? err.message : String(err);
	return text.replace(/\s+/g, ' ').slice(0, 400) || 'Unbekannter Fehler';
}

export async function issueInvoice(user: SessionUser, id: number, origin: string): Promise<IssueResult> {
	const settings = await signatureSettings();
	const invoice = await invoiceDetail(id);
	if (!invoice) return { ok: false, message: 'Die Rechnung gibt es nicht mehr.' };
	if (invoice.stage !== 'entwurf') return { ok: false, message: 'Die Rechnung ist schon ausgestellt.' };
	if (!invoice.lines.some((l) => l.kind === 'position')) return { ok: false, message: 'Die Rechnung hat keine Position.' };

	const token = crypto.randomBytes(18).toString('base64url');
	const issuedAt = new Date();
	const verifyUrl = settings.verifyEnabled ? `${verifyBase(settings, origin)}${verifyPath(token)}` : null;
	const hash = contentHash(invoice);
	let pdf: Buffer;
	let file: { fileName: string; sha256: string; size: number };
	try {
		pdf = await invoicePdfBuffer(invoice, { issued: { issuedAt, verifyUrl } });
		file = writeArchiveFile({ year: invoice.date.slice(0, 4), number: invoice.number, kind: 'original', pdf });
	} catch (err) {
		console.error('[rechnung] Ausstellen', err);
		return { ok: false, message: `Das PDF ließ sich nicht archivieren: ${reason(err)}` };
	}

	try {
		await db.transaction(async (tx) => {
			const now = await readContent(tx, id);
			if (!now || now.head.stage !== 'entwurf' || now.hash !== hash) throw new Conflict();
			await tx
				.update(invoices)
				.set({
					stage: 'ausgestellt',
					issuedAt,
					issuedBy: user.id,
					verifyToken: token,
					retainUntil: retentionDate(invoice.date, settings.retentionYears),
					signError: null,
					updatedAt: issuedAt
				})
				.where(and(eq(invoices.id, id), eq(invoices.stage, 'entwurf')));
			await tx.insert(invoiceFiles).values({ invoiceId: id, kind: 'original', ...file, contentHash: hash, createdBy: user.id });
			const ref = { invoiceId: id, invoiceNumber: invoice.number, user };
			await audit({ ...ref, action: 'ausgestellt', detail: { datum: invoice.date, art: invoice.kind, pruefsummeDaten: hash } }, tx);
			await audit({ ...ref, action: 'archiviert', detail: { datei: file.fileName, sha256: file.sha256, bytes: file.size } }, tx);
		});
	} catch (err) {
		removeUnreferenced(file.fileName);
		if (err instanceof Conflict) return { ok: false, message: 'Die Rechnung wurde inzwischen geändert – bitte neu laden und nochmal ausstellen.' };
		console.error('[rechnung] Ausstellen', err);
		return { ok: false, message: `Ausstellen fehlgeschlagen: ${reason(err)}` };
	}

	if (!settings.enabled) return { ok: true, stage: 'ausgestellt' };
	return signIssued(user, id, settings);
}

/** Signieren (auch erneut nach einem Fehler) – über das archivierte Original */
export async function signIssued(user: SessionUser | null, id: number, given?: SignatureSettings): Promise<IssueResult> {
	const settings = given ?? (await signatureSettings());
	if (!settings.enabled) return { ok: false, message: 'Die digitale Signatur ist ausgeschaltet.' };
	if (running.has(id)) return { ok: false, message: 'Die Rechnung wird gerade signiert.' };
	const row = await db.select().from(invoices).where(eq(invoices.id, id)).get();
	if (!row) return { ok: false, message: 'Die Rechnung gibt es nicht mehr.' };
	const stale = row.stage === 'signierung' && Date.now() - (row.updatedAt?.getTime() ?? 0) > STALE_SIGNING_MS;
	if (row.stage !== 'ausgestellt' && row.stage !== 'fehlgeschlagen' && !stale) {
		return { ok: false, message: row.stage === 'signiert' ? 'Die Rechnung ist schon signiert.' : 'Diese Rechnung lässt sich nicht signieren.' };
	}
	const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id)).all();
	const original = files.find((f) => f.kind === 'original');
	if (files.some((f) => f.kind === 'signiert')) return { ok: false, message: 'Die Rechnung ist schon signiert.' };
	const ref = { invoiceId: id, invoiceNumber: row.number, user };

	running.add(id);
	try {
		await db.update(invoices).set({ stage: 'signierung', signError: null, updatedAt: new Date() }).where(eq(invoices.id, id));
		await audit({ ...ref, action: 'signierung', detail: { anbieter: settings.provider, stufe: settings.level } });
		const pdf = original ? readArchiveFile(original.fileName) : null;
		if (!original || !pdf) throw new Error('Das archivierte Original fehlt.');
		if (sha256Hex(pdf) !== original.sha256) throw new Error('Das archivierte Original stimmt nicht mehr mit seiner Prüfsumme überein.');

		const signer = await toRawSigner(createProvider(settings));
		const leaf = certInfo(signer.certificates[0]);
		const now = new Date();
		if (now < new Date(leaf.notBefore) || now > new Date(leaf.notAfter)) throw new Error(`Das Zertifikat „${leaf.name}" ist nicht gültig (gültig bis ${dateLabel(leaf.notAfter.slice(0, 10))}).`);
		const result = await signPdf(pdf, {
			level: settings.level,
			signer,
			timestamp: (data) => requestTimestamp({ url: settings.tsaUrl, user: secrets.tsaUser(), password: secrets.tsaPassword() }, data),
			validation: collectValidationData,
			field: 'Rechnungssiegel',
			name: leaf.organization || leaf.name,
			reason: `${settings.reason} – ${invoiceLabel(row.kind)} Nr. ${invoiceNo(row)}`,
			location: settings.location,
			time: now
		});

		// Selbstprüfung: gültig, vom erwarteten Zertifikat, Original unverändert enthalten
		const check = inspectPdf(result.pdf);
		const sig = check.signatures.find((s) => s.kind === 'signatur');
		if (!check.ok || !sig || sig.signer?.fingerprint !== leaf.fingerprint) throw new Error(`Selbstprüfung fehlgeschlagen: ${check.signatures.flatMap((s) => s.problems).join(' ') || 'Signatur fehlt'}`);
		if (!result.pdf.subarray(0, pdf.length).equals(pdf)) throw new Error('Selbstprüfung fehlgeschlagen: Das Original ist nicht unverändert enthalten.');
		if (check.level !== result.level) throw new Error(`Selbstprüfung fehlgeschlagen: Stufe ${check.level} statt ${result.level}.`);

		const signed = writeArchiveFile({ year: row.date.slice(0, 4), number: row.number, kind: 'signiert', pdf: result.pdf });
		try {
			await db.transaction(async (tx) => {
				const fileRow = await tx
					.insert(invoiceFiles)
					.values({ invoiceId: id, kind: 'signiert', ...signed, createdBy: user?.id ?? null })
					.returning({ id: invoiceFiles.id })
					.get();
				await tx.insert(invoiceSignatures).values({
					invoiceId: id,
					fileId: fileRow.id,
					provider: settings.provider,
					requestedLevel: settings.level,
					level: result.level,
					signedAt: result.signedAt,
					timestampAt: result.timestampAt,
					tsa: result.tsaCertificates[0] ? certInfo(result.tsaCertificates[0]).name : '',
					certName: leaf.name,
					certOrganization: leaf.organization,
					certIssuer: leaf.issuerName,
					certSerial: leaf.serial,
					certFingerprint: leaf.fingerprint,
					certNotBefore: leaf.notBefore,
					certNotAfter: leaf.notAfter,
					qualification: qualification(leaf),
					notes: result.notes.join(' ')
				});
				await tx.update(invoices).set({ stage: 'signiert', signError: null, updatedAt: new Date() }).where(eq(invoices.id, id));
				await audit(
					{
						...ref,
						action: 'signiert',
						detail: { stufe: result.level, datei: signed.fileName, sha256: signed.sha256, zertifikat: leaf.name, zeitstempel: result.timestampAt?.toISOString() ?? null }
					},
					tx
				);
			});
		} catch (err) {
			removeUnreferenced(signed.fileName);
			throw err;
		}
		return { ok: true, stage: 'signiert', warning: result.notes.length ? result.notes.join(' ') : undefined };
	} catch (err) {
		const message = reason(err);
		console.error(`[rechnung] Signierung ${row.number}`, err);
		await db.update(invoices).set({ stage: 'fehlgeschlagen', signError: message, updatedAt: new Date() }).where(eq(invoices.id, id));
		await audit({ ...ref, action: 'fehlgeschlagen', detail: { fehler: message } });
		notify({
			event: 'rechnung.signatur',
			title: `Signierung fehlgeschlagen: ${invoiceLabel(row.kind)} ${invoiceNo(row)}`,
			body: message,
			url: `/rechnungen/${id}`,
			actorId: user?.id
		});
		return { ok: true, stage: 'fehlgeschlagen', warning: message };
	} finally {
		running.delete(id);
		forgetVerification(row.verifyToken);
	}
}

/* ------------------------------------------------------------ Storno */

export type CancelResult = { ok: true; stornoId: number; stage: InvoiceStage; warning?: string } | { ok: false; message: string };

/**
 * Stornieren: Stornorechnung mit umgekehrten Mengen anlegen und ausstellen,
 * dann die Rechnung als storniert kennzeichnen. Ihre Tagesberichte sind
 * danach wieder abzurechnen – mit einer neuen (Korrektur-)Rechnung.
 */
export async function cancelInvoice(user: SessionUser, id: number, why: string, origin: string): Promise<CancelResult> {
	const text = why.replace(/\s+/g, ' ').trim().slice(0, 500);
	if (text.length < 3) return { ok: false, message: 'Bitte den Grund für das Storno angeben.' };
	const invoice = await invoiceDetail(id);
	if (!invoice) return { ok: false, message: 'Die Rechnung gibt es nicht mehr.' };
	if (invoice.kind === 'storno') return { ok: false, message: 'Eine Stornorechnung lässt sich nicht stornieren.' };
	if (invoice.stage === 'entwurf') return { ok: false, message: 'Ein Entwurf wird nicht storniert, sondern geändert oder gelöscht.' };
	if (invoice.stage === 'storniert') return { ok: false, message: 'Die Rechnung ist schon storniert.' };
	if (invoice.stage === 'signierung') return { ok: false, message: 'Die Rechnung wird gerade signiert – bitte kurz warten.' };

	// Gibt es schon eine Stornorechnung (z. B. nach einem Abbruch), wird sie verwendet
	let storno = await db.select({ id: invoices.id, stage: invoices.stage }).from(invoices).where(eq(invoices.cancelsId, id)).get();
	if (!storno) {
		const created = await createStorno(user, invoice, text);
		if (typeof created !== 'number') return created;
		storno = { id: created, stage: 'entwurf' };
	}
	let stage = storno.stage as InvoiceStage;
	let warning: string | undefined;
	if (stage === 'entwurf') {
		const issued = await issueInvoice(user, storno.id, origin);
		if (!issued.ok) return { ok: false, message: `Die Stornorechnung ließ sich nicht ausstellen: ${issued.message}` };
		stage = issued.stage;
		warning = issued.warning;
	}
	const stornoNumber = (await db.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, storno.id)).get())?.number ?? '';
	await db.transaction(async (tx) => {
		await tx
			.update(invoices)
			.set({ stage: 'storniert', cancelledAt: new Date(), cancelledBy: user.id, cancelReason: text, stornoId: storno.id, updatedAt: new Date() })
			.where(and(eq(invoices.id, id), inArray(invoices.stage, ['ausgestellt', 'signiert', 'fehlgeschlagen', 'importiert'])));
		// Welche Berichte frei werden, steht im Protokoll – wird die Stornorechnung (zum Testen) gelöscht, kommen sie zurück
		const released = await tx.select({ id: dailyReports.id }).from(dailyReports).where(eq(dailyReports.invoiceId, id)).all();
		await tx.update(dailyReports).set({ invoiceId: null }).where(eq(dailyReports.invoiceId, id));
		await audit(
			{ invoiceId: id, invoiceNumber: invoice.number, user, action: 'storniert', detail: { grund: text, stornorechnung: stornoNumber, tagesberichte: released.map((r) => r.id) } },
			tx
		);
		// Storniert zählt nicht mehr – das Angebot ist dann womöglich nicht mehr abgerechnet
		await syncOfferBilling(invoice.orderId, 'beide', tx);
	});
	forgetVerification(invoice.verifyToken);
	return { ok: true, stornoId: storno.id, stage, warning };
}

async function createStorno(user: SessionUser, invoice: InvoiceDetail, why: string): Promise<number | { ok: false; message: string }> {
	return db.transaction(async (tx) => {
		// Nummer wie jede weitere Rechnung zum Auftrag („-2", „-3" …); ohne Auftrag an die stornierte angehängt
		const base = invoice.orderNumber ?? invoice.number;
		const taken = await tx
			.select({ number: invoices.number })
			.from(invoices)
			.where(or(eq(invoices.number, base), like(invoices.number, `${base}-%`)))
			.all();
		const date = today();
		const label = `${invoiceLabel(invoice.kind)} Nr. ${invoiceNo(invoice)}`;
		const row = await tx
			.insert(invoices)
			.values({
				number: nextInvoiceNumber(base, new Set(taken.map((t) => t.number))),
				kind: 'storno',
				orderId: invoice.orderId,
				offerId: invoice.offerId,
				date,
				serviceFrom: invoice.serviceFrom,
				serviceTo: invoice.serviceTo,
				dueDate: date,
				projectNumber: invoice.projectNumber,
				costCenter: invoice.costCenter,
				title: invoice.title,
				location: invoice.location,
				customerName: invoice.customerName,
				customerAddition: invoice.customerAddition,
				customerStreet: invoice.customerStreet,
				customerZip: invoice.customerZip,
				customerCity: invoice.customerCity,
				customerUid: invoice.customerUid,
				intro: `Hiermit stornieren wir die ${label} vom ${dateLabel(invoice.date)}.\nGrund: ${why}`,
				closing: '',
				state: invoice.state,
				section: invoice.section,
				vatRate: invoice.vatRate,
				reverseCharge: invoice.reverseCharge,
				discountPercent: invoice.discountPercent,
				discountAmount: invoice.discountAmount,
				status: 'offen',
				cancelsId: invoice.id,
				createdBy: user.id,
				updatedAt: new Date()
			})
			.returning({ id: invoices.id, number: invoices.number })
			.get();
		for (const [i, l] of invoice.lines.entries()) {
			await tx.insert(invoicePositions).values({
				invoiceId: row.id,
				sortOrder: i,
				number: l.number,
				kind: l.kind,
				text: l.text,
				note: l.note ?? '',
				quantity: l.kind === 'titel' || l.quantity == null ? l.quantity : -l.quantity,
				unit: l.unit,
				unitPrice: l.unitPrice
			});
		}
		await audit({ invoiceId: row.id, invoiceNumber: row.number, user, action: 'erstellt', detail: { storno_zu: invoice.number } }, tx);
		return row.id;
	});
}

export type { InvoiceFile };
