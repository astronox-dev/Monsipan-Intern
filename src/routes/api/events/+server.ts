import { eventStream } from '$lib/server/events';
import type { RequestHandler } from './$types';

/** ?tab=…: die Kennung des Browser-Tabs – geht er zu, meldet ihn die Anwesenheit ab */
export const GET: RequestHandler = ({ request, url }) =>
	new Response(eventStream(request.signal, (url.searchParams.get('tab') ?? '').slice(0, 64)), {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
