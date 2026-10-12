import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invoiceFiles } from '$lib/server/db/schema';
import { bufferResponse } from '$lib/server/pdf';
import { requirePermission } from '$lib/server/guard';
import { invoiceDetail } from '$lib/modules/auftraege/server/invoices';
import { invoicePdf, invoicePdfName } from '$lib/modules/auftraege/server/pdf';
import { readArchiveFile, sha256Hex } from '$lib/modules/auftraege/server/signatur/archive';
import type { RequestHandler } from './$types';

/**
 * Entwürfe werden jedes Mal neu erzeugt (mit „ENTWURF"). Ausgestellte kommen
 * nur noch aus dem Archiv – die signierte Fassung, sonst das Original –, damit
 * immer genau das Dokument herausgeht, das ausgestellt wurde.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	requirePermission(locals, 'rechnungen.sehen');
	const invoice = await invoiceDetail(Number(params.id));
	if (!invoice) error(404, 'Rechnung nicht gefunden');
	if (invoice.stage === 'entwurf') return invoicePdf(invoice);
	const files = await db.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, invoice.id)).all();
	const file = files.find((f) => f.kind === 'signiert') ?? files.find((f) => f.kind === 'original');
	const data = file ? readArchiveFile(file.fileName) : null;
	if (!file || !data) error(500, 'Die archivierte Rechnung fehlt – bitte die Prüfung in den Rechnungsdetails ansehen.');
	if (sha256Hex(data) !== file.sha256) error(500, 'Die archivierte Rechnung stimmt nicht mehr mit ihrer Prüfsumme überein.');
	return bufferResponse(invoicePdfName(invoice).replace(/\.pdf$/, file.kind === 'signiert' ? '-signiert.pdf' : '.pdf'), data);
};
