/**
 * Abrufe für Zeitstempel, OCSP, Sperrlisten und Zertifikate: mit Zeitlimit
 * und Größengrenze, nur http(s). In Tests lässt sich der Abruf austauschen.
 */

export interface FetchOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: Buffer | string;
	/** Millisekunden, Standard 15 s */
	timeout?: number;
	/** Höchstgröße der Antwort in Bytes, Standard 10 MB */
	maxBytes?: number;
}

export type BinaryFetcher = (url: string, opts?: FetchOptions) => Promise<Buffer>;

async function defaultFetch(url: string, opts: FetchOptions = {}): Promise<Buffer> {
	if (!/^https?:\/\//i.test(url)) throw new Error(`Adresse nicht erlaubt: ${url}`);
	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers: opts.headers,
		body: opts.body == null ? undefined : typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body),
		signal: AbortSignal.timeout(opts.timeout ?? 15_000),
		redirect: 'follow'
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} von ${new URL(url).host}`);
	const max = opts.maxBytes ?? 10 * 1024 * 1024;
	const length = Number(res.headers.get('content-length') ?? 0);
	if (length > max) throw new Error(`Antwort zu groß (${length} Bytes)`);
	const body = Buffer.from(await res.arrayBuffer());
	if (body.length > max) throw new Error(`Antwort zu groß (${body.length} Bytes)`);
	return body;
}

let current: BinaryFetcher = defaultFetch;

export const fetchBinary: BinaryFetcher = (url, opts) => current(url, opts);

/** Nur für Tests: Abrufe umleiten; ohne Argument wieder ins Netz */
export function setFetcher(fetcher?: BinaryFetcher) {
	current = fetcher ?? defaultFetch;
}
