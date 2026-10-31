/**
 * Empfang der Teltonika-Tracker: ein eigener TCP-Port neben dem Webserver –
 * die Tracker sprechen kein HTTP. Eingeschaltet wird er mit TELTONIKA_PORT.
 *
 * Quittiert wird erst, wenn die Standorte gespeichert sind: Geht etwas schief,
 * behält der Tracker die Daten und schickt sie nach dem Neuverbinden noch einmal.
 *
 * Der Port ist aus dem Internet erreichbar und das Protokoll kennt kein Passwort.
 * Darum: Nur eingetragene IMEIs kommen durch, was nicht wie ein Tracker aussieht,
 * fliegt sofort raus, Verbindungen und Paketgrößen sind begrenzt.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { env } from '$env/dynamic/private';
import { ack, readFrame, readImei, TeltonikaError, toPosition, toStatus } from './teltonika-protocol';
import { cleanPositions, recordPositions, vehicleByImei } from './vehicles';

/** Mehr Tracker verbinden sich nicht gleichzeitig */
const MAX_CONNECTIONS = 200;
/** Bis dahin muss sich eine neue Verbindung angemeldet haben */
const LOGIN_MS = 15_000;
/** Der Tracker meldet sich auch im Stehen – längere Stille ist eine tote Verbindung */
const IDLE_MS = 2 * 3_600_000;
/** Mehr ungelesene Daten hält eine Verbindung nicht */
const MAX_BUFFER = 256 * 1024;

const log = (...args: unknown[]) => console.warn('[teltonika]', ...args);

function serve(socket: Socket) {
	let buffer = Buffer.alloc(0);
	let imei: string | null = null;
	/** Pakete der Reihe nach – der Tracker wartet ohnehin auf jede Quittung */
	let queue: Promise<void> = Promise.resolve();

	/** Vor der Anmeldung still: Port-Scanner aus dem Netz sollen das Protokoll nicht füllen */
	const drop = (why: string) => {
		if (imei) log(`Tracker ${imei} getrennt: ${why}`);
		socket.destroy();
	};

	async function login(): Promise<boolean> {
		const found = readImei(buffer);
		if (!found) return false;
		buffer = buffer.subarray(found.used);
		const vehicle = await vehicleByImei(found.imei);
		if (!vehicle) {
			// Ein noch nicht eingetragener Tracker versucht es von selbst wieder
			log(`Unbekannte IMEI ${found.imei} von ${socket.remoteAddress}`);
			socket.end(Buffer.from([0x00]));
			return false;
		}
		imei = found.imei;
		socket.setTimeout(IDLE_MS);
		socket.write(Buffer.from([0x01]));
		return true;
	}

	async function frame(): Promise<boolean> {
		const found = readFrame(buffer);
		if (!found) return false;
		buffer = buffer.subarray(found.used);
		const vehicle = await vehicleByImei(imei!);
		// Aus dem Fahrzeug entfernt, während die Verbindung lief
		if (!vehicle) {
			socket.destroy();
			return false;
		}
		const positions = cleanPositions(found.records.map(toPosition).filter(Boolean));
		await recordPositions(vehicle, positions, { battery: null, charging: null, ...toStatus(found.records) }, 'teltonika');
		socket.write(ack(found.records.length));
		return true;
	}

	async function work() {
		while (!socket.destroyed && buffer.length) {
			const more = imei ? await frame() : await login();
			if (!more) return;
		}
	}

	socket.setTimeout(LOGIN_MS);
	socket.on('timeout', () => socket.destroy());
	socket.on('error', () => socket.destroy());
	socket.on('data', (chunk) => {
		if (buffer.length + chunk.length > MAX_BUFFER) return drop('zu viele Daten');
		buffer = Buffer.concat([buffer, chunk]);
		queue = queue.then(work).catch((e) => {
			// Ohne Quittung schickt der Tracker die Daten noch einmal
			drop(e instanceof TeltonikaError ? e.message : `Fehler beim Speichern: ${e instanceof Error ? e.message : e}`);
		});
	});
}

let server: Server | null = null;

/** Port öffnen – die Antwort kommt, sobald er lauscht */
export function startTeltonika(port: number, host = '0.0.0.0'): Promise<Server> {
	return new Promise((resolve, reject) => {
		const s = createServer(serve);
		s.maxConnections = MAX_CONNECTIONS;
		s.once('error', reject);
		s.listen(port, host, () => {
			s.off('error', reject);
			s.on('error', (e) => log('Fehler:', e.message));
			resolve(s);
		});
	});
}

/** Beim Start der App – nur, wenn TELTONIKA_PORT gesetzt ist */
export async function initTeltonika() {
	const port = trackerPort();
	if (!port || server) return;
	try {
		server = await startTeltonika(port);
		console.info(`[teltonika] Empfang auf Port ${port}`);
	} catch (e) {
		// Der Port darf das Portal nicht aufhalten
		log(`Port ${port} lässt sich nicht öffnen:`, e instanceof Error ? e.message : e);
	}
}

function trackerPort(): number | null {
	const port = Number(env.TELTONIKA_PORT);
	return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/** Fürs Portal: ob der Empfang läuft und was im Tracker einzutragen ist */
export function trackerSetup() {
	const fallback = (() => {
		try {
			return new URL(env.ORIGIN ?? '').hostname;
		} catch {
			return '';
		}
	})();
	return { port: trackerPort(), host: env.TELTONIKA_HOST?.trim() || fallback };
}
