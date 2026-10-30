/**
 * Die Seite festhalten, solange etwas über ihr liegt. Die dunkle Fläche hinter
 * einem Dialog hält keinen Finger auf – auf dem iPhone schiebt man sonst die
 * Seite dahinter mit. Gesperrt wird jede Wisch- und Radbewegung, die nichts im
 * Overlay bewegen kann. Frei bleibt, was selbst scrollt (Listen, Tabellen, die
 * Räder der Zeitauswahl), Eingabefelder und das Zoomen mit zwei Fingern.
 *
 * Mehrere Overlays übereinander zählen mit: Die Sperre endet mit dem letzten.
 */
let holders = 0;

function scrolls(el: Element): boolean {
	const free = (v: string) => v === 'auto' || v === 'scroll';
	const { overflowX, overflowY } = getComputedStyle(el);
	return (free(overflowY) && el.scrollHeight > el.clientHeight + 1) || (free(overflowX) && el.scrollWidth > el.clientWidth + 1);
}

/** Bewegt diese Stelle etwas im Overlay? */
function movesSomething(target: EventTarget | null): boolean {
	let el = target instanceof Element ? target : null;
	while (el && el !== document.body) {
		if (el.matches('input, textarea, select') || scrolls(el)) return true;
		el = el.parentElement;
	}
	return false;
}

function hold(e: Event) {
	if (!e.cancelable || (e as TouchEvent).touches?.length > 1) return;
	if (!movesSomething(e.target)) e.preventDefault();
}

/** Sperrt die Seite; die zurückgegebene Funktion gibt sie wieder frei */
export function lockScroll(): () => void {
	if (++holders === 1) {
		document.addEventListener('touchmove', hold, { passive: false });
		document.addEventListener('wheel', hold, { passive: false });
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--holders === 0) {
			document.removeEventListener('touchmove', hold);
			document.removeEventListener('wheel', hold);
		}
	};
}
