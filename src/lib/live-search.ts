import { goto } from '$app/navigation';

/**
 * Such- und Filterformular (GET) ohne Seitenwechsel abschicken: Die Liste lädt
 * neu, Fokus und Scrollstand bleiben, und es entsteht kein neuer Eintrag im
 * Verlauf je Tastendruck. Leere Felder fallen weg; die Seite (?seite) auch –
 * ein neues Ergebnis beginnt vorne.
 */
export function liveSubmit(form: HTMLFormElement | null | undefined) {
	if (!form) return;
	const params = new URLSearchParams();
	for (const [key, value] of new FormData(form)) {
		if (typeof value === 'string' && value.trim() !== '') params.append(key, value);
	}
	const query = params.toString();
	return goto(`${location.pathname}${query ? `?${query}` : ''}`, { keepFocus: true, noScroll: true, replaceState: true });
}
