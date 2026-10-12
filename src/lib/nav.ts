/**
 * Navigation aus der Bereichs-Registry: Seitenleiste, Handy-Leiste und „Mehr".
 * Welche Bereiche es gibt, steht in modules.ts – hier steht nur, wie sie je
 * nach Rolle gefiltert werden.
 */
import { MODULES, type AppModule, type NavItem } from './modules';
import { can, type Role } from './permissions';

export type { NavItem, AppModule };

export function visible(items: NavItem[], role: Role): NavItem[] {
	return items.filter((i) => !i.permission || can(role, i.permission));
}

/**
 * Gebaute und für diese Rolle erlaubte Bereiche, Unterseiten schon gefiltert.
 * Leere Kategorien kommen mit – die Seitenleiste zeigt sie als Überschrift.
 */
export function visibleModules(role: Role): AppModule[] {
	const out: AppModule[] = [];
	for (const m of MODULES) {
		if (m.status === 'leer') {
			out.push(m);
			continue;
		}
		if (m.status !== 'aktiv') continue;
		if (m.permission && !can(role, m.permission)) continue;
		const items = visible(m.items, role);
		// Ein Bereich mit Unterseiten verschwindet, wenn davon nichts erlaubt ist
		if (m.items.length && !items.length) continue;
		out.push({ ...m, items });
	}
	return out;
}

/** Alle erreichbaren Einträge am Stück – für das Menü „Mehr" am Handy */
export function allNavItems(role: Role): NavItem[] {
	const out: NavItem[] = [];
	for (const m of visibleModules(role)) {
		if (m.status === 'leer') continue;
		if (m.items.length) out.push(...m.items);
		else out.push({ href: m.href, label: m.label, icon: m.icon });
	}
	return out;
}

/**
 * Die zwei Reiter der Handy-Leiste neben „Übersicht" – je nachdem, wofür jemand
 * das Handy braucht: Büro und Leitung (sehen alle Aufträge) für Aufträge und
 * Planung, die Partien für Tagesberichte und Stunden. Was die Rolle nicht
 * öffnen darf, fällt weg; dann rückt der nächste nach. Kurze Beschriftung,
 * damit es in die Leiste passt.
 */
const BOTTOM_OFFICE: [string, string][] = [
	['/auftraege', 'Aufträge'],
	['/planung', 'Planung'],
	['/tagesberichte', 'Berichte'],
	['/rechnungen', 'Rechnungen'],
	['/lager/bestand', 'Bestand']
];
const BOTTOM_FIELD: [string, string][] = [
	['/tagesberichte', 'Berichte'],
	['/stundenzettel', 'Stunden'],
	['/auftraege', 'Aufträge'],
	['/lager/bestand', 'Bestand'],
	['/lager/buchen', 'Buchen']
];

export function bottomTabs(role: Role): NavItem[] {
	const all = allNavItems(role);
	const wanted = can(role, 'auftraege.alle.sehen') ? BOTTOM_OFFICE : BOTTOM_FIELD;
	return wanted
		.map(([href, label]) => {
			const item = all.find((i) => i.href === href);
			return item ? { ...item, label } : null;
		})
		.filter((i): i is NavItem => !!i)
		.slice(0, 2);
}

/**
 * Karten für die Übersicht: je Bereich eine, bei `cardsPerItem` je Unterseite
 * eine. Leere Kategorien und die Übersicht selbst fehlen.
 */
export function overviewCards(role: Role): { key: string; href: string; label: string; icon: NavItem['icon']; hint?: string }[] {
	return visibleModules(role)
		.filter((m) => m.status === 'aktiv' && m.key !== 'dashboard')
		.flatMap((m) =>
			m.cardsPerItem
				? m.items.map((i) => ({ key: i.href, href: i.href, label: i.label, icon: i.icon, hint: i.hint }))
				: [{ key: m.key, href: m.href, label: m.label, icon: m.icon, hint: m.hint }]
		);
}

export function isActive(href: string, pathname: string) {
	if (href === '/') return pathname === '/';
	return pathname === href || pathname.startsWith(`${href}/`);
}
