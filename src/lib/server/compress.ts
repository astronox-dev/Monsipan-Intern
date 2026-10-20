/**
 * Hochgeladene Dateien verlustfrei verkleinern, bevor sie abgelegt werden –
 * am Inhalt ändert sich nichts:
 *
 * - PDFs mit qpdf: Streams stärker komprimiert, Objekte in Objekt-Streams.
 *   Text, Vektoren und Bilder bleiben, wie sie sind.
 * - Fotos (JPEG) mit jpegtran: bessere Huffman-Tabellen, progressiv – jedes
 *   Pixel bleibt gleich.
 *
 * Die Werkzeuge stecken im Docker-Image. Fehlen sie (etwa beim Entwickeln unter
 * Windows), bleibt die Datei, wie sie ist. Genommen wird das Ergebnis nur, wenn
 * es wirklich kleiner ist. Nie angefasst werden digital signierte PDFs (die
 * Signatur hängt an den Bytes und wäre danach ungültig) und Archiv-PDFs (PDF/A –
 * die Norm schreibt den Aufbau der Datei vor).
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { jpegSize } from '$lib/modules/tagesberichte/photos';

/** Lohnt erst ab 2 % weniger – sonst bleibt das Original */
const MIN_GAIN = 0.98;
const PDF_TIMEOUT = 180_000;
const JPEG_TIMEOUT = 30_000;

const probes = new Map<string, Promise<boolean>>();

/** Ist das Werkzeug da? Einmal je Start nachgesehen */
export function hasTool(tool: 'qpdf' | 'jpegtran'): Promise<boolean> {
	let probe = probes.get(tool);
	if (!probe) {
		probe = new Promise((resolve) => {
			execFile(tool, [tool === 'qpdf' ? '--version' : '-version'], { timeout: 5_000 }, (err) => resolve(!err));
		});
		probes.set(tool, probe);
	}
	return probe;
}

/** Beim Start ins Log: ob verkleinert wird */
export async function reportTools() {
	const [pdf, jpeg] = await Promise.all([hasTool('qpdf'), hasTool('jpegtran')]);
	if (pdf && jpeg) console.info('[verkleinern] qpdf und jpegtran da – PDFs und Fotos werden verlustfrei verkleinert');
	else console.info(`[verkleinern] ${[!pdf && 'qpdf', !jpeg && 'jpegtran'].filter(Boolean).join(' und ')} fehlt – diese Dateien bleiben unverändert`);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/**
 * Signiert oder PDF/A? Dann bleibt die Datei Byte für Byte. Beides steht
 * unverpackt in der Datei: das Signaturfeld mit /ByteRange (der Signierer füllt
 * es nachträglich) und die Kennung „pdfaid" in den XMP-Metadaten (PDF/A
 * verlangt sie lesbar).
 */
async function mustStayAsIs(file: string): Promise<boolean> {
	const needles = [Buffer.from('/ByteRange'), Buffer.from('pdfaid:')];
	const keep = Math.max(...needles.map((n) => n.length));
	let tail = Buffer.alloc(0);
	for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
		const buf = Buffer.concat([tail, chunk as Buffer]);
		if (needles.some((n) => buf.includes(n))) return true;
		tail = buf.subarray(Math.max(0, buf.length - keep));
	}
	return false;
}

/**
 * PDF verlustfrei verkleinern. Gibt den Pfad der kleineren Fassung zurück
 * (neben der Datei, mit .tmp am Ende – aufräumen tut der Aufrufer) oder null,
 * wenn es nichts bringt oder nicht geht.
 */
export async function compressPdf(file: string): Promise<string | null> {
	if (!(await hasTool('qpdf')) || (await mustStayAsIs(file))) return null;
	const out = `${file}.klein.tmp`;
	const ok = await new Promise<boolean>((resolve) => {
		execFile('qpdf', ['--object-streams=generate', '--recompress-flate', '--compression-level=9', '--', file, out], { timeout: PDF_TIMEOUT }, (err) => {
			// 3 heißt: fertig, mit Warnungen (etwa kleine Fehler im Original, die qpdf repariert)
			resolve(!err || (err as { code?: unknown }).code === 3);
		});
	});
	try {
		const before = (await fs.promises.stat(file)).size;
		const after = ok ? (await fs.promises.stat(out)).size : Infinity;
		if (after < before * MIN_GAIN) {
			if (before > 1024 * 1024) console.info(`[verkleinern] PDF ${mb(before)} → ${mb(after)}`);
			return out;
		}
	} catch {
		/* keine Ausgabe – Original nehmen */
	}
	await fs.promises.rm(out, { force: true });
	return null;
}

/** PDF im Speicher verkleinern (über eine Datei neben `dir`) – sonst das Original */
export async function compressPdfBuffer(buf: Buffer, dir: string): Promise<Buffer> {
	if (!(await hasTool('qpdf'))) return buf;
	await fs.promises.mkdir(dir, { recursive: true });
	const temp = `${dir}/pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
	await fs.promises.writeFile(temp, buf);
	try {
		const smaller = await compressPdf(temp);
		if (!smaller) return buf;
		const out = await fs.promises.readFile(smaller);
		await fs.promises.rm(smaller, { force: true });
		return out;
	} finally {
		await fs.promises.rm(temp, { force: true });
	}
}

/** JPEG verlustfrei verkleinern – gleiche Pixel, gleiche Maße; sonst das Original */
export async function compressJpeg(buf: Buffer): Promise<Buffer> {
	if (!(await hasTool('jpegtran'))) return buf;
	const out = await new Promise<Buffer | null>((resolve) => {
		const child = spawn('jpegtran', ['-copy', 'all', '-optimize', '-progressive'], { timeout: JPEG_TIMEOUT });
		const parts: Buffer[] = [];
		child.stdout.on('data', (d: Buffer) => parts.push(d));
		child.on('error', () => resolve(null));
		child.on('close', (code) => resolve(code === 0 ? Buffer.concat(parts) : null));
		child.stdin.on('error', () => resolve(null));
		child.stdin.end(buf);
	});
	if (!out || out.length >= buf.length * MIN_GAIN) return buf;
	const a = jpegSize(buf);
	const b = jpegSize(out);
	return a && b && a.width === b.width && a.height === b.height ? out : buf;
}
