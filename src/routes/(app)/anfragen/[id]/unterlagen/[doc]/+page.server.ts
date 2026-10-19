import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { inquiryDetail } from '$lib/modules/auftraege/server/inquiries';
import { getInquiryDocument } from '$lib/modules/auftraege/server/attachments';
import type { PageServerLoad } from './$types';

/** PDF an der Anfrage – wer Anfragen sieht */
export const load: PageServerLoad = async ({ params, locals }) => {
	requirePermission(locals, 'anfragen.sehen');
	const inquiry = await inquiryDetail(Number(params.id));
	if (!inquiry) error(404, 'Anfrage nicht gefunden');
	const document = await getInquiryDocument(inquiry.id, Number(params.doc));
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		inquiry: { id: inquiry.id, subject: inquiry.subject },
		document: { id: document.id, title: document.title, fileName: document.fileName, size: document.size }
	};
};
