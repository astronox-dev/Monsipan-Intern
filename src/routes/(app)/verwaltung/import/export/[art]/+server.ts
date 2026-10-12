import { error } from '@sveltejs/kit';
import { can } from '$lib/permissions';
import { requirePermission } from '$lib/server/guard';
import { tableResponse, writeTable } from '$lib/server/table';
import { exportHeader, exportTable } from '$lib/modules/auftraege/server/transfer';
import { TRANSFER, TRANSFER_KINDS, type TransferKind } from '$lib/modules/auftraege/transfer';
import type { RequestHandler } from './$types';

/**
 * Export als Excel oder CSV (?format=csv) – mit ?vorlage nur die
 * Spaltenüberschriften, als Vorlage für den Import.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	const user = requirePermission(locals, 'daten.export');
	const kind = params.art as TransferKind;
	if (!TRANSFER_KINDS.includes(kind)) error(404, 'Unbekannte Auswahl');
	const template = url.searchParams.has('vorlage');
	// Die Vorlage verrät nichts – die Daten nur, wer den Bereich ganz sieht
	if (!template && !can(user.role, TRANSFER[kind].permission)) error(403, 'Dafür fehlt dir die Berechtigung.');
	const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
	const table = template ? { ...exportHeader(kind), rows: [] } : await exportTable(kind);
	const day = new Date().toISOString().slice(0, 10);
	const body = await writeTable(format, TRANSFER[kind].label, table.header, table.rows, table.widths);
	return tableResponse(format, template ? `vorlage-${kind}` : `${kind}-${day}`, body);
};
