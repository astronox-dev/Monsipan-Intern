import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Das 3M-Verlegeprotokoll steht jetzt im Arbeitsauftrag – alte Links führen dorthin */
export const load: PageServerLoad = ({ params }) => redirect(308, `/auftraege/${params.id}/arbeitsauftrag#folie`);
