import { error, fail, redirect } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission, requireUser } from '$lib/server/guard';
import { checkDateRange, createReport, listReports, nextNumber, recentPlaces } from '$lib/modules/tagesberichte/server/reports';
import { linkableOrders } from '$lib/modules/auftraege/server/orders';
import { today } from '$lib/modules/stunden/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requirePermission(locals, 'tagesberichte.sehen');
	const filter = {
		q: url.searchParams.get('q') ?? '',
		from: url.searchParams.get('von') ?? '',
		to: url.searchParams.get('bis') ?? '',
		status: url.searchParams.get('stand') ?? ''
	};
	const canCreate = can(user.role, 'tagesberichte.erstellen');
	const [reports, places, number, orders] = await Promise.all([
		// Geprüfte stehen nicht mehr in der Liste – man findet sie über den Auftrag (oder den Stand oben)
		listReports(user, { ...filter, pendingOnly: true }),
		recentPlaces(),
		nextNumber(),
		canCreate ? linkableOrders(user) : Promise.resolve([])
	]);
	// Vom Auftrag aus: „Neuer Tagesbericht" öffnet den Dialog mit diesem Auftrag
	const preselect = Number(url.searchParams.get('auftrag'));
	return {
		reports,
		filter,
		places,
		orders,
		suggestion: { number, date: today(), orderId: orders.some((o) => o.id === preselect) ? preselect : null },
		canCreate
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!can(user.role, 'tagesberichte.erstellen')) error(403, 'Dafür fehlt dir die Berechtigung.');
		const form = await request.formData();
		const date = String(form.get('datum') ?? '');
		const range = checkDateRange(date, String(form.get('datum_bis') ?? ''));
		if ('message' in range) return fail(400, { message: range.message });
		// Nur ein Auftrag, den dieser Benutzer auch sieht
		const wanted = Number(form.get('auftrag'));
		const order = wanted ? (await linkableOrders(user)).find((o) => o.id === wanted) : undefined;
		if (wanted && !order) return fail(400, { message: 'Diesen Auftrag gibt es nicht (mehr) – bitte neu wählen.' });
		const site = String(form.get('baustelle') ?? '').trim();
		const id = await createReport(user, {
			date,
			dateTo: range.dateTo,
			number: String(form.get('nummer') ?? ''),
			road: String(form.get('strasse') ?? ''),
			// Ohne eigene Angabe gilt der Ausführungsort des Auftrags als Baustelle
			site: site || order?.location || order?.title || '',
			orderId: order?.id ?? null
		});
		redirect(303, `/tagesberichte/${id}`);
	}
};
