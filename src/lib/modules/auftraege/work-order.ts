/**
 * Arbeitsauftrag nach dem Vordruck FO 0814 – je Auftrag einer. Das Büro
 * (Bauleiter) füllt vor dem Erstellen Kopf, Beilagen, Evaluierung, die Angaben
 * zu den Leistungen und die Rückseite aus; danach stehen die Leistungen fest.
 * Die Partie trägt auf der Baustelle ausgeführte Mengen, Checkliste,
 * Auffälligkeiten, die Unterweisung und – wenn verlangt – das
 * 3M-Verlegeprotokoll ein. Gespeichert wird der ganze Inhalt als JSON am
 * Auftrag; Unterschriften und Unterweisungen kommen nur über eigene Aktionen
 * hinein, nie mit dem Formular.
 */
import { isValidSignature } from '$lib/modules/stunden/signature';
import { isValidIsoDate } from '$lib/modules/stunden/week';
import { parseAmount } from './offer';

/** So viele Leistungen und Unterweisungen passen ins PDF */
export const MAX_WORK_LINES = 20;
export const MAX_BRIEFINGS = 20;

export interface WorkLine {
	/** Beschreibung der Leistung */
	text: string;
	/** Art der Markierung */
	kind: string;
	/** RAL-Farbton */
	ral: string;
	msk: string;
	/** Ca. Menge */
	quantity: number | null;
	unit: string;
	/** Ausgeführte Menge – trägt die Partie ein */
	done: number | null;
}

/** Eine Zeile der Rückseite: angehakt, dazu was genau (z. B. „Warnkleidung Klasse 3") */
export interface WorkCheck {
	label: string;
	checked: boolean;
	detail: string;
}

export interface WorkSignature {
	/** SVG-Pfad im 600×200-Feld */
	path: string;
	name: string;
	/** Zeitpunkt in ms */
	at: number;
}

export interface WorkBriefing {
	date: string;
	name: string;
	signature: string;
	at: number;
}

export const ATTACHMENTS = [
	{ key: 'discussed', label: 'Baustelle besprochen' },
	{ key: 'offerParts', label: 'Angebotsteile' },
	{ key: 'plans', label: 'Pläne' },
	{ key: 'safetyRules', label: 'Spezielle Sicherheitsvorschriften' },
	{ key: 'foremanBriefing', label: 'Baustellenunterweisung durch Polier' }
] as const;

export const CHECKLIST = [
	{ key: 'ppe', label: 'Mitarbeiter tragen PSA' },
	{ key: 'secured', label: 'Baustelle ist abgesichert' },
	{ key: 'equipment', label: 'Ausrüstung ist in Ordnung' }
] as const;

export const ISSUES = [
	{ key: 'access', label: 'Behinderung bei Zugang/Zufahrt zur Baustelle' },
	{ key: 'dirty', label: 'Baustelle war nicht sauber' },
	{ key: 'unreachable', label: 'Auftraggeber war schlecht erreichbar' },
	{ key: 'unpunctual', label: 'Auftraggeber war unpünktlich' },
	{ key: 'plans', label: 'Pläne haben nicht gestimmt/ Baustelle war anders als besprochen' }
] as const;

/** Rückseite: vier feste Zeilen, dazu zwei freie */
export const PPE_LABELS = ['Arbeitskleidung', 'Helm', 'Handschuhe', 'Schutzbrille'];
export const HAZARD_LABELS = ['Absturzgefahr', 'Versinken/Untergehen', 'Maschinen', 'Umgebung, z.B. Sprengarbeiten'];
export const FREE_CHECKS = 2;

export const SIGNATURE_ROLES = ['bl', 'vorarbeiter', 'vertretung', 'auftraggeber'] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

export const SIGNATURE_LABELS: Record<SignatureRole, string> = {
	bl: 'Unterschrift BL',
	vorarbeiter: 'Unterschrift Vorarbeiter (Aufsichtsperson)',
	vertretung: 'Vertretung Vorarbeiter',
	auftraggeber: 'Unterschrift Auftraggeber'
};

type AttachmentKey = (typeof ATTACHMENTS)[number]['key'];
type ChecklistKey = (typeof CHECKLIST)[number]['key'];
type IssueKey = (typeof ISSUES)[number]['key'];

export interface WorkOrderForm {
	/** Auftrag (BV) */
	title: string;
	site: string;
	/** Ausführungsdatum und Endtermin, JJJJ-MM-TT oder leer */
	startDate: string;
	endDate: string;
	/** Zwei Kontaktpersonen mit Telefon */
	contacts: { name: string; phone: string }[];
	attachments: Record<AttachmentKey, boolean> & { other: boolean; otherText: string };
	evaluation: '' | 'standard' | 'baustelle';
	lines: WorkLine[];
	foilProtocol: '' | 'ja' | 'nein';
	/** „Datum:" neben der Unterschrift BL */
	signDate: string;
	checklist: Record<ChecklistKey, boolean>;
	issues: Record<IssueKey, boolean> & { other: boolean; otherText: string; extraHours: boolean; extraHoursReason: string };
	/** Arbeit fertig am */
	finishedOn: string;
	ppe: WorkCheck[];
	hazards: WorkCheck[];
}

export interface WorkOrderContent extends WorkOrderForm {
	signatures: Partial<Record<SignatureRole, WorkSignature>>;
	briefings: WorkBriefing[];
	/** 3M-Eigenüberwachungsprotokoll – nur bei Folienverlegeprotokoll „ja" */
	foil: FoilProtocol;
}

/* ------------------------------------------------ 3M-Verlegeprotokoll */

/** Messzeiten für das Wetter (2.1) */
export const FOIL_TIMES = ['08.00 Uhr', '11.00 Uhr', '14.00 Uhr', '18.00 Uhr'];

export const FOIL_CONDITION = [
	{ key: 'glatt', label: 'glatt' },
	{ key: 'rauh', label: 'rauh' },
	{ key: 'rissig', label: 'rissig' }
] as const;
export const FOIL_PREP = [
	{ key: 'fraesen', label: 'fräsen' },
	{ key: 'kehren', label: 'kehren' },
	{ key: 'staubfrei', label: 'staubfrei reinigen' }
] as const;
export const FOIL_PRIMED = [
	{ key: 'spray', label: 'Sprühgerät' },
	{ key: 'roller', label: 'Rolle' }
] as const;
export const FOIL_LAYING = [
	{ key: 'manual', label: 'manuell' },
	{ key: 'mta2', label: '3M MTA II' }
] as const;
export const FOIL_PRESSING = [
	{ key: 'rtc3', label: '3M RTC 3' },
	{ key: 'rtc300', label: '3M RTC 300' }
] as const;

/** Spalten der Folien (3.1) – zwei Zeilen wie auf dem Vordruck */
export const FOIL_FILM_COLUMNS = [
	{ key: 'type', label: 'Folientyp' },
	{ key: 'width', label: 'Breite in cm' },
	{ key: 'length', label: 'Gesamtlänge in m' },
	{ key: 'primer', label: 'Grundierung' },
	{ key: 'dryTime', label: 'Trockenzeit in min.' },
	{ key: 'lineType', label: 'Linienart' }
] as const;
export const FOIL_FILM_ROWS = 2;

type Choice<K extends string> = Record<K, boolean> & { other: boolean; otherText: string };
type FilmKey = (typeof FOIL_FILM_COLUMNS)[number]['key'];

export const FOIL_SIGNATURE_ROLES = ['auftraggeber', 'auftragnehmer'] as const;
export type FoilSignatureRole = (typeof FOIL_SIGNATURE_ROLES)[number];
export const FOIL_SIGNATURE_LABELS: Record<FoilSignatureRole, string> = {
	auftraggeber: 'Gesehen / anerkannt – Auftraggeber',
	auftragnehmer: 'Ausgefertigt von – Auftragnehmer'
};

export interface FoilProtocol {
	/** 1.1 – 1.4 */
	place: string;
	section: string;
	surface: string;
	laneWidth: string;
	condition: Choice<(typeof FOIL_CONDITION)[number]['key']>;
	prep: Choice<(typeof FOIL_PREP)[number]['key']>;
	/** 2.1 je Messzeit: Luft, Boden, Luftfeuchtigkeit */
	weather: { air: string[]; ground: string[]; humidity: string[] };
	/** 2.2 letzter Regen vor … Tagen / … Stunden */
	rainDays: string;
	rainHours: string;
	films: Record<FilmKey, string>[];
	lotFilm: string;
	lotPrimer: string;
	lotDs01e: string;
	primed: Choice<(typeof FOIL_PRIMED)[number]['key']>;
	laying: Choice<(typeof FOIL_LAYING)[number]['key']>;
	pressing: Choice<(typeof FOIL_PRESSING)[number]['key']>;
	/** 3.6 Streckenfreigabe: gleicher Tag oder nach … Tagen */
	release: '' | 'gleich' | 'nach';
	releaseDays: string;
	/** 3.7 und 3.8 */
	layingDate: string;
	removalDate: string;
	remarks: string;
	signatures: Partial<Record<FoilSignatureRole, WorkSignature>>;
}

/** Wer was ändern darf: das Büro (Bauleiter) und die Partie auf der Baustelle */
export interface WorkScope {
	office: boolean;
	site: boolean;
}

const checks = (labels: string[]): WorkCheck[] => [
	...labels.map((label) => ({ label, checked: false, detail: '' })),
	...Array.from({ length: FREE_CHECKS }, () => ({ label: '', checked: false, detail: '' }))
];

export function emptyForm(): WorkOrderForm {
	return {
		title: '',
		site: '',
		startDate: '',
		endDate: '',
		contacts: [
			{ name: '', phone: '' },
			{ name: '', phone: '' }
		],
		attachments: { discussed: false, offerParts: false, plans: false, safetyRules: false, foremanBriefing: false, other: false, otherText: '' },
		evaluation: '',
		lines: [],
		foilProtocol: '',
		signDate: '',
		checklist: { ppe: false, secured: false, equipment: false },
		issues: {
			access: false,
			dirty: false,
			unreachable: false,
			unpunctual: false,
			plans: false,
			other: false,
			otherText: '',
			extraHours: false,
			extraHoursReason: ''
		},
		finishedOn: '',
		ppe: checks(PPE_LABELS),
		hazards: checks(HAZARD_LABELS)
	};
}

const choice = <K extends string>(keys: readonly { key: K }[]): Choice<K> =>
	({ ...Object.fromEntries(keys.map(({ key }) => [key, false])), other: false, otherText: '' }) as Choice<K>;

export function emptyFoil(): FoilProtocol {
	return {
		place: '',
		section: '',
		surface: '',
		laneWidth: '',
		condition: choice(FOIL_CONDITION),
		prep: choice(FOIL_PREP),
		weather: { air: FOIL_TIMES.map(() => ''), ground: FOIL_TIMES.map(() => ''), humidity: FOIL_TIMES.map(() => '') },
		rainDays: '',
		rainHours: '',
		films: Array.from({ length: FOIL_FILM_ROWS }, () => ({ type: '', width: '', length: '', primer: '', dryTime: '', lineType: '' })),
		lotFilm: '',
		lotPrimer: '',
		lotDs01e: '',
		primed: choice(FOIL_PRIMED),
		laying: choice(FOIL_LAYING),
		pressing: choice(FOIL_PRESSING),
		release: '',
		releaseDays: '',
		layingDate: '',
		removalDate: '',
		remarks: '',
		signatures: {}
	};
}

export function emptyLine(): WorkLine {
	return { text: '', kind: '', ral: '', msk: '', quantity: null, unit: '', done: null };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v: unknown) => v === true;
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && isValidIsoDate(v);
const day = (v: unknown) => (isIsoDate(v) ? v : '');
const num = (v: unknown): number | null => {
	if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
	if (typeof v === 'string') return num(parseAmount(v));
	return null;
};

function readChecks(raw: unknown, labels: string[]): WorkCheck[] {
	const list = Array.isArray(raw) ? raw : [];
	return checks(labels).map((base, i) => {
		const r = obj(list[i]);
		return {
			// Feste Zeilen behalten ihre Beschriftung, freie bekommen eine eigene
			label: i < labels.length ? base.label : str(r.label, 60),
			checked: bool(r.checked),
			detail: str(r.detail, 120)
		};
	});
}

/** Eingaben in Form bringen – was nicht passt, fällt auf leer */
export function sanitizeForm(raw: unknown): WorkOrderForm {
	const r = obj(raw);
	const base = emptyForm();
	const a = obj(r.attachments);
	const c = obj(r.checklist);
	const iss = obj(r.issues);
	const contacts = Array.isArray(r.contacts) ? r.contacts : [];
	const lines = Array.isArray(r.lines) ? r.lines : [];
	return {
		title: str(r.title, 200),
		site: str(r.site, 200),
		startDate: day(r.startDate),
		endDate: day(r.endDate),
		contacts: base.contacts.map((_, i) => ({ name: str(obj(contacts[i]).name, 100), phone: str(obj(contacts[i]).phone, 40) })),
		attachments: {
			...(Object.fromEntries(ATTACHMENTS.map(({ key }) => [key, bool(a[key])])) as Record<AttachmentKey, boolean>),
			other: bool(a.other),
			otherText: str(a.otherText, 80)
		},
		evaluation: r.evaluation === 'standard' || r.evaluation === 'baustelle' ? r.evaluation : '',
		lines: lines.slice(0, MAX_WORK_LINES).map((x) => {
			const l = obj(x);
			return {
				text: str(l.text, 200),
				kind: str(l.kind, 60),
				ral: str(l.ral, 40),
				msk: str(l.msk, 30),
				quantity: num(l.quantity),
				unit: str(l.unit, 20),
				done: num(l.done)
			};
		}),
		foilProtocol: r.foilProtocol === 'ja' || r.foilProtocol === 'nein' ? r.foilProtocol : '',
		signDate: day(r.signDate),
		checklist: Object.fromEntries(CHECKLIST.map(({ key }) => [key, bool(c[key])])) as Record<ChecklistKey, boolean>,
		issues: {
			...(Object.fromEntries(ISSUES.map(({ key }) => [key, bool(iss[key])])) as Record<IssueKey, boolean>),
			other: bool(iss.other),
			otherText: str(iss.otherText, 120),
			extraHours: bool(iss.extraHours),
			extraHoursReason: str(iss.extraHoursReason, 200)
		},
		finishedOn: day(r.finishedOn),
		ppe: readChecks(r.ppe, PPE_LABELS),
		hazards: readChecks(r.hazards, HAZARD_LABELS)
	};
}

function readChoice<K extends string>(raw: unknown, keys: readonly { key: K }[]): Choice<K> {
	const r = obj(raw);
	return { ...Object.fromEntries(keys.map(({ key }) => [key, bool(r[key])])), other: bool(r.other), otherText: str(r.otherText, 60) } as Choice<K>;
}

/** Verlegeprotokoll in Form bringen – Unterschriften kommen nie aus dem Formular */
export function sanitizeFoil(raw: unknown): Omit<FoilProtocol, 'signatures'> {
	const r = obj(raw);
	const w = obj(r.weather);
	const times = (v: unknown) => FOIL_TIMES.map((_, i) => str((Array.isArray(v) ? v : [])[i], 12));
	const films = Array.isArray(r.films) ? r.films : [];
	return {
		place: str(r.place, 160),
		section: str(r.section, 120),
		surface: str(r.surface, 120),
		laneWidth: str(r.laneWidth, 60),
		condition: readChoice(r.condition, FOIL_CONDITION),
		prep: readChoice(r.prep, FOIL_PREP),
		weather: { air: times(w.air), ground: times(w.ground), humidity: times(w.humidity) },
		rainDays: str(r.rainDays, 12),
		rainHours: str(r.rainHours, 12),
		films: Array.from({ length: FOIL_FILM_ROWS }, (_, i) => {
			const x = obj(films[i]);
			return Object.fromEntries(FOIL_FILM_COLUMNS.map(({ key }) => [key, str(x[key], 40)])) as Record<FilmKey, string>;
		}),
		lotFilm: str(r.lotFilm, 40),
		lotPrimer: str(r.lotPrimer, 40),
		lotDs01e: str(r.lotDs01e, 40),
		primed: readChoice(r.primed, FOIL_PRIMED),
		laying: readChoice(r.laying, FOIL_LAYING),
		pressing: readChoice(r.pressing, FOIL_PRESSING),
		release: r.release === 'gleich' || r.release === 'nach' ? r.release : '',
		releaseDays: str(r.releaseDays, 12),
		layingDate: day(r.layingDate),
		removalDate: day(r.removalDate),
		remarks: str(r.remarks, 300)
	};
}

function readSignature(raw: unknown): WorkSignature | undefined {
	const s = obj(raw);
	if (!isValidSignature(s.path as string) || typeof s.at !== 'number') return undefined;
	return { path: s.path as string, name: str(s.name, 120), at: s.at };
}

/** Gespeicherten Inhalt lesen – auch ältere oder lückenhafte Stände */
export function readContent(raw: unknown): WorkOrderContent {
	const r = obj(raw);
	const sig = obj(r.signatures);
	const signatures: WorkOrderContent['signatures'] = {};
	for (const role of SIGNATURE_ROLES) {
		const s = readSignature(sig[role]);
		if (s) signatures[role] = s;
	}
	const briefings = (Array.isArray(r.briefings) ? r.briefings : [])
		.map((x) => {
			const b = obj(x);
			return { date: day(b.date), name: str(b.name, 120), signature: isValidSignature(b.signature as string) ? (b.signature as string) : '', at: typeof b.at === 'number' ? b.at : 0 };
		})
		.filter((b) => b.name)
		.slice(0, MAX_BRIEFINGS);
	const foilRaw = obj(r.foil);
	const foilSig = obj(foilRaw.signatures);
	const foilSignatures: FoilProtocol['signatures'] = {};
	for (const role of FOIL_SIGNATURE_ROLES) {
		const s = readSignature(foilSig[role]);
		if (s) foilSignatures[role] = s;
	}
	return { ...sanitizeForm(r), signatures, briefings, foil: { ...sanitizeFoil(foilRaw), signatures: foilSignatures } };
}

/**
 * Was jemand speichert, kommt nur dort an, wo er ändern darf: das Büro den
 * Kopf, Beilagen, Evaluierung und die Rückseite; die Partie die ausgeführten
 * Mengen, Checkliste, Auffälligkeiten und „Arbeit fertig am". Das
 * Folienverlegeprotokoll dürfen beide setzen. Die Leistungen selbst stehen
 * seit dem Erstellen fest.
 */
export function mergeForm(old: WorkOrderForm, incoming: WorkOrderForm, scope: WorkScope): WorkOrderForm {
	const next: WorkOrderForm = structuredClone(old);
	if (scope.office) {
		next.title = incoming.title;
		next.site = incoming.site;
		next.startDate = incoming.startDate;
		next.endDate = incoming.endDate;
		next.contacts = incoming.contacts;
		next.attachments = incoming.attachments;
		next.evaluation = incoming.evaluation;
		next.signDate = incoming.signDate;
		next.ppe = incoming.ppe;
		next.hazards = incoming.hazards;
	}
	if (scope.site) {
		next.lines = old.lines.map((l, i) => ({ ...l, done: incoming.lines[i] ? incoming.lines[i].done : l.done }));
		next.checklist = incoming.checklist;
		next.issues = incoming.issues;
		next.finishedOn = incoming.finishedOn;
	}
	if (scope.office || scope.site) next.foilProtocol = incoming.foilProtocol;
	return next;
}

/**
 * Beim Erstellen: Kopf, Beilagen, Evaluierung, Folienverlegeprotokoll und
 * Rückseite aus dem Formular; die Leistungen bleiben die des Auftrags, nur Art
 * der Markierung, RAL und MSK kommen dazu.
 */
export function creationForm(prefilled: WorkOrderForm, incoming: WorkOrderForm): WorkOrderForm {
	return {
		...prefilled,
		title: incoming.title,
		site: incoming.site,
		startDate: incoming.startDate,
		endDate: incoming.endDate,
		contacts: incoming.contacts,
		attachments: incoming.attachments,
		evaluation: incoming.evaluation,
		foilProtocol: incoming.foilProtocol,
		ppe: incoming.ppe,
		hazards: incoming.hazards,
		lines: prefilled.lines.map((l, i) => {
			const x = incoming.lines[i];
			return x ? { ...l, kind: x.kind, ral: x.ral, msk: x.msk } : l;
		})
	};
}

/** Wer welche Unterschrift setzen darf: BL das Büro, alle anderen die Baustelle */
export function maySign(role: SignatureRole, scope: WorkScope): boolean {
	return role === 'bl' ? scope.office : scope.site;
}

/** Erste Zeile eines Positionstexts – so steht die Leistung im Formular */
export function lineTitle(text: string): string {
	return (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 200);
}
