import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canonicalUnit, unitChoices } from './units';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'einheiten-'));

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: TMP, DEMO_DATA: 'false' } }));
vi.mock('$app/environment', () => ({ dev: true, browser: false, building: false, version: 'test' }));

const { client, ensureDatabase } = await import('./server/db');
const { unitOptions } = await import('./server/options');

beforeAll(async () => {
	await ensureDatabase();
});

afterAll(() => {
	client.close();
	try {
		fs.rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* Windows: Datenbank noch gesperrt */
	}
});

describe('Einheiten', () => {
	it('eine neue Datenbank startet mit den üblichen Einheiten', async () => {
		expect(await unitOptions()).toEqual(['Pauschal', 'lfd. m', 'm²', 'Stk', 'h', 'kg', 'l']);
	});

	it('andere Schreibweise wird zur Einheit aus den Stammdaten', () => {
		const units = ['Pauschal', 'lfm', 'Stk'];
		expect(canonicalUnit(units, 'pauschal')).toBe('Pauschal');
		expect(canonicalUnit(units, ' LFM ')).toBe('lfm');
		expect(canonicalUnit(units, 'm³')).toBe('m³');
	});

	it('eine gespeicherte Einheit, die nicht (mehr) in der Liste steht, bleibt wählbar', () => {
		const units = ['Pauschal', 'lfm'];
		expect(unitChoices(units, 'lfm')).toEqual(['Pauschal', 'lfm']);
		expect(unitChoices(units, '')).toEqual(['Pauschal', 'lfm']);
		expect(unitChoices(units, 'Tag')).toEqual(['Pauschal', 'lfm', 'Tag']);
	});
});
