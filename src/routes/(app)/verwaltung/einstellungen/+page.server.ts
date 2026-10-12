import fs from 'node:fs';
import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { createBackup, listBackups } from '$lib/server/backup';
import { db, DB_FILE } from '$lib/server/db';
import { movements, products, users } from '$lib/server/db/schema';
import { isRateLimited, registerFailure, verifyPassword } from '$lib/server/auth';
import { requirePermission, str } from '$lib/server/guard';
import { dataCounts, isResetPhrase, RESET_PHRASE, resetAllData } from '$lib/server/reset';
import { backupPath, MAX_UPLOAD_BYTES, restoreFromFile, RestoreError, stageUpload } from '$lib/server/restore';
import { mailInfo, sendMail, testMail } from '$lib/server/mail';
import { getSettings, updateSettings } from '$lib/server/settings';
import { letterheadPath, LetterheadError, storeLetterhead } from '$lib/server/letterhead';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
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
		myEmail: me.email,
		resetCounts: await dataCounts(me.id),
		resetPhrase: RESET_PHRASE,
		maxUploadBytes: MAX_UPLOAD_BYTES,
		backups: listBackups(),
		stats: {
			products: Number(counts[0]?.n ?? 0),
			movements: Number(counts[1]?.n ?? 0),
			users: Number(counts[2]?.n ?? 0),
			dbSize
		}
	};
};

export const actions: Actions = {
	/** Vorlagen für Angebote: Einleitung, Schlusstext, Fußzeile */
	offerTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		await updateSettings({
			offerIntro: text('intro', 3000),
			offerClosing: text('closing', 5000),
			offerFooterAddress: text('footerAddress', 400),
			offerFooterBank: text('footerBank', 400),
			offerFooterContact: text('footerContact', 400)
		});
		return { saved: 'offerTexts' };
	},
	/** Vorlagen für Rechnungen: Einleitung, Schlusstext, Zahlungsziel */
	invoiceTexts: async ({ request, locals }) => {
		requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const text = (key: string, max: number) => String(f.get(key) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
		const days = Number(f.get('days'));
		if (!Number.isInteger(days) || days < 0 || days > 365) return fail(400, { message: 'Das Zahlungsziel muss zwischen 0 und 365 Tagen liegen.' });
		await updateSettings({ invoiceIntro: text('intro', 3000), invoiceClosing: text('closing', 5000), invoicePaymentDays: days });
		return { saved: 'invoiceTexts' };
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
	/** Sicherung einspielen: aus der Liste oder als hochgeladene Datei */
	restore: async ({ request, locals, getClientAddress }) => {
		const me = requirePermission(locals, 'einstellungen.bearbeiten');
		const f = await request.formData();
		const key = `restore:${getClientAddress()}:${me.id}`;
		if (isRateLimited(key, 5)) return fail(429, { restore: true, message: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' });
		const row = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me.id)).get();
		if (!row || !(await verifyPassword(row.hash, String(f.get('password') ?? '')))) {
			registerFailure(key);
			return fail(400, { restore: true, message: 'Das Passwort stimmt nicht.' });
		}

		const upload = f.get('file');
		const chosen = str(f.get('backup'), 120);
		try {
			let source: string;
			let label: string;
			if (upload instanceof File && upload.size > 0) {
				source = await stageUpload(upload);
				label = upload.name;
			} else if (chosen) {
				source = backupPath(chosen);
				label = chosen;
			} else {
				return fail(400, { restore: true, message: 'Bitte eine Sicherung auswählen oder eine Datei hochladen.' });
			}
			const result = await restoreFromFile(source, `${label} (durch ${me.username})`);
			return { restoreDone: true, backup: result.backup, contents: result.contents, source: label };
		} catch (err) {
			if (err instanceof RestoreError) return fail(400, { restore: true, message: err.message });
			console.error('[restore]', err);
			return fail(500, { restore: true, message: 'Die Sicherung konnte nicht eingespielt werden. Details stehen im Log.' });
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
