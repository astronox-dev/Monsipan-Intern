import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { compressJpeg, compressPdf, compressPdfBuffer, hasTool } from './compress';
import { jpegSize } from '$lib/modules/tagesberichte/photos';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verkleinern-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Die Werkzeuge gibt es im Docker-Image und in der CI – lokal unter Windows meist nicht
const qpdf = await hasTool('qpdf');
const jpegtran = await hasTool('jpegtran');

/** PDF mit unkomprimierten Inhalten – wie es manche Programme schreiben */
function loosePdf(): Promise<Buffer> {
	return new Promise((resolve) => {
		const doc = new PDFDocument({ compress: false, size: 'A4' });
		const parts: Buffer[] = [];
		doc.on('data', (d: Buffer) => parts.push(d));
		doc.on('end', () => resolve(Buffer.concat(parts)));
		for (let page = 0; page < 3; page++) {
			if (page) doc.addPage();
			for (let i = 0; i < 40; i++) doc.text(`Zeile ${i} – Bodenmarkierung Leitlinie 15 cm weiß, RAL 9016, MSK D reflektierend`);
			for (let i = 0; i < 60; i++) doc.moveTo(50, 400 + i * 5).lineTo(550, 400 + i * 5).stroke();
		}
		doc.end();
	});
}

/** Ein Bild als PPM – Verlauf mit etwas Rauschen, wie ein Foto */
function ppm(width: number, height: number): Buffer {
	const head = Buffer.from(`P6\n${width} ${height}\n255\n`);
	const px = Buffer.alloc(width * height * 3);
	let seed = 7;
	for (let i = 0; i < width * height; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		const x = i % width;
		const y = Math.floor(i / width);
		px[i * 3] = (x * 255) / width;
		px[i * 3 + 1] = (y * 255) / height;
		px[i * 3 + 2] = 128 + ((seed >> 16) % 40);
	}
	return Buffer.concat([head, px]);
}

describe.runIf(!!process.env.CI)('In der CI', () => {
	it('sind die Werkzeuge da – sonst würden die Tests darunter nur übersprungen', () => {
		expect({ qpdf, jpegtran }).toEqual({ qpdf: true, jpegtran: true });
	});
});

describe('Ohne Werkzeuge bleibt alles, wie es ist', () => {
	it('kein lesbares JPEG – das Original zurück', async () => {
		const junk = Buffer.from('kein Bild');
		expect(await compressJpeg(junk)).toBe(junk);
	});

	it('signierte und Archiv-PDFs (PDF/A) werden nie angefasst', async () => {
		const signed = path.join(TMP, 'signiert.pdf');
		fs.writeFileSync(signed, Buffer.concat([await loosePdf(), Buffer.from('\n%/ByteRange [0 100 200 300]\n')]));
		expect(await compressPdf(signed)).toBeNull();
		const archive = path.join(TMP, 'archiv.pdf');
		fs.writeFileSync(archive, Buffer.concat([await loosePdf(), Buffer.from('\n%<pdfaid:part>1</pdfaid:part>\n')]));
		expect(await compressPdf(archive)).toBeNull();
	});
});

describe.runIf(qpdf)('PDF mit qpdf', () => {
	it('wird kleiner und bleibt ein gültiges PDF mit gleichen Seiten', async () => {
		const file = path.join(TMP, 'lose.pdf');
		const original = await loosePdf();
		fs.writeFileSync(file, original);
		const smaller = await compressPdf(file);
		expect(smaller).not.toBeNull();
		const out = fs.readFileSync(smaller!);
		expect(out.length).toBeLessThan(original.length * 0.6);
		// Struktur in Ordnung, gleiche Seitenzahl
		execFileSync('qpdf', ['--check', smaller!]);
		expect(execFileSync('qpdf', ['--show-npages', smaller!]).toString().trim()).toBe('3');
		console.info(`PDF: ${original.length} → ${out.length} Bytes`);
	});

	it('im Speicher – ein schon dichtes PDF bleibt, wie es ist', async () => {
		const dense = fs.readFileSync(path.join(TMP, 'lose.pdf.klein.tmp'));
		expect(await compressPdfBuffer(dense, TMP)).toBe(dense);
		expect(fs.readdirSync(TMP).filter((f) => f.startsWith('pdf-'))).toEqual([]);
	});
});

describe.runIf(jpegtran)('JPEG mit jpegtran', () => {
	it('wird kleiner – jedes Pixel bleibt gleich', async () => {
		const src = path.join(TMP, 'bild.ppm');
		fs.writeFileSync(src, ppm(800, 600));
		// So wie ein Browser speichert: Grundlinie, Standard-Tabellen
		const original = execFileSync('cjpeg', ['-quality', '85', src]);
		const out = await compressJpeg(original);
		expect(out.length).toBeLessThan(original.length);
		expect(jpegSize(out)).toEqual({ width: 800, height: 600 });
		const pixels = (jpeg: Buffer) => {
			const file = path.join(TMP, `p-${jpeg.length}.jpg`);
			fs.writeFileSync(file, jpeg);
			return execFileSync('djpeg', ['-ppm', file]);
		};
		expect(pixels(out).equals(pixels(original))).toBe(true);
		console.info(`JPEG: ${original.length} → ${out.length} Bytes`);
	});
});
