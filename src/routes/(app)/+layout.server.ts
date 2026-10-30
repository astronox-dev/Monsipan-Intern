import { lowStockCount } from '$lib/modules/lager/server/alerts';
import { openInquiryCount } from '$lib/modules/auftraege/server/inquiries';
import { reportsToCheck } from '$lib/modules/tagesberichte/server/reports';
import { unreadSummary } from '$lib/server/notifications';
import { requireUser } from '$lib/server/guard';
import { can, permissionMatrix } from '$lib/permissions';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('app:stock');
	depends('app:permissions');
	depends('app:notifications');
	depends('app:badges');
	const user = requireUser(locals);
	const [lowStock, anfragen, tagesberichte] = await Promise.all([
		can(user.role, 'lager.warnungen.sehen') || can(user.role, 'lager.berichte.sehen') ? lowStockCount() : 0,
		can(user.role, 'anfragen.sehen') ? openInquiryCount() : 0,
		can(user.role, 'tagesberichte.pruefen') ? reportsToCheck(user) : 0
	]);
	return {
		user,
		theme: locals.theme,
		// Die vom Admin gepflegte Rechte-Matrix, damit `can()` im Browser dasselbe sagt
		permissions: permissionMatrix(),
		// Zahlen im Menü: nachbestellen, offene Anfragen, freigegebene Tagesberichte zum Prüfen
		badges: { lowStock, anfragen, tagesberichte },
		// Für die Glocke: ungelesene Benachrichtigungen
		notifications: await unreadSummary(user.id)
	};
};
