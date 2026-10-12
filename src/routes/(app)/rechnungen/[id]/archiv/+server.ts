import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invoiceFiles } from '$lib/server/db/schema';
import { bufferResponse } from '$lib/server/pdf';
import { requirePermission } from '$lib/server/guard';
import { invoiceDetail } from '$lib/modules/auftraege/server/invoices';
import { invoicePdfName } from '$lib/modules/auftraege/server/pdf';
import { audit } from '$lib/modules/auftraege/server/signatur/audit';
import { readArchiveFile, sha256Hex } from '$lib/modules/auftraege/server/signatur/archive';
import type { RequestHandler } from './$types';

/** Archivierte Fassung herunterladen (?datei=signiert oder original) – kommt ins Protokoll */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	const user = requirePermission(locals, 'rechnungen.sehen');
	const invoice = await invoiceDetail(Number(params.id));
	if (!invoice) error(404, 'Rechnung nicht gefunden');
	const kind = url.searchParams.get('datei') === 'original' ? 'original' : 'signiert';
	const file = await db
		.select()
		.from(invoiceFiles)
		.where(and(eq(invoiceFiles.invoiceId, invoice.id), eq(invoiceFiles.kind, kind)))
		.get();
	if (!file) error(404, kind === 'signiert' ? 'Zu dieser Rechnung gibt es keine signierte Fassung.' : 'Zu dieser Rechnung ist nichts archiviert.');
	const data = readArchiveFile(file.fileName);
	if (!data) error(500, 'Die Archivdatei fehlt.');
	if (sha256Hex(data) !== file.sha256) error(500, 'Die Archivdatei stimmt nicht mehr mit ihrer Prüfsumme überein.');
	await audit({ invoiceId: invoice.id, invoiceNumber: invoice.number, user, action: 'heruntergeladen', detail: { datei: kind, sha256: file.sha256 } });
	return bufferResponse(invoicePdfName(invoice).replace(/\.pdf$/, `-${kind}.pdf`), data);
};
