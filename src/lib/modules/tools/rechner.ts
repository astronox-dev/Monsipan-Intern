/**
 * Rechner für die Baustelle: wie lang Anfangs- und Endstrich einer
 * Parkordnung werden und wie weit die Riegel eines Schutzwegs vom Randstein
 * liegen. Gerechnet wird in Zentimetern, damit nichts verrundet.
 */

/** Parkordnung: Strich 2 m, Lücke 1 m – Anfangs- und Endstrich gleich lang, 50 cm bis 2 m */
export const PARKING = { stroke: 200, gap: 100, minEnd: 50, maxEnd: 200 } as const;

/** Schutzweg: Riegel 50 cm, Lücke 50 cm – Abstand zum Randstein 25 bis 50 cm */
export const CROSSING = { bar: 50, gap: 50, minEdge: 25, maxEdge: 50 } as const;

/** Längste Strecke, die der Rechner annimmt: 10 km */
export const MAX_LENGTH = 1_000_000;

export interface ParkingLayout {
	/** Anfangs- und Endstrich, je in cm */
	end: number;
	/** Ganze 2-m-Striche dazwischen */
	inner: number;
	/** Striche insgesamt, mit Anfang und Ende */
	strokes: number;
	/** Lücken zu je 1 m */
	gaps: number;
	/** Alle Striche zusammen in cm */
	marked: number;
}

/**
 * Einteilungen einer Parkordnung dieser Länge (cm), bei denen Anfangs- und
 * Endstrich zwischen 50 cm und 2 m liegen – meist genau eine; liegt ein Ende
 * genau auf 50 cm bzw. 2 m, gibt es zwei (die mit längeren Enden zuerst).
 */
export function parkingLayouts(length: number): ParkingLayout[] {
	const { stroke, gap, minEnd, maxEnd } = PARKING;
	const out: ParkingLayout[] = [];
	if (!(length > 0) || length > MAX_LENGTH) return out;
	for (let inner = 0; ; inner++) {
		const end = (length - inner * (stroke + gap) - gap) / 2;
		if (end < minEnd) break;
		if (end <= maxEnd) out.push({ end, inner, strokes: inner + 2, gaps: inner + 1, marked: 2 * end + inner * stroke });
	}
	return out;
}

export interface CrossingLayout {
	/** Anzahl der Riegel */
	bars: number;
	/** Abstand Randstein – erster bzw. letzter Riegel, cm */
	edge: number;
	/** Um so viel liegt der Abstand außerhalb von 25–50 cm: zu viel positiv, zu wenig negativ, sonst 0 */
	deviation: number;
}

export interface CrossingResult {
	/** Mit 50 cm Lücken und 25–50 cm zum Randstein – null, wenn es sich so nicht ausgeht */
	exact: CrossingLayout | null;
	/**
	 * Geht es sich nicht aus: die beiden Einteilungen daneben, ebenfalls mit
	 * 50 cm Lücken – die näher an der Vorgabe zuerst
	 */
	nearest: CrossingLayout[];
}

/** Schutzweg über diese Breite (cm, Randstein bis Randstein) einteilen – die Lücke ist immer 50 cm */
export function crossingLayout(width: number): CrossingResult {
	const { bar, gap, minEdge, maxEdge } = CROSSING;
	const result: CrossingResult = { exact: null, nearest: [] };
	if (!(width > 0) || width > MAX_LENGTH) return result;
	const layout = (bars: number): CrossingLayout => {
		const edge = (width - bars * bar - (bars - 1) * gap) / 2;
		return { bars, edge, deviation: edge > maxEdge ? edge - maxEdge : edge < minEdge ? edge - minEdge : 0 };
	};
	// Mit jedem Riegel mehr rückt der Rand um 50 cm näher – höchstens eine Anzahl passt
	const fewer = Math.floor((width + gap - 2 * minEdge) / (bar + gap));
	if (fewer >= 1 && layout(fewer).deviation === 0) {
		result.exact = layout(fewer);
		return result;
	}
	const candidates = [fewer, fewer + 1].filter((n) => n >= 1).map(layout);
	result.nearest = candidates.filter((c) => c.edge > 0).sort((a, b) => Math.abs(a.deviation) - Math.abs(b.deviation));
	return result;
}

/** „12,35" bzw. „12.35" Meter → Zentimeter; leer oder unlesbar → null */
export function metersToCm(raw: string): number | null {
	const s = raw.trim().replace(/\s/g, '').replace(/m$/i, '').replace(',', '.');
	if (!s) return null;
	const n = Number(s);
	return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 10 : null;
}

const cmFmt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });
const mFmt = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** „30 cm", „37,5 cm" */
export const cmLabel = (cm: number) => `${cmFmt.format(Math.round(cm * 10) / 10)} cm`;

/** „1,85 m", „12,355 m" */
export const mLabel = (cm: number) => `${mFmt.format(Math.round(cm * 10) / 1000)} m`;
