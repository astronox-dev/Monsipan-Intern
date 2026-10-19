/** Hochladen und Ausliefern der Fotos am Vorgang (Anfrage, Angebot, Auftrag) – für deren Routen */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error, json } from '@sveltejs/kit';
import { photoFile } from '$lib/modules/tagesberichte/server/photos';
import { PhotoError } from '$lib/modules/tagesberichte/photos';
import { addRecordPhoto, getCasePhoto, type CaseChain, type PhotoOwner } from './case-files';

/** Foto hinzufügen – das Gerät schickt es verkleinert, mit Vorschau */
export async function uploadPhoto(owner: PhotoOwner, userId: number, request: Request): Promise<Response> {
	const form = await request.formData().catch(() => null);
	const photo = form?.get('foto');
	const thumb = form?.get('vorschau');
	if (!(photo instanceof File)) error(400, 'Es kam kein Foto an.');
	try {
		return json(await addRecordPhoto(owner, userId, photo, thumb instanceof File ? thumb : photo), { status: 201 });
	} catch (err) {
		if (err instanceof PhotoError) error(400, err.message);
		throw err;
	}
}

/**
 * Ein Foto des Vorgangs bzw. mit ?vorschau seine kleine Fassung – unveränderlich,
 * darf lange im Zwischenspeicher bleiben. Mit ?download als Datei zum Speichern.
 */
export async function photoResponse(chain: CaseChain, photoId: number, url: URL, name: string): Promise<Response> {
	const photo = await getCasePhoto(chain, photoId);
	if (!photo) error(404, 'Foto nicht gefunden');
	const file = photoFile(url.searchParams.has('vorschau') ? photo.thumbSha256 : photo.sha256);
	const stat = await fs.promises.stat(file).catch(() => null);
	if (!stat) error(404, 'Die Bilddatei fehlt.');
	return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
		headers: {
			'content-type': 'image/jpeg',
			'content-length': String(stat.size),
			'content-disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${`${name}-foto-${photo.id}.jpg`.replace(/[^\w.-]/g, '_')}"`,
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
}
