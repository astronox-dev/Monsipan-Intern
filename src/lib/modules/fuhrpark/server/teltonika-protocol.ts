/**
 * Das Protokoll der Teltonika-Tracker (FMC920 und Verwandte) – reines Rechnen,
 * ohne Netz und Datenbank.
 *
 * Der Tracker öffnet eine TCP-Verbindung und schickt zuerst seine IMEI (2 Byte
 * Länge, dann die Ziffern). Wir antworten mit 0x01 (bekannt) oder 0x00. Danach
 * kommen Datenpakete: 4 Byte Null, 4 Byte Länge, Codec, Anzahl, die Datensätze,
 * noch einmal die Anzahl, 4 Byte Prüfsumme (CRC-16/IBM). Quittiert wird mit der
 * Anzahl als 4 Byte – erst dann löscht der Tracker die Daten aus seinem Speicher.
 *
 * Unterstützt sind Codec 8 und Codec 8 Extended, die beiden, die der Tracker für
 * Standorte verwendet.
 */
import type { PositionInput } from './vehicles';

const CODEC_8 = 0x08;
const CODEC_8E = 0x8e;
/** Größer schickt ein Tracker kein Paket – alles darüber ist kein Tracker */
export const MAX_FRAME = 64 * 1024;

export class TeltonikaError extends Error {}

export interface AvlRecord {
	at: number;
	lat: number;
	lon: number;
	altitude: number;
	/** Fahrtrichtung in Grad */
	angle: number;
	satellites: number;
	speedKmh: number;
	/** Messwerte nach ihrer Nummer im Handbuch */
	io: Map<number, number>;
}

/** Die Messwerte, die wir brauchen */
const IO_ODOMETER = 16;
const IO_VOLTAGE = 66;
const IO_HDOP = 182;
const IO_IGNITION = 239;

/** CRC-16/IBM: Polynom 0xA001, Start 0 */
export function crc16(data: Uint8Array): number {
	let crc = 0;
	for (const byte of data) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
	}
	return crc;
}

/** Die Anmeldung – null, solange sie nicht ganz angekommen ist */
export function readImei(buf: Buffer): { imei: string; used: number } | null {
	if (buf.length < 2) return null;
	const length = buf.readUInt16BE(0);
	if (length < 8 || length > 17) throw new TeltonikaError('Länge der IMEI stimmt nicht');
	if (buf.length < 2 + length) return null;
	const imei = buf.toString('ascii', 2, 2 + length);
	if (!/^\d+$/.test(imei)) throw new TeltonikaError('IMEI enthält andere Zeichen als Ziffern');
	return { imei, used: 2 + length };
}

/** Liest der Reihe nach aus dem Paket; läuft es über das Ende hinaus, stimmt das Paket nicht */
class Reader {
	offset = 0;
	constructor(private buf: Buffer) {}
	private take(n: number) {
		if (this.offset + n > this.buf.length) throw new TeltonikaError('Datensatz länger als das Paket');
		const at = this.offset;
		this.offset += n;
		return at;
	}
	u8 = () => this.buf.readUInt8(this.take(1));
	u16 = () => this.buf.readUInt16BE(this.take(2));
	u32 = () => this.buf.readUInt32BE(this.take(4));
	i32 = () => this.buf.readInt32BE(this.take(4));
	i16 = () => this.buf.readInt16BE(this.take(2));
	u64 = () => Number(this.buf.readBigUInt64BE(this.take(8)));
	skip = (n: number) => void this.take(n);
}

function readRecord(r: Reader, extended: boolean): AvlRecord {
	const small = extended ? r.u16 : r.u8;
	const at = r.u64();
	r.u8(); // Priorität
	const lon = r.i32() / 1e7;
	const lat = r.i32() / 1e7;
	const altitude = r.i16();
	const angle = r.u16();
	const satellites = r.u8();
	const speedKmh = r.u16();
	small(); // auslösendes Ereignis
	small(); // Anzahl aller Messwerte
	const io = new Map<number, number>();
	const group = (read: () => number) => {
		const count = small();
		for (let i = 0; i < count; i++) {
			const id = small();
			io.set(id, read());
		}
	};
	group(r.u8);
	group(r.u16);
	group(r.u32);
	group(r.u64);
	if (extended) {
		// Werte mit eigener Länge: brauchen wir nicht, nur überspringen
		const count = r.u16();
		for (let i = 0; i < count; i++) {
			r.u16();
			r.skip(r.u16());
		}
	}
	return { at, lat, lon, altitude, angle, satellites, speedKmh, io };
}

export interface Frame {
	records: AvlRecord[];
	/** So viele Bytes des Puffers gehörten zum Paket */
	used: number;
}

/** Ein Datenpaket – null, solange es nicht ganz angekommen ist. Fehlerhaftes wirft TeltonikaError. */
export function readFrame(buf: Buffer): Frame | null {
	if (buf.length < 8) return null;
	if (buf.readUInt32BE(0) !== 0) throw new TeltonikaError('Paket beginnt nicht mit vier Nullen');
	const length = buf.readUInt32BE(4);
	if (length < 3 || length > MAX_FRAME) throw new TeltonikaError(`Paketlänge ${length} ungültig`);
	const total = 8 + length + 4;
	if (buf.length < total) return null;
	const body = buf.subarray(8, 8 + length);
	if (crc16(body) !== buf.readUInt32BE(8 + length)) throw new TeltonikaError('Prüfsumme stimmt nicht');
	const r = new Reader(body);
	const codec = r.u8();
	if (codec !== CODEC_8 && codec !== CODEC_8E) throw new TeltonikaError(`Codec ${codec} wird nicht unterstützt`);
	const count = r.u8();
	const records: AvlRecord[] = [];
	for (let i = 0; i < count; i++) records.push(readRecord(r, codec === CODEC_8E));
	if (r.u8() !== count || r.offset !== body.length) throw new TeltonikaError('Anzahl der Datensätze stimmt nicht');
	return { records, used: total };
}

/** Quittung: die Anzahl als 4 Byte */
export function ack(count: number): Buffer {
	const out = Buffer.alloc(4);
	out.writeUInt32BE(count);
	return out;
}

/**
 * Standort eines Datensatzes – null ohne GPS-Empfang (der Tracker meldet dann
 * Nullen). Die Genauigkeit schätzen wir aus dem HDOP (Faktor 5 m); ohne den
 * gelten weniger als vier Satelliten als ungenau.
 */
export function toPosition(record: AvlRecord): PositionInput | null {
	if (record.satellites === 0 || (record.lat === 0 && record.lon === 0)) return null;
	const hdop = record.io.get(IO_HDOP);
	const acc = hdop != null && hdop > 0 ? Math.max(5, (hdop / 10) * 5) : record.satellites < 4 ? 100 : null;
	return { t: record.at, lat: record.lat, lon: record.lon, spd: record.speedKmh / 3.6, hdg: record.angle, acc };
}

export interface TrackerStatus {
	ignition: boolean | null;
	odometerKm: number | null;
	/** Bordspannung in Volt */
	voltage: number | null;
}

/** Der jüngste Stand aus den Messwerten – nicht jeder Datensatz enthält alle */
export function toStatus(records: readonly AvlRecord[]): TrackerStatus {
	const sorted = [...records].sort((a, b) => a.at - b.at);
	const newest = (id: number) => sorted.findLast((r) => r.io.has(id))?.io.get(id) ?? null;
	const ignition = newest(IO_IGNITION);
	const odometer = newest(IO_ODOMETER);
	const voltage = newest(IO_VOLTAGE);
	return {
		ignition: ignition == null ? null : ignition === 1,
		odometerKm: odometer == null ? null : Math.round(odometer / 100) / 10,
		voltage: voltage == null ? null : Math.round(voltage / 100) / 10
	};
}
