import { requirePermission } from '$lib/server/guard';
import { tableResponse, writeTable } from '$lib/server/table';
import { costCenterHours, readCostCenterFilter } from '$lib/modules/stunden/server/kostenstellen';
import type { RequestHandler } from './$types';

/** Die Tabelle der Kostenstellen als Excel- oder CSV-Datei – mit demselben Filter wie die Seite */
export const GET: RequestHandler = async ({ url, locals }) => {
	requirePermission(locals, 'stunden.alle.sehen');
	const { from, to, scope } = readCostCenterFilter(url.searchParams);
	const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
	const rows = await costCenterHours(from, to, scope);
	const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
	const header = ['Kostenstelle', 'Stunden gesamt', 'Norm', 'Überstunden 50 %', 'Überstunden 100 %', 'Tage', 'Personen', 'Erster Tag', 'Letzter Tag', 'Partien'];
	const body = rows.map((r) => [
		r.key ? r.label : 'ohne Kostenstelle',
		r.total,
		r.normal,
		r.o50,
		r.o100,
		r.days,
		r.people,
		date(r.first),
		date(r.last),
		r.parties.map((p) => `${p.name || 'ohne Partie'}: ${String(p.hours).replace('.', ',')}`).join('; ')
	]);
	const file = await writeTable(format, 'Kostenstellen', header, body, [22, 14, 10, 14, 14, 8, 10, 12, 12, 50]);
	return tableResponse(format, `kostenstellen-${from}-bis-${to}`, file);
};
