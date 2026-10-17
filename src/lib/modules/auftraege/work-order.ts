/**
 * Arbeitsauftrag nach dem Vordruck FO 0814 – je Auftrag einer. Das Büro
 * (Bauleiter) füllt Kopf, Beilagen, Evaluierung, Leistungen und die Rückseite
 * aus, die Partie auf der Baustelle ausgeführte Mengen, Checkliste,
 * Auffälligkeiten und die Unterweisung. Gespeichert wird der ganze Inhalt als
 * JSON am Auftrag; Unterschriften und Unterweisungen kommen nur über eigene
 * Aktionen hinein, nie mit dem Formular.
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
	return { ...sanitizeForm(r), signatures, briefings };
}

/**
 * Was jemand speichert, kommt nur dort an, wo er ändern darf: das Büro den
 * Kopf, Beilagen, Evaluierung, die Leistungen (außer der ausgeführten Menge)
 * und die Rückseite; die Partie die ausgeführten Mengen, Checkliste,
 * Auffälligkeiten und „Arbeit fertig am". Das Folienverlegeprotokoll dürfen
 * beide setzen.
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
		// Leistungen kommen vom Büro – die ausgeführte Menge nur, wenn es auch die Baustelle ist
		next.lines = incoming.lines.map((l, i) => ({ ...l, done: scope.site ? l.done : (old.lines[i]?.done ?? null) }));
	} else if (scope.site) {
		next.lines = old.lines.map((l, i) => ({ ...l, done: incoming.lines[i]?.done ?? l.done }));
	}
	if (scope.site) {
		next.checklist = incoming.checklist;
		next.issues = incoming.issues;
		next.finishedOn = incoming.finishedOn;
	}
	if (scope.office || scope.site) next.foilProtocol = incoming.foilProtocol;
	return next;
}

/** Wer welche Unterschrift setzen darf: BL das Büro, alle anderen die Baustelle */
export function maySign(role: SignatureRole, scope: WorkScope): boolean {
	return role === 'bl' ? scope.office : scope.site;
}

/** Erste Zeile eines Positionstexts – so steht die Leistung im Formular */
export function lineTitle(text: string): string {
	return (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 200);
}
