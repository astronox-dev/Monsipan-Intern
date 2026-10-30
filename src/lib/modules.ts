/**
 * Die Bereiche von Monsipan Portal an einer Stelle: Reihenfolge, Beschriftung,
 * Symbol, Einstiegsseite und nötiges Recht. Navigation und Übersicht bauen sich
 * daraus auf – ein neuer Bereich braucht nur einen Eintrag hier.
 *
 * `status: 'geplant'` heißt: noch nicht gebaut, taucht nirgends auf. Sobald der
 * Bereich fertig ist, wird daraus 'aktiv'. `'leer'` ist eine Kategorie, die schon
 * in der Seitenleiste steht, aber noch keine Einträge hat.
 */
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import HardHat from '@lucide/svelte/icons/hard-hat';
import FilePen from '@lucide/svelte/icons/file-pen-line';
import Inbox from '@lucide/svelte/icons/inbox';
import ReceiptText from '@lucide/svelte/icons/receipt-text';
import Building from '@lucide/svelte/icons/building';
import CalendarDays from '@lucide/svelte/icons/calendar-days';
import TreePalm from '@lucide/svelte/icons/tree-palm';
import Thermometer from '@lucide/svelte/icons/thermometer';
import PiggyBank from '@lucide/svelte/icons/piggy-bank';
import Truck from '@lucide/svelte/icons/truck';
import Users from '@lucide/svelte/icons/users';
import Clock from '@lucide/svelte/icons/clock';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import Tags from '@lucide/svelte/icons/tags';
import FileText from '@lucide/svelte/icons/file-text';
import Wrench from '@lucide/svelte/icons/wrench';
import Calculator from '@lucide/svelte/icons/calculator';
import Boxes from '@lucide/svelte/icons/boxes';
import ScanLine from '@lucide/svelte/icons/scan-line';
import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import ChartPie from '@lucide/svelte/icons/chart-pie';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import Scale from '@lucide/svelte/icons/scale';
import UserCog from '@lucide/svelte/icons/user-cog';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Settings from '@lucide/svelte/icons/settings';
import BellRing from '@lucide/svelte/icons/bell-ring';
import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
import Database from '@lucide/svelte/icons/database';
import type { Component } from 'svelte';
import { can, type Permission, type Role } from './permissions';

/** Zahlen neben Menüeinträgen – was noch zu tun ist */
export type NavBadge = 'lowStock' | 'anfragen' | 'tagesberichte';
export type NavBadges = Partial<Record<NavBadge, number>>;

/** Wie die Zahl aussieht und was sie vorliest */
export const NAV_BADGES: Record<NavBadge, { tone: string; label: (n: number) => string }> = {
	lowStock: { tone: 'badge-warn', label: (n) => `${n} Artikel nachbestellen` },
	anfragen: { tone: 'badge-info', label: (n) => (n === 1 ? '1 offene Anfrage' : `${n} offene Anfragen`) },
	tagesberichte: { tone: 'badge-warn', label: (n) => (n === 1 ? '1 Tagesbericht zu prüfen' : `${n} Tagesberichte zu prüfen`) }
};

export interface NavItem {
	href: string;
	label: string;
	icon: Component;
	permission?: Permission;
	badge?: NavBadge;
	/** Eine Zeile für die Karte auf der Übersicht – wenn der Eintrag dort eine eigene Karte hat */
	hint?: string;
}

/** Grobe Gliederung für die Seitenleiste, sobald mehrere Bereiche aktiv sind */
export type ModuleGroup = 'betrieb' | 'material' | 'ablage' | 'verwaltung';

export interface AppModule {
	key: string;
	label: string;
	icon: Component;
	/** Einstiegsseite des Bereichs */
	href: string;
	group: ModuleGroup;
	status: 'aktiv' | 'geplant' | 'leer';
	/** Recht für den ganzen Bereich; ohne Angabe entscheiden die Unterseiten */
	permission?: Permission;
	/** Eine Zeile für die Karte auf der Übersicht */
	hint?: string;
	/** Auf der Übersicht je Unterseite eine eigene Karte statt einer für den ganzen Bereich */
	cardsPerItem?: boolean;
	items: NavItem[];
}

export const MODULES: AppModule[] = [
	{ key: 'dashboard', label: 'Übersicht', icon: LayoutDashboard, href: '/', group: 'betrieb', status: 'aktiv', items: [] },
	{
		key: 'auftraege',
		label: 'Auftragsmanagement',
		icon: HardHat,
		href: '/auftraege',
		group: 'betrieb',
		status: 'aktiv',
		hint: 'Anfragen, Angebote, Aufträge, Tagesberichte, Rechnungen und Kunden',
		cardsPerItem: true,
		items: [
			{ href: '/anfragen', label: 'Anfragen', icon: Inbox, permission: 'anfragen.sehen', badge: 'anfragen', hint: 'E-Mails, aus denen Angebote werden' },
			{ href: '/angebote', label: 'Angebote', icon: FilePen, permission: 'angebote.sehen', hint: 'Mit Preisen, Link zum Annehmen' },
			{ href: '/auftraege', label: 'Aufträge', icon: HardHat, permission: 'auftraege.sehen', hint: 'Arbeiten je Partie' },
			{ href: '/tagesberichte', label: 'Tagesberichte', icon: NotebookPen, permission: 'tagesberichte.sehen', badge: 'tagesberichte', hint: 'Leistung je Tag und Baustelle' },
			{ href: '/rechnungen', label: 'Rechnungen', icon: ReceiptText, permission: 'rechnungen.sehen', hint: 'Offen und bezahlt' },
			{ href: '/kunden', label: 'Kunden', icon: Building, permission: 'kunden.sehen', hint: 'Anschriften für Angebote' }
		]
	},
	{
		key: 'planung',
		label: 'Planung',
		icon: CalendarDays,
		href: '/planung',
		group: 'betrieb',
		status: 'aktiv',
		hint: 'Wochenplanung, Urlaub, Krankenstand und Fahrzeuge',
		cardsPerItem: true,
		items: [
			{ href: '/planung', label: 'Wochenplanung', icon: CalendarDays, permission: 'planung.sehen', hint: 'Aufträge je Partie und Tag' },
			{ href: '/urlaub', label: 'Urlaub', icon: TreePalm, permission: 'urlaub.eigene.sehen', hint: 'Beantragen und genehmigen' },
			{ href: '/krankenstand', label: 'Krankenstand', icon: Thermometer, permission: 'krankenstand.eigene.sehen', hint: 'Melden, mit Krankmeldung' },
			{ href: '/urlaubskonten', label: 'Urlaubskonten', icon: PiggyBank, permission: 'urlaub.konten.bearbeiten', hint: 'An- und Abmeldung, Resturlaub' },
			{ href: '/fahrzeuge', label: 'Fahrzeuge', icon: Truck, permission: 'fahrzeuge.sehen', hint: 'Live-Karte, Fahrtenbuch und Statistik' }
		]
	},
	{ key: 'partien', label: 'Partien', icon: Users, href: '/partien', group: 'betrieb', status: 'geplant', items: [] },
	{
		key: 'dokumentation',
		label: 'Dokumentation',
		icon: FileText,
		href: '/stundenzettel',
		group: 'betrieb',
		status: 'aktiv',
		hint: 'Stundenzettel und Kostenstellen',
		cardsPerItem: true,
		items: [
			{ href: '/stundenzettel', label: 'Stundenzettel', icon: Clock, permission: 'stunden.eigene.sehen', hint: 'Lohnwoche je Mitarbeiter' },
			{ href: '/kostenstellen', label: 'Kostenstellen', icon: Tags, permission: 'stunden.alle.sehen', hint: 'Stunden je Kostenstelle, alle Partien' }
		]
	},
	{
		key: 'tools',
		label: 'Tools und Hilfestellung',
		icon: Wrench,
		href: '/tools/rechner',
		group: 'betrieb',
		status: 'aktiv',
		hint: 'Rechner, Richtlinien & Vorschriften',
		cardsPerItem: true,
		items: [
			{ href: '/tools/rechner', label: 'Rechner', icon: Calculator, permission: 'rechner.sehen', hint: 'Parkordnung und Schutzwege einteilen' },
			{ href: '/richtlinien', label: 'Richtlinien & Vorschriften', icon: Scale, permission: 'richtlinien.sehen', hint: 'PDFs in Ordnern, für alle' }
		]
	},
	{
		key: 'lager',
		label: 'Lagermanagement',
		icon: Boxes,
		href: '/lager/bestand',
		group: 'material',
		status: 'aktiv',
		hint: 'Bestand, Buchen, Inventur, Bestellliste',
		items: [
			{ href: '/lager/bestand', label: 'Bestand', icon: Boxes, permission: 'lager.bestand.sehen' },
			{ href: '/lager/buchen', label: 'Buchen', icon: ScanLine, permission: 'lager.bestand.buchen' },
			{ href: '/lager/inventur', label: 'Inventur', icon: ClipboardCheck, permission: 'lager.bestand.inventur' },
			{ href: '/lager/bewegungen', label: 'Bewegungen', icon: ArrowLeftRight, permission: 'lager.bewegungen.sehen' },
			{ href: '/lager/bestellliste', label: 'Bestellliste', icon: ClipboardList, permission: 'lager.berichte.sehen', badge: 'lowStock' },
			{ href: '/lager/berichte', label: 'Berichte', icon: ChartColumn, permission: 'lager.berichte.sehen' }
		]
	},
	{ key: 'bestellungen', label: 'Bestellungen', icon: ShoppingCart, href: '/bestellungen', group: 'material', status: 'geplant', items: [] },
	{ key: 'dokumente', label: 'Dokumente', icon: FolderOpen, href: '/dokumente', group: 'ablage', status: 'geplant', items: [] },
	{ key: 'auswertungen', label: 'Auswertungen', icon: ChartPie, href: '/auswertungen', group: 'ablage', status: 'geplant', items: [] },
	{
		key: 'benutzer',
		label: 'Benutzer',
		icon: UserCog,
		href: '/verwaltung/benutzer',
		group: 'verwaltung',
		status: 'aktiv',
		hint: 'Zugänge, Gruppen und Rechte',
		items: [
			{ href: '/verwaltung/benutzer', label: 'Benutzer', icon: UserCog, permission: 'benutzer.sehen' },
			{ href: '/verwaltung/berechtigungen', label: 'Berechtigungen', icon: ShieldCheck, permission: 'berechtigungen.sehen' }
		]
	},
	{
		key: 'administration',
		label: 'Administration',
		icon: Settings,
		href: '/verwaltung',
		group: 'verwaltung',
		status: 'aktiv',
		hint: 'Stammdaten, Benachrichtigungen, Import und Export, Einstellungen',
		items: [
			{ href: '/verwaltung/stammdaten', label: 'Stammdaten', icon: Database, permission: 'stammdaten.sehen' },
			{ href: '/verwaltung/benachrichtigungen', label: 'Benachrich\u00adtigungen', icon: BellRing, permission: 'benachrichtigungen.sehen' },
			{ href: '/verwaltung/import', label: 'Import und Export', icon: FileSpreadsheet, permission: 'daten.export' },
			{ href: '/verwaltung/einstellungen', label: 'Einstellungen', icon: Settings, permission: 'einstellungen.sehen' }
		]
	}
];

export const GROUP_LABELS: Record<ModuleGroup, string> = {
	betrieb: 'Betrieb',
	material: 'Material',
	ablage: 'Ablage',
	verwaltung: 'Verwaltung'
};

export function moduleByKey(key: string): AppModule | undefined {
	return MODULES.find((m) => m.key === key);
}
