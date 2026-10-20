import fs from 'node:fs';
import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { BACKUP_DIR, createBackup, listBackups } from '$lib/server/backup';
import { dataFilesSummary } from '$lib/server/backup-zip';
import { isWriting, partFile, UPLOAD_ID } from '$lib/server/parts';
import { db, DB_FILE } from '$lib/server/db';
import { movements, products, users } from '$lib/server/db/schema';
import { isRateLimited, registerFailure, verifyPassword } from '$lib/server/auth';
import { requirePermission, str } from '$lib/server/guard';
import { dataCounts, isResetPhrase, RESET_PHRASE, resetAllData } from '$lib/server/reset';
import { backupPath, restoreFromFile, RestoreError, restoreUpload, stageUpload } from '$lib/server/restore';
import { mailInfo, sendMail, testMail } from '$lib/server/mail';
import { getSettings, updateSettings } from '$lib/server/settings';
import { letterheadPath, LetterheadError, storeLetterhead } from '$lib/server/letterhead';
import { disconnectWebsite, newWebsiteKey, websiteLink } from '$lib/modules/auftraege/server/website';
import { readPaymentTerms } from '$lib/modules/auftraege/offer';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const me = requirePermission(locals, 'einstellungen.sehen');
	const [settings, counts] = await Promise.all([
		getSettings(),
		Promise.all([
			db.select({ n: sql<number>`count(*)` }).from(products).get(),
			db.select({ n: sql<number>`count(*)` }).from(movements).get(),
			db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.active, true)).get()
		])
	]);
	let dbSize = 0;
	try {
		dbSize = fs.statSync(DB_FILE).size;
	} catch {
		/* noch keine Datei */
	}
	return {
		settings,
		letterhead: !!letterheadPath(settings.letterheadFile),
		mail: mailInfo(),
		// Kontaktformular der Webseite: Adresse des Portals und Schlüssel für deren Stack
		website: { portalUrl: url.origin, link: await websiteLink() },
		myEmail: me.email,
		resetCounts: await dataCounts(me.id),
		resetPhrase: RESET_PHRASE,
		backups: listBackups(),
		// Was beim Herunterladen außer der Datenbank in die ZIP-Datei kommt
		files: dataFilesSummary(),
		stats: {
			products: Number(counts[0]?.n ?? 0),
			movements: Number(counts[1]?.n ?? 0),
			users: Number(counts[2]?.n ?? 0),
			dbSize
		}
	};
};

export const actions: Actions = {
	/** Kontaktformular der Webseite verbinden bzw. neuen Schlüssel erzeugen (der alte gilt dann nicht mehr) */
	websiteKey: async ({ locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		await newWebsiteKey();
		return { saved: 'websiteKey' };
	},
	websiteOff: async ({ locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		await disconnectWebsite();
		return { saved: 'websiteOff' };
	},
	/** Vorlagen für Angebote: Einleitung und Schlusstext */
	offerTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		await updateSettings({ offerIntro: text('intro', 3000), offerClosing: text('closing', 5000) });
		return { saved: 'offerTexts' };
	},
	/** Einleitung und Schlusstext im Auftrags-PDF */
	orderTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		await updateSettings({ orderIntro: text('intro', 3000), orderClosing: text('closing', 5000) });
		return { saved: 'orderTexts' };
	},
	/** Fußzeile – für Angebote, Aufträge und Rechnungen gleich */
	footerTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		await updateSettings({
			offerFooterAddress: text('footerAddress', 400),
			offerFooterBank: text('footerBank', 400),
			offerFooterContact: text('footerContact', 400)
		});
		return { saved: 'footerTexts' };
	},
	/** Vorlagen für Rechnungen: Einleitung und Schlusstext */
	invoiceTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		await updateSettings({ invoiceIntro: text('intro', 3000), invoiceClosing: text('closing', 5000) });
		return { saved: 'invoiceTexts' };
	},
	/** Zahlungsbedingungen für neue Angebote und Rechnungen: Zahlungsziel und Skonto */
	paymentTerms: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const terms = readPaymentTerms((k) => String(f.get(k) ?? ''));
		if ('message' in terms) return fail(400, { message: terms.message });
		await updateSettings({ invoicePaymentDays: terms.paymentDays, skontoPercent: terms.skontoPercent, skontoDays: terms.skontoDays });
		return { saved: 'paymentTerms' };
	},
	letterhead: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const upload = (await request.formData()).get('bild');
		if (!(upload instanceof File) || upload.size === 0) return fail(400, { message: 'Bitte ein Bild auswählen.' });
		try {
			await updateSettings({ letterheadFile: await storeLetterhead(upload) });
		} catch (err) {
			if (err instanceof LetterheadError) return fail(400, { message: err.message });
			throw err;
		}
		return { saved: 'letterhead' };
	},
	letterheadRemove: async ({ locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		await updateSettings({ letterheadFile: null });
		return { saved: 'letterhead' };
	},
	testMail: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const to = str((await request.formData()).get('to'), 120);
		if (!to.includes('@')) return fail(400, { message: 'Bitte eine E-Mail-Adresse angeben.' });
		const ok = await sendMail(testMail(to));
		if (!ok) return fail(500, { message: 'Versand fehlgeschlagen. Details stehen im Server-Log.' });
		return { mailed: to };
	},
	backup: async ({ locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const name = await createBackup();
		return { backup: name };
	},
	/** Alles zurücksetzen – doppelt bestätigt: Bestätigungstext + eigenes Passwort */
	/**
	 * Sicherung einspielen: aus der Liste oder hochgeladen – als ZIP-Datei
	 * (Komplettsicherung) oder .db. Hochgeladen wird vorher in Teilen über
	 * /api/sicherung (`upload` = Kennung); ohne JavaScript kommt die Datei selbst.
	 */
	restore: async ({ request, locals, getClientAddress }) => {
		const me = requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const key = `restore:${getClientAddress()}:${me.id}`;
		// keepUpload: die hochgeladene Datei bleibt für den nächsten Versuch
		if (isRateLimited(key, 5)) return fail(429, { restore: true, keepUpload: true, message: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' });
		const row = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).get();
		if (!row || !(await verifyPassword(row.hash, String(f.get('password') ?? '')))) {
			registerFailure(key);
			return fail(400, { restore: true, keepUpload: true, message: 'Das Passwort stimmt nicht.' });
		}

		const upload = f.get('file');
		const uploadId = str(f.get('upload'), 80);
		const chosen = str(f.get('backup'), 120);
		let uploaded: string | null = null;
		try {
			if (uploadId) {
				if (!UPLOAD_ID.test(uploadId)) return fail(400, { restore: true, message: 'Unbekannter Upload.' });
				uploaded = partFile(BACKUP_DIR, me.id, uploadId);
				if (!fs.existsSync(uploaded) || isWriting(uploaded)) {
					uploaded = null;
					return fail(400, { restore: true, message: 'Die Datei ist nicht vollständig angekommen – bitte noch einmal hochladen.' });
				}
			} else if (upload instanceof File && upload.size > 0) {
				uploaded = await stageUpload(upload);
			}
			const label = uploaded ? str(f.get('name'), 160) || (upload instanceof File ? upload.name : 'hochgeladene Datei') : chosen;
			let result;
			if (uploaded) result = await restoreUpload(uploaded, `${label} (durch ${me.username})`);
			else if (chosen) result = { ...(await restoreFromFile(backupPath(chosen), `${label} (durch ${me.username})`)), files: null };
			else return fail(400, { restore: true, message: 'Bitte eine Sicherung auswählen oder eine Datei hochladen.' });
			return { restoreDone: true, backup: result.backup, contents: result.contents, files: result.files, source: label };
		} catch (err) {
			if (err instanceof RestoreError) return fail(400, { restore: true, message: err.message });
			console.error('[restore]', err);
			return fail(500, { restore: true, message: 'Die Sicherung konnte nicht eingespielt werden. Details stehen im Log.' });
		} finally {
			// Die hochgeladene Datei wird nach dem Einspielen nicht mehr gebraucht (bei falschem Passwort bleibt sie für den nächsten Versuch)
			if (uploaded) fs.rmSync(uploaded, { force: true });
		}
	},

	reset: async ({ request, locals, getClientAddress }) => {
		const me = requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		if (!isResetPhrase(String(f.get('phrase') ?? ''))) {
			return fail(400, { reset: true, message: `Bitte genau „${RESET_PHRASE}“ eintippen.` });
		}
		const key = `reset:${getClientAddress()}:${me.id}`;
		if (isRateLimited(key, 5)) return fail(429, { reset: true, message: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' });
		const row = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).get();
		if (!row || !(await verifyPassword(row.hash, String(f.get('password') ?? '')))) {
			registerFailure(key);
			return fail(400, { reset: true, message: 'Das Passwort stimmt nicht.' });
		}
		const result = await resetAllData({
			keepUserId: me.id,
			deleteOtherUsers: f.get('deleteUsers') === 'on',
			reseedCatalog: f.get('reseedCatalog') === 'on'
		});
		console.warn(`[reset] Alle Daten gelöscht von ${me.username}, Sicherung vorher: ${result.backup}`);
		return { resetDone: true, backup: result.backup };
	}
};
