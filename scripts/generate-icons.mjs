// Erzeugt favicon.svg und die App-Icons (PNG) ohne Zusatzpakete: node scripts/generate-icons.mjs
// Schreibt die Icons für die Webseite (PWA) und, falls vorhanden, für die Android-App.
//
// Das Zeichen passt zum Schriftzug: ein kräftiges, kursives „M" auf dunkler Kachel,
// darunter der schräge gelbe Streifen wie beim „PORTAL". Das „M" ist der Umriss aus
// Barlow Semi Condensed ExtraBold Italic – als Pfad, damit kein Browser die Schrift braucht.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ASPHALT = [0x1b, 0x20, 0x27];
const WHITE = [0xf4, 0xf5, 0xf6];
const YELLOW = [0xf8, 0xf0, 0x00];
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** „M" in Schrifteinheiten (1000 je Geviert, y nach oben), aus der Schriftdatei übernommen */
const M_GLYPH =
	'M482 692Q486 700 496 700L633 700Q638 700 641 696.5Q644 693 643 688L560 12Q559 7 555.5 3.5Q552 0 547 0L409 0Q404 0 401 3.5Q398 7 399 12L450 427Q451 431 449 431.5Q447 432 445 429L353 299Q348 291 338 291L311 291Q302 291 299 299L239 429Q237 432 235 431.5Q233 431 233 427L182 12Q181 7 177.5 3.5Q174 0 169 0L31 0Q26 0 23 3.5Q20 7 21 12L104 688Q105 693 108.5 696.5Q112 700 117 700L254 700Q263 700 266 692L349 510Q351 504 355 510L482 692Z';

// Lage im 32er-Raster: „M" 17 hoch, Grundlinie bei 21, waagrecht in der Mitte;
// der Streifen darunter, um 12° geneigt wie die Schrift
const M_SCALE = 17 / 700;
const M_X = 16 - ((20.75 + 643.25) / 2) * M_SCALE;
const M_BASE = 21;
const STRIP = [
	[8.1, 23.6],
	[25.3, 23.6],
	[24.5, 27.4],
	[7.3, 27.4]
];

/* ------------------------------------------------------------ Umrisse */

/** SVG-Pfad (nur M, L, Q, Z – wie aus der Schrift) in Polygone, Kurven in kleinen Stücken */
function polygons(d, map) {
	const out = [];
	let poly = [];
	let cur = [0, 0];
	const tokens = d.match(/[MLQZ]|-?\d*\.?\d+/g);
	let i = 0;
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === 'M') {
			if (poly.length) out.push(poly);
			cur = [num(), num()];
			poly = [map(cur)];
		} else if (cmd === 'L') {
			cur = [num(), num()];
			poly.push(map(cur));
		} else if (cmd === 'Q') {
			const c = [num(), num()];
			const to = [num(), num()];
			for (let t = 1; t <= 8; t++) {
				const s = t / 8;
				const a = (1 - s) ** 2;
				const b = 2 * (1 - s) * s;
				const e = s ** 2;
				poly.push(map([a * cur[0] + b * c[0] + e * to[0], a * cur[1] + b * c[1] + e * to[1]]));
			}
			cur = to;
		} else if (cmd === 'Z') {
			if (poly.length) out.push(poly);
			poly = [];
		}
	}
	if (poly.length) out.push(poly);
	return out;
}

const M_SHAPE = polygons(M_GLYPH, ([x, y]) => [M_X + x * M_SCALE, M_BASE - y * M_SCALE]);
const STRIP_SHAPE = [STRIP];

/** Nicht-null-Regel wie in SVG: Punkt innerhalb der Polygone? */
function inside(shapes, px, py) {
	let winding = 0;
	for (const poly of shapes) {
		for (let k = 0; k < poly.length; k++) {
			const [x1, y1] = poly[k];
			const [x2, y2] = poly[(k + 1) % poly.length];
			if (y1 <= py) {
				if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding++;
			} else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) winding--;
		}
	}
	return winding !== 0;
}

/** Punkt in abgerundetem Rechteck? (Koordinaten im 32er-Raster) */
function inRoundRect(px, py, x, y, w, h, r) {
	if (px < x || py < y || px > x + w || py > y + h) return false;
	const cx = Math.max(x + r, Math.min(px, x + w - r));
	const cy = Math.max(y + r, Math.min(py, y + h - r));
	return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/* ------------------------------------------------------------ PNG */

function crc32(buf) {
	let c = ~0;
	for (const b of buf) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0;
		for (let x = 0; x < size; x++) {
			const [r, g, b, a] = pixel(x, y);
			const o = y * (size * 4 + 1) + 1 + x * 4;
			raw[o] = r;
			raw[o + 1] = g;
			raw[o + 2] = b;
			raw[o + 3] = a;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/**
 * Das Zeichen als PNG.
 * shape: 'rounded' (Kachel wie favicon.svg), 'circle', 'full' (randlos), 'none' (nur Zeichen, freigestellt)
 * scale: rückt „M" und Streifen zur Mitte – für Masken, die den Rand abschneiden
 */
function icon(size, { shape = 'rounded', scale = 1 } = {}) {
	const SS = 4;
	return png(size, (x, y) => {
		let bg = 0;
		let white = 0;
		let yellow = 0;
		for (let sy = 0; sy < SS; sy++)
			for (let sx = 0; sx < SS; sx++) {
				const px = ((x + (sx + 0.5) / SS) / size) * 32;
				const py = ((y + (sy + 0.5) / SS) / size) * 32;
				const tile =
					shape === 'full' ||
					shape === 'none' ||
					(shape === 'rounded' && inRoundRect(px, py, 0, 0, 32, 32, 6)) ||
					(shape === 'circle' && inRoundRect(px, py, 0, 0, 32, 32, 16));
				if (!tile) continue;
				if (shape !== 'none') bg++;
				const qx = 16 + (px - 16) / scale;
				const qy = 16 + (py - 16) / scale;
				if (qy > 23 && inside(STRIP_SHAPE, qx, qy)) yellow++;
				else if (qy < 21.5 && inside(M_SHAPE, qx, qy)) white++;
			}
		const n = SS * SS;
		const marks = white + yellow;
		if (shape === 'none') {
			if (!marks) return [0, 0, 0, 0];
			const color = WHITE.map((c, i) => Math.round((c * white + YELLOW[i] * yellow) / marks));
			return [...color, Math.round((marks / n) * 255)];
		}
		if (!bg) return [0, 0, 0, 0];
		const color = ASPHALT.map((c, i) => Math.round((c * (bg - marks) + WHITE[i] * white + YELLOW[i] * yellow) / bg));
		return [...color, Math.round((bg / n) * 255)];
	});
}

/* ------------------------------------------------------------ Webseite */

const round = (v) => Math.round(v * 1e4) / 1e4;
fs.writeFileSync(
	path.resolve('static/favicon.svg'),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${hex(ASPHALT)}"/>` +
		`<path fill="${hex(WHITE)}" transform="translate(${round(M_X)} ${M_BASE}) scale(${round(M_SCALE)} ${round(-M_SCALE)})" d="${M_GLYPH}"/>` +
		`<path fill="${hex(YELLOW)}" d="M${STRIP.map((p) => p.join(' ')).join('L')}Z"/></svg>\n`
);

const web = path.resolve('static/icons');
fs.mkdirSync(web, { recursive: true });
fs.writeFileSync(path.join(web, 'icon-192.png'), icon(192));
fs.writeFileSync(path.join(web, 'icon-512.png'), icon(512));
fs.writeFileSync(path.join(web, 'icon-maskable-512.png'), icon(512, { shape: 'full', scale: 0.8 }));
fs.writeFileSync(path.join(web, 'apple-touch-icon.png'), icon(180, { shape: 'full', scale: 0.9 }));
console.log('Icons für die Webseite:', web);

/* ------------------------------------------------------- Android-App */

const res = path.resolve('android/app/src/main/res');
if (!fs.existsSync(res)) process.exit(0);

// Launcher-Icons je Bildschirmdichte; das Vordergrund-Icon sitzt im 108dp-Raster
const DENSITIES = [
	['mdpi', 48, 108],
	['hdpi', 72, 162],
	['xhdpi', 96, 216],
	['xxhdpi', 144, 324],
	['xxxhdpi', 192, 432]
];

for (const [density, launcher, adaptive] of DENSITIES) {
	const dir = path.join(res, `mipmap-${density}`);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'ic_launcher.png'), icon(launcher));
	fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), icon(launcher, { shape: 'circle', scale: 0.8 }));
	// Nur das Zeichen, freigestellt: der Asphalt kommt als Farbe dazu. Sichtbar ist
	// nur die Mitte (72 von 108 dp), deshalb sitzt es kleiner in der Mitte.
	fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), icon(adaptive, { shape: 'none', scale: 0.6 }));
}

// Der Startbildschirm wird als Zeichnung beschrieben statt als Bild pro Format
for (const dir of fs.readdirSync(res)) {
	if (!dir.startsWith('drawable')) continue;
	const file = path.join(res, dir, 'splash.png');
	if (fs.existsSync(file)) fs.rmSync(file);
}
fs.writeFileSync(
	path.join(res, 'drawable', 'splash.xml'),
	`<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splashBackground" />
    <item
        android:drawable="@mipmap/ic_launcher_foreground"
        android:gravity="center"
        android:width="192dp"
        android:height="192dp" />
</layer-list>
`
);
console.log('Icons für die Android-App:', res);
