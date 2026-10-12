import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { can } from '$lib/permissions';
import { db } from '$lib/server/db';
import { invoiceFiles, invoiceSignatures } from '$lib/server/db/schema';
import { requirePermission } from '$lib/server/guard';
import { deleteInvoice, invoiceDetail, setInvoiceOpen, setInvoicePaid } from '$lib/modules/auftraege/server/invoices';
import { isValidIsoDate, today } from '$lib/modules/stunden/week';
import { notifyInvoice } from '$lib/modules/auftraege/server/notify';
import { audit, auditTrail } from '$lib/modules/auftraege/server/signatur/audit';
import { cancelInvoice, issueInvoice, signIssued } from '$lib/modules/auftraege/server/signatur/signing';
import { verifyInvoice } from '$lib/modules/auftraege/server/signatur/verification';
import { signatureSettings, verifyBase } from '$lib/modules/auftraege/server/signatur/settings';
import { QUALIFICATION_LABELS, type Qualification } from '$lib/modules/auftraege/server/signatur/cert';
import { verifyPath } from '$lib/modules/auftraege/signature';
import type { Actions, PageServerLoad } from './$types';

async function open(id: number, locals: App.Locals) {
	const user = requirePermission(locals, 'rechnungen.sehen');
	const invoice = await invoiceDetail(id);
	if (!invoice) error(404, 'Rechnung nicht gefunden');
	return { user, invoice };
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const { user, invoice } = await open(Number(params.id), locals);
	const draft = invoice.stage === 'entwurf';
	const isOpen = invoice.status === 'offen';
	const [settings, files, signature, trail] = await Promise.all([
		signatureSettings(),
		db
			.select({ kind: invoiceFiles.kind, sha256: invoiceFiles.sha256, size: invoiceFiles.size, createdAt: invoiceFiles.createdAt })
			.from(invoiceFiles)
			.where(eq(invoiceFiles.invoiceId, invoice.id))
			.all(),
		db.select().from(invoiceSignatures).where(eq(invoiceSignatures.invoiceId, invoice.id)).get(),
		auditTrail(invoice.id)
	]);
	const issuable = draft && can(user.role, 'rechnungen.ausstellen');
	return {
		invoice,
		today: today(),
		canEdit: draft && isOpen && invoice.kind !== 'storno' && can(user.role, 'rechnungen.bearbeiten'),
		canPay: can(user.role, 'rechnungen.bezahlt') && invoice.kind !== 'storno' && invoice.stage !== 'storniert',
		canDelete: draft && isOpen && can(user.role, 'rechnungen.loeschen'),
		canIssue: issuable,
		canSign: settings.enabled && can(user.role, 'rechnungen.ausstellen') && ['ausgestellt', 'fehlgeschlagen', 'signierung'].includes(invoice.stage),
		canCancel: can(user.role, 'rechnungen.stornieren') && invoice.kind !== 'storno' && ['ausgestellt', 'signiert', 'fehlgeschlagen'].includes(invoice.stage),
		canSeeOrder: !!invoice.orderId && can(user.role, 'auftraege.sehen'),
		canSeeReports: can(user.role, 'tagesberichte.sehen'),
		signing: { enabled: settings.enabled, level: settings.level, verify: settings.verifyEnabled },
		files,
		signature: signature
			? {
					provider: signature.provider,
					level: signature.level,
					requestedLevel: signature.requestedLevel,
					signedAt: signature.signedAt,
					timestampAt: signature.timestampAt,
					tsa: signature.tsa,
					certName: signature.certName,
					certOrganization: signature.certOrganization,
					certIssuer: signature.certIssuer,
					certSerial: signature.certSerial,
					certFingerprint: signature.certFingerprint,
					certNotBefore: signature.certNotBefore,
					certNotAfter: signature.certNotAfter,
					qualification: QUALIFICATION_LABELS[signature.qualification as Qualification] ?? signature.qualification,
					notes: signature.notes
				}
			: null,
		trail,
		verifyUrl: invoice.verifyToken && settings.verifyEnabled ? `${verifyBase(settings, url.origin)}${verifyPath(invoice.verifyToken)}` : null
	};
};

export const actions: Actions = {
	paid: async ({ params, request, locals }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.bezahlt')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const on = String((await request.formData()).get('am') ?? '');
		if (!isValidIsoDate(on)) return fail(400, { message: 'Bitte das Datum der Zahlung eintragen.' });
		if (on > today()) return fail(400, { message: 'Das Zahlungsdatum liegt in der Zukunft.' });
		await setInvoicePaid(invoice.id, on, user.id);
		await audit({ invoiceId: invoice.id, invoiceNumber: invoice.number, user, action: 'bezahlt', detail: { am: on } });
		if (invoice.status !== 'bezahlt') notifyInvoice('rechnung.bezahlt', invoice.id, user.id);
		return { paid: true };
	},

	open: async ({ params, locals }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.bezahlt')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		await setInvoiceOpen(invoice.id);
		await audit({ invoiceId: invoice.id, invoiceNumber: invoice.number, user, action: 'offen' });
		return { reopened: true };
	},

	/** Endgültig ausstellen: archivieren und – wenn eingeschaltet – signieren */
	issue: async ({ params, locals, url }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.ausstellen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const result = await issueInvoice(user, invoice.id, url.origin);
		if (!result.ok) return fail(400, { message: result.message });
		return { issued: result.stage, warning: result.warning ?? null };
	},

	/** Signierung erneut versuchen (nach einem Fehler oder wenn die Signatur später eingeschaltet wurde) */
	sign: async ({ params, locals }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.ausstellen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const result = await signIssued(user, invoice.id);
		if (!result.ok) return fail(400, { message: result.message });
		return { issued: result.stage, warning: result.warning ?? null };
	},

	/** Archiv, Datenbank und Signatur jetzt prüfen */
	verify: async ({ params, locals }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		const check = await verifyInvoice(invoice.id, { user });
		if (!check) return fail(404, { message: 'Rechnung nicht gefunden' });
		return { verified: check.result, problems: check.problems };
	},

	cancel: async ({ params, request, locals, url }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.stornieren')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		const reason = String((await request.formData()).get('grund') ?? '');
		const result = await cancelInvoice(user, invoice.id, reason, url.origin);
		if (!result.ok) return fail(400, { message: result.message });
		redirect(303, `/rechnungen/${result.stornoId}`);
	},

	delete: async ({ params, locals }) => {
		const { user, invoice } = await open(Number(params.id), locals);
		if (!can(user.role, 'rechnungen.loeschen')) return fail(403, { message: 'Dafür fehlt dir die Berechtigung.' });
		if (!(await deleteInvoice(invoice.id))) return fail(400, { message: 'Nur offene Entwürfe lassen sich löschen – ausgestellte Rechnungen werden storniert.' });
		await audit({ invoiceId: invoice.id, invoiceNumber: invoice.number, user, action: 'geloescht' });
		redirect(303, invoice.orderId && can(user.role, 'auftraege.sehen') ? `/auftraege/${invoice.orderId}` : '/rechnungen');
	}
};
