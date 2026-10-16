/**
 * Suche über das ganze Portal – das Feld oben (Strg K). Je Bereich die ersten
 * Treffer, aber nur aus Bereichen, die der Benutzer sehen darf, und dort nur,
 * was er sieht: Gesucht wird mit denselben Abfragen wie in den Listen (die
 * Partie bekommt also nur ihre Aufträge und Berichte). Seiten (Menüpunkte)
 * sucht der Browser selbst – siehe GlobalSearch.
 */
import { and, asc, isNull, like, or, sql } from 'drizzle-orm';
import { can } from '$lib/permissions';
import type { SessionUser } from './auth';
import { db } from './db';
import { users } from './db/schema';
import { ROLE_LABELS } from '$lib/permissions';
import { quickSearch } from '$lib/modules/lager/server/products';
import { listCustomers } from '$lib/modules/auftraege/server/customers';
import { listInquiries } from '$lib/modules/auftraege/server/inquiries';
import { listOffers } from '$lib/modules/auftraege/server/offers';
import { listOrders } from '$lib/modules/auftraege/server/orders';
import { listInvoices } from '$lib/modules/auftraege/server/invoices';
import { listReports } from '$lib/modules/tagesberichte/server/reports';
import { INVOICE_STATUS_LABELS, invoiceNo, OFFER_STATUS_LABELS, offerState, ORDER_STATUS_LABELS, spacedNumber } from '$lib/modules/auftraege/offer';
import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';

export interface SearchHit {
	id: string;
	title: string;
	detail: string;
	href: string;
	badge?: { label: string; tone: string };
}

export interface SearchGroup {
	key: string;
	label: string;
	hits: SearchHit[];
	/** Alle Treffer in der Liste */
	more?: string;
}

/** Treffer je Bereich */
export const PER_GROUP = 5;

const REPORT_STATUS: Record<string, { label: string; tone: string }> = {
	entwurf: { label: 'In Arbeit', tone: '' },
	freigegeben: { label: 'Freigegeben', tone: 'badge-info' },
	geprueft: { label: 'Geprüft', tone: 'badge-warn' },
	abgeschlossen: { label: 'Abgeschlossen', tone: 'badge-ok' }
};

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const enc = encodeURIComponent;

export async function globalSearch(user: SessionUser, raw: string): Promise<SearchGroup[]> {
	const q = raw.trim().replace(/\s+/g, ' ').slice(0, 100);
	if (q.length < 2) return [];
	// Nummern so, wie sie gespeichert sind: „26 001" → „26001"
	const num = /^[\d ]+$/.test(q) ? q.replace(/ /g, '') : q;
	const has = (p: Parameters<typeof can>[1]) => can(user.role, p);
	const tasks: Promise<SearchGroup>[] = [];

	if (has('auftraege.sehen')) {
		tasks.push(
			listOrders(user, { q: num }, PER_GROUP).then((rows) => ({
				key: 'auftraege',
				label: 'Aufträge',
				more: `/auftraege?q=${enc(q)}`,
				hits: rows.map((o) => ({
					id: `auftrag-${o.id}`,
					title: `${spacedNumber(o.number)} · ${o.title || 'Ohne BV'}`,
					detail: join(o.location || o.customerName, o.partyName ?? 'nicht zugeteilt'),
					href: `/auftraege/${o.id}`,
					badge: ORDER_STATUS_LABELS[o.status]
				}))
			}))
		);
	}
	if (has('angebote.sehen')) {
		tasks.push(
			listOffers({ q: num }, PER_GROUP).then((rows) => ({
				key: 'angebote',
				label: 'Angebote',
				more: `/angebote?q=${enc(q)}`,
				hits: rows.map((o) => ({
					id: `angebot-${o.id}`,
					title: `${spacedNumber(o.number)} · ${o.title || 'Ohne BV'}`,
					detail: join(o.customerName, o.customerCity),
					href: `/angebote/${o.id}`,
					badge: OFFER_STATUS_LABELS[offerState(o)]
				}))
			}))
		);
	}
	if (has('rechnungen.sehen')) {
		tasks.push(
			listInvoices({ q: num }, PER_GROUP).then((rows) => ({
				key: 'rechnungen',
				label: 'Rechnungen',
				more: `/rechnungen?stand=alle&q=${enc(q)}`,
				hits: rows.map((i) => ({
					id: `rechnung-${i.id}`,
					title: `${invoiceNo(i)} · ${i.title || 'Ohne BV'}`,
					detail: join(i.customerName, i.customerCity),
					href: `/rechnungen/${i.id}`,
					badge: i.stage === 'entwurf' ? { label: 'Entwurf', tone: '' } : INVOICE_STATUS_LABELS[i.status]
				}))
			}))
		);
	}
	if (has('tagesberichte.sehen')) {
		tasks.push(
			listReports(user, { q: num }, PER_GROUP).then((rows) => ({
				key: 'tagesberichte',
				label: 'Tagesberichte',
				more: `/tagesberichte?q=${enc(q)}`,
				hits: rows.map((r) => ({
					id: `bericht-${r.id}`,
					title: join(r.number ? `Nr. ${r.number}` : null, r.road || r.site || 'Ohne Bezeichnung'),
					detail: join(reportDateLabel(r.date, r.dateTo), r.partyName, r.orderNumber ? `Auftrag ${spacedNumber(r.orderNumber)}` : null),
					href: `/tagesberichte/${r.id}`,
					badge: REPORT_STATUS[r.status]
				}))
			}))
		);
	}
	if (has('anfragen.sehen')) {
		tasks.push(
			listInquiries({ q, state: 'alle' }, PER_GROUP).then((rows) => ({
				key: 'anfragen',
				label: 'Anfragen',
				more: `/anfragen?q=${enc(q)}`,
				hits: rows.map((i) => ({
					id: `anfrage-${i.id}`,
					title: i.subject || 'Ohne Betreff',
					detail: join(i.customerName || i.senderCompany || i.senderName || i.senderEmail, i.location),
					href: `/anfragen/${i.id}`
				}))
			}))
		);
	}
	if (has('kunden.sehen')) {
		tasks.push(
			listCustomers({ q }, { limit: PER_GROUP, offset: 0 }).then((rows) => ({
				key: 'kunden',
				label: 'Kunden',
				more: `/kunden?q=${enc(q)}`,
				hits: rows.map((c) => ({
					id: `kunde-${c.id}`,
					title: c.name,
					detail: join(c.city, c.contact),
					href: `/kunden?q=${enc(c.name)}`
				}))
			}))
		);
	}
	if (has('lager.artikel.sehen')) {
		tasks.push(
			quickSearch(q, PER_GROUP).then((rows) => ({
				key: 'artikel',
				label: 'Artikel',
				more: `/lager/bestand?q=${enc(q)}`,
				hits: rows.map((p) => ({
					id: `artikel-${p.id}`,
					title: p.name,
					detail: join(p.articleNumber, p.categoryName, `Bestand ${p.total}`),
					href: `/lager/artikel/${p.id}`
				}))
			}))
		);
	}
	if (has('benutzer.sehen')) {
		const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		tasks.push(
			db
				.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username, role: users.role, active: users.active })
				.from(users)
				.where(
					and(
						isNull(users.deletedAt),
						or(
							like(sql`${users.firstName} || ' ' || ${users.lastName}`, pattern),
							like(users.lastName, pattern),
							like(users.username, pattern),
							like(users.email, pattern)
						)
					)
				)
				.orderBy(asc(users.firstName), asc(users.lastName))
				.limit(PER_GROUP)
				.all()
				.then((rows) => ({
					key: 'benutzer',
					label: 'Benutzer',
					hits: rows.map((u) => ({
						id: `benutzer-${u.id}`,
						title: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
						detail: join(u.username, ROLE_LABELS[u.role], u.active ? null : 'deaktiviert'),
						href: '/verwaltung/benutzer'
					}))
				}))
		);
	}

	return (await Promise.all(tasks)).filter((g) => g.hits.length);
}

