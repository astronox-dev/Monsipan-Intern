/**
 * Vorübergehend Partieführer: Ein Arbeiter bekommt bis zu einem Tag die Rechte
 * eines Partieführers für seine Partie – etwa wenn ein paar Leute ohne ihren
 * Partieführer auf eine Baustelle fahren und einer den Tagesbericht schreibt.
 * Die Rolle im Benutzerkonto bleibt Arbeiter; nach dem Tag gilt sie von selbst
 * wieder. Gesetzt wird das in der Wochenplanung (siehe planung/server/plan.ts).
 */
import { sql } from 'drizzle-orm';
import type { Role } from '$lib/permissions';
import { today } from '$lib/modules/stunden/week';
import { users } from './db/schema';

/** Die Rolle, die heute gilt: Arbeiter mit „Partieführer bis" ab heute → Partieführer */
export function effectiveRole(role: Role, leadUntil: string | null | undefined, day = today()): Role {
	return role === 'arbeiter' && !!leadUntil && leadUntil >= day ? 'partiefuehrer' : role;
}

/** Dasselbe in SQL – für Abfragen über viele Benutzer (etwa Empfänger von Benachrichtigungen) */
export const effectiveRoleSql = (day = today()) =>
	sql<Role>`(case when ${users.role} = 'arbeiter' and ${users.leadUntil} >= ${day} then 'partiefuehrer' else ${users.role} end)`;
