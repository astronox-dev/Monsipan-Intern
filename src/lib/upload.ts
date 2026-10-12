/**
 * Pläne ohne Größengrenze hochladen: Der Browser schickt jede PDF in Teilen an
 * /api/unterlagen. Bricht die Verbindung ab (Baustelle, Funkloch), geht es dort
 * weiter, wo der Server zuletzt stand. Ins Formular kommen danach nur noch die
 * Kennungen der fertigen Uploads.
 */

/** Je Anfrage – weit unter der Grenze von Cloudflare (100 MB) */
const PART_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 6;

export class UploadError extends Error {}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newId(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function messageOf(res: Response): Promise<string> {
	try {
		const body = await res.json();
		if (body?.message) return String(body.message);
	} catch {
		/* keine JSON-Antwort */
	}
	return res.status === 401 ? 'Du bist nicht mehr angemeldet.' : `Der Server hat abgelehnt (${res.status}).`;
}

/** Eine PDF hochladen; gibt die Kennung des fertigen Uploads zurück */
export async function uploadPdf(file: File, onProgress?: (bytes: number) => void): Promise<string> {
	// Die Kennung „%PDF-“ steht in den ersten 1024 Bytes – nicht erst nach dem Hochladen merken
	if (!(await file.slice(0, 1024).text()).includes('%PDF-')) throw new UploadError(`${file.name}: Das ist keine PDF-Datei.`);
	const id = newId();
	let offset = 0;
	let retries = 0;
	while (offset < file.size) {
		let res: Response | null = null;
		try {
			res = await fetch(`/api/unterlagen?id=${id}&ab=${offset}`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: file.slice(offset, offset + PART_BYTES)
			});
		} catch {
			/* Netz weg – gleich noch einmal */
		}
		if (res && !res.ok && res.status !== 409) throw new UploadError(`${file.name}: ${await messageOf(res)}`);
		if (!res || res.status === 409) {
			if (++retries > MAX_RETRIES) throw new UploadError(`${file.name}: Die Verbindung ist abgebrochen – bitte noch einmal versuchen.`);
			await wait(1000 * retries);
		} else {
			retries = 0;
		}
		if (res) {
			const { received } = await res.json();
			if (!Number.isSafeInteger(received) || received > file.size) throw new UploadError(`${file.name}: Die Übertragung ist durcheinandergeraten.`);
			offset = received;
			onProgress?.(offset);
		}
	}
	const done = await fetch(`/api/unterlagen?id=${id}&fertig&name=${encodeURIComponent(file.name)}`, { method: 'POST' });
	if (!done.ok) throw new UploadError(`${file.name}: ${await messageOf(done)}`);
	return id;
}

/**
 * Die PDFs aus einem Feld des Formulars vorab hochladen und dort durch ihre
 * Kennungen (Feld `uploads`) ersetzen – für `use:enhance`. `onProgress` bekommt
 * den Anteil von 0 bis 1 über alle Dateien.
 */
export async function uploadFormPdfs(formData: FormData, field: string, onProgress?: (share: number) => void): Promise<void> {
	const files = formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
	formData.delete(field);
	const total = files.reduce((sum, f) => sum + f.size, 0);
	let done = 0;
	for (const file of files) {
		const id = await uploadPdf(file, (bytes) => onProgress?.((done + bytes) / total));
		done += file.size;
		formData.append('uploads', id);
	}
}
