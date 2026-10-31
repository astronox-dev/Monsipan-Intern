import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

import { ack, crc16, readFrame, readImei, TeltonikaError, toPosition, toStatus, type AvlRecord } from './teltonika-protocol';

/** Die Beispiele aus der Protokoll-Beschreibung von Teltonika */
const CODEC_8 = '000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF';
const CODEC_8E = '000000000000004A8E010000016B412CEE000100000000000000000000000000000000010005000100010100010011001D00010010015E2C880002000B000000003544C87A000E000000001DD7E06A00000100002994';
const hex = (s: string) => Buffer.from(s, 'hex');

/** Ein Paket mit einem Datensatz, wie der Tracker es schickt */
function frame(records: Buffer[]): Buffer {
	const body = Buffer.concat([Buffer.from([0x08, records.length]), ...records, Buffer.from([records.length])]);
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 4);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc16(body));
	return Buffer.concat([head, body, tail]);
}

function record(at: number, lat: number, lon: number, speed: number, io: [number, number][] = []): Buffer {
	const b = Buffer.alloc(24);
	b.writeBigUInt64BE(BigInt(at), 0);
	b.writeInt32BE(Math.round(lon * 1e7), 9);
	b.writeInt32BE(Math.round(lat * 1e7), 13);
	b.writeInt16BE(170, 17);
	b.writeUInt16BE(90, 19);
	b[21] = 9; // Satelliten
	b.writeUInt16BE(speed, 22);
	const ioBytes = Buffer.from([0, io.length, io.length, ...io.flatMap(([id, v]) => [id, v]), 0, 0, 0]);
	return Buffer.concat([b, ioBytes]);
}

describe('Teltonika – Anmeldung', () => {
	it('liest die IMEI, auch wenn sie stückweise ankommt', () => {
		const login = hex('000F333536333037303432343431303133');
		expect(readImei(login)).toEqual({ imei: '356307042441013', used: 17 });
		expect(readImei(login.subarray(0, 1))).toBeNull();
		expect(readImei(login.subarray(0, 9))).toBeNull();
	});

	it('lehnt ab, was keine IMEI ist', () => {
		expect(() => readImei(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toThrow(TeltonikaError);
		expect(() => readImei(Buffer.from([0, 15, ...Buffer.from('35630704244101x')]))).toThrow(TeltonikaError);
	});
});

describe('Teltonika – Datenpakete', () => {
	it('liest das Beispiel für Codec 8 und seine Messwerte', () => {
		const frameData = readFrame(hex(CODEC_8))!;
		expect(frameData.used).toBe(hex(CODEC_8).length);
		expect(frameData.records).toHaveLength(1);
		const r = frameData.records[0];
		expect(r.at).toBe(Number(0x0000016b40d8ea30n));
		expect(r.io.get(0x15)).toBe(3);
		expect(r.io.get(0x42)).toBe(0x5e0f);
		expect(r.io.get(0xf1)).toBe(0x601a);
		expect(r.io.get(0x4e)).toBe(0);
	});

	it('liest das Beispiel für Codec 8 Extended', () => {
		const frameData = readFrame(hex(CODEC_8E))!;
		expect(frameData.records).toHaveLength(1);
		const r = frameData.records[0];
		expect(r.io.get(0x01)).toBe(1);
		expect(r.io.get(0x11)).toBe(0x1d);
		expect(r.io.get(0x10)).toBe(0x015e2c88);
		expect(r.io.get(0x0b)).toBe(0x3544c87a);
		expect(r.io.get(0x0e)).toBe(0x1dd7e06a);
	});

	it('wartet auf den Rest und sagt, wie viel es verbraucht hat', () => {
		const data = hex(CODEC_8);
		expect(readFrame(data.subarray(0, 4))).toBeNull();
		expect(readFrame(data.subarray(0, data.length - 1))).toBeNull();
		expect(readFrame(Buffer.concat([data, data]))?.used).toBe(data.length);
	});

	it('lehnt Beschädigtes ab', () => {
		const data = Buffer.from(hex(CODEC_8));
		data[20] ^= 0xff;
		expect(() => readFrame(data)).toThrow(/Prüfsumme/);
		const huge = Buffer.alloc(16);
		huge.writeUInt32BE(10_000_000, 4);
		expect(() => readFrame(huge)).toThrow(/Paketlänge/);
		expect(() => readFrame(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toThrow(/vier Nullen/);
	});

	it('quittiert mit der Anzahl als 4 Byte', () => {
		expect(ack(3).toString('hex')).toBe('00000003');
	});
});

describe('Teltonika – Standort und Zustand', () => {
	it('rechnet Lage, Richtung und Geschwindigkeit um – auch südlich und westlich', () => {
		const at = Date.UTC(2026, 9, 31, 8);
		const { records } = readFrame(frame([record(at, 48.3608, 16.4925, 72), record(at + 1000, -33.9, -70.65, 36)]))!;
		expect(toPosition(records[0])).toMatchObject({ t: at, lat: 48.3608, lon: 16.4925, spd: 20, hdg: 90 });
		expect(toPosition(records[1])).toMatchObject({ lat: -33.9, lon: -70.65, spd: 10 });
	});

	it('ohne GPS kein Standort, wenige Satelliten gelten als ungenau', () => {
		const base = { at: 1, lat: 48.1, lon: 16.1, altitude: 0, angle: 0, satellites: 9, speedKmh: 0, io: new Map() } satisfies AvlRecord;
		expect(toPosition({ ...base, satellites: 0 })).toBeNull();
		expect(toPosition({ ...base, lat: 0, lon: 0 })).toBeNull();
		expect(toPosition({ ...base, satellites: 3 })?.acc).toBe(100);
		expect(toPosition(base)?.acc).toBeNull();
		// HDOP kommt mal zehn: 1,2 → rund 6 m
		expect(toPosition({ ...base, io: new Map([[182, 12]]) })?.acc).toBeCloseTo(6);
	});

	it('nimmt den jüngsten Zustand, auch aus verschiedenen Datensätzen', () => {
		const r = (at: number, io: [number, number][]) => ({ at, lat: 0, lon: 0, altitude: 0, angle: 0, satellites: 0, speedKmh: 0, io: new Map(io) });
		expect(
			toStatus([
				r(2, [[239, 0]]),
				r(1, [
					[239, 1],
					[16, 123_456_700],
					[66, 13_850]
				])
			])
		).toEqual({ ignition: false, odometerKm: 123_456.7, voltage: 13.9 });
		expect(toStatus([r(1, [])])).toEqual({ ignition: null, odometerKm: null, voltage: null });
	});
});
