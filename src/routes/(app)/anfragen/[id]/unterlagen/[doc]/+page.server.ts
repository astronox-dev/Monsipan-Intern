import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/guard';
import { inquiryDetail } from '$lib/modules/auftraege/server/inquiries';
import { chainOfInquiry, findCaseDocument, parseRef, SOURCE_LABELS } from '$lib/modules/auftraege/server/case-files';
import type { PageServerLoad } from './$types';

/** PDF des Vorgangs – an der Anfrage, auch vom Angebot oder Auftrag; wer Anfragen sieht */
export const load: PageServerLoad = async ({ params, locals }) => {
	requirePermission(locals, 'anfragen.sehen');
	const inquiry = await inquiryDetail(Number(params.id));
	if (!inquiry) error(404, 'Anfrage nicht gefunden');
	const document = await findCaseDocument(await chainOfInquiry(inquiry.id), parseRef(params.doc, 'anfrage'));
	if (!document) error(404, 'Unterlage nicht gefunden');
	return {
		inquiry: { id: inquiry.id, subject: inquiry.subject },
		document: { key: params.doc, title: document.title, fileName: document.fileName, size: document.size },
		note: [document.source !== 'anfrage' ? SOURCE_LABELS[document.source] : '', document.forCrew ? 'auch für die Partie' : 'nur Büro'].filter(Boolean).join(' · ')
	};
};
