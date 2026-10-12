import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '$env/dynamic/private';
import { APP_NAME } from '$lib/app';
import { reportDateLabel } from '$lib/modules/tagesberichte/sheet';

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
	return Boolean(env.SMTP_HOST);
}

export function mailInfo() {
	return {
		configured: isMailConfigured(),
		host: env.SMTP_HOST ?? '',
		from: env.MAIL_FROM ?? env.SMTP_USER ?? ''
	};
}

function getTransporter(): Transporter | null {
	if (!isMailConfigured()) return null;
	transporter ??= nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: Number(env.SMTP_PORT || 587),
		secure: env.SMTP_SECURE === 'true' || env.SMTP_PORT === '465',
		auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
	});
	return transporter;
}

interface Mail {
	to: string | string[];
	subject: string;
	text: string;
	html: string;
}

/** Ohne SMTP-Konfiguration landet die Mail im Server-Log statt im Postfach. */
export async function sendMail(mail: Mail): Promise<boolean> {
	const t = getTransporter();
	const to = Array.isArray(mail.to) ? mail.to.join(', ') : mail.to;
	if (!t) {
		console.info(`[mail] SMTP nicht eingerichtet – Mail an ${to}: ${mail.subject}\n${mail.text}\n`);
		return false;
	}
	try {
		await t.sendMail({
			from: env.MAIL_FROM || env.SMTP_USER,
			to,
			subject: mail.subject,
			text: mail.text,
			html: mail.html
		});
		return true;
	} catch (err) {
		console.error('[mail] Versand fehlgeschlagen:', err);
		return false;
	}
}

/* ------------------------------------------------------------- Vorlagen */

const esc = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Grundgerüst jeder Mail; brand steht klein über dem Titel (für Kunden der Firmenname statt des App-Namens) */
function layout(title: string, body: string, brand: string = APP_NAME): string {
	return `<!doctype html><html lang="de"><body style="margin:0;background:#f3f4f5;font-family:Segoe UI,Arial,sans-serif;color:#1d2127">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e5e8">
<tr><td style="height:6px;background:repeating-linear-gradient(90deg,#f8f000 0 28px,transparent 28px 44px);background-color:#1d2127"></td></tr>
<tr><td style="padding:28px 28px 8px"><div style="font-size:13px;color:#5c626b">${esc(brand)}</div>
<h1 style="margin:6px 0 0;font-size:22px;line-height:1.3">${esc(title)}</h1></td></tr>
<tr><td style="padding:12px 28px 28px;font-size:15px;line-height:1.6">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
	return `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#f8f000;color:#1d2127;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px">${esc(label)}</a></p>`;
}

export function passwordResetMail(to: string, name: string, link: string): Mail {
	return {
		to,
		subject: `Passwort zurücksetzen – ${APP_NAME}`,
		text: `Hallo ${name},\n\nüber diesen Link legst du ein neues Passwort fest (gültig 60 Minuten):\n${link}\n\nWenn du das nicht angefordert hast, kannst du diese Mail ignorieren.`,
		html: layout(
			'Neues Passwort festlegen',
			`<p>Hallo ${esc(name)},</p><p>über den Button legst du ein neues Passwort fest. Der Link ist 60 Minuten gültig.</p>${button(link, 'Passwort festlegen')}<p style="color:#5c626b;font-size:13px">Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren.</p>`
		)
	};
}

export function inviteMail(to: string, name: string, username: string, link: string): Mail {
	return {
		to,
		subject: `Dein Zugang zu ${APP_NAME}`,
		text: `Hallo ${name},\n\nfür dich wurde ein Zugang angelegt. Benutzername: ${username}\nLege über diesen Link dein Passwort fest (gültig 7 Tage):\n${link}`,
		html: layout(
			'Dein Zugang ist bereit',
			`<p>Hallo ${esc(name)},</p><p>für dich wurde ein Zugang angelegt. Dein Benutzername ist <strong>${esc(username)}</strong>.</p>${button(link, 'Passwort festlegen')}<p style="color:#5c626b;font-size:13px">Der Link ist 7 Tage gültig.</p>`
		)
	};
}

export function customerReportMail(
	to: string,
	report: { number: string; date: string; dateTo: string | null; road: string; site: string; signed: boolean },
	link: string
): Mail {
	const what = [`Tagesbericht${report.number ? ` Nr. ${report.number}` : ''} vom ${reportDateLabel(report.date, report.dateTo)}`, report.road && `Bundesstraße ${report.road}`, report.site]
		.filter(Boolean)
		.join(', ');
	const ask = report.signed
		? 'über den folgenden Link können Sie den unterschriebenen Tagesbericht jederzeit ansehen und als PDF herunterladen.'
		: 'über den folgenden Link können Sie den Tagesbericht ansehen, mit Ihrem Namen unterschreiben und danach als PDF herunterladen.';
	return {
		to,
		subject: `${report.signed ? 'Unterschriebener ' : ''}${what.split(',')[0]} – Monsipan`,
		text: `Guten Tag,\n\n${ask}\n\n${what}\n${link}\n\nDer Link bleibt gültig – Sie können den Bericht jederzeit wieder öffnen, drucken oder herunterladen.\n\nMit freundlichen Grüßen\nMonsipan Bautenschutz`,
		html: layout(
			report.signed ? 'Ihr unterschriebener Tagesbericht' : 'Tagesbericht zum Unterschreiben',
			`<p>Guten Tag,</p><p>${esc(ask)}</p><p style="font-weight:600">${esc(what)}</p>${button(link, report.signed ? 'Bericht öffnen' : 'Bericht ansehen und unterschreiben')}<p style="color:#5c626b;font-size:13px">Der Link bleibt gültig – Sie können den Bericht jederzeit wieder öffnen, drucken oder herunterladen.</p><p>Mit freundlichen Grüßen<br>Monsipan Bautenschutz</p>`,
			'Monsipan Bautenschutz'
		)
	};
}

/** Angebot an den Kunden: ansehen, annehmen oder Änderungen wünschen */
export function customerOfferMail(to: string, offer: { number: string; title: string; accepted: boolean }, link: string): Mail {
	const what = `Angebot Nr. ${offer.number}${offer.title ? ` – ${offer.title}` : ''}`;
	const ask = offer.accepted
		? 'über den folgenden Link können Sie das angenommene Angebot jederzeit ansehen und als PDF herunterladen.'
		: 'über den folgenden Link können Sie unser Angebot ansehen, mit Ihrem Namen und Ihrer Unterschrift annehmen oder uns Änderungswünsche schicken.';
	return {
		to,
		subject: `${what} – Monsipan`,
		text: `Guten Tag,\n\n${ask}\n\n${what}\n${link}\n\nDer Link bleibt gültig – Sie können das Angebot jederzeit wieder öffnen oder herunterladen.\n\nMit freundlichen Grüßen\nMonsipan Bautenschutz`,
		html: layout(
			offer.accepted ? 'Ihr angenommenes Angebot' : 'Unser Angebot für Sie',
			`<p>Guten Tag,</p><p>${esc(ask)}</p><p style="font-weight:600">${esc(what)}</p>${button(link, offer.accepted ? 'Angebot öffnen' : 'Angebot ansehen')}<p style="color:#5c626b;font-size:13px">Der Link bleibt gültig – Sie können das Angebot jederzeit wieder öffnen oder herunterladen.</p><p>Mit freundlichen Grüßen<br>Monsipan Bautenschutz</p>`,
			'Monsipan Bautenschutz'
		)
	};
}

/**
 * Info-Mail zu einer Benachrichtigung: Ereignis klein darüber, Titel, Text und
 * ein Knopf ins Portal. Wer sie bekommt, steht unter Verwaltung →
 * Benachrichtigungen; abschalten kann man sie unter „Mein Konto".
 */
export function infoMail(to: string, info: { event: string; title: string; body: string; link: string | null }): Mail {
	const lines = info.body.trim();
	return {
		to,
		subject: info.title,
		text: [info.title, lines, info.link ? `Öffnen: ${info.link}` : '', `${APP_NAME} · Info-Mail „${info.event}". Abschalten unter Mein Konto.`]
			.filter(Boolean)
			.join('\n\n'),
		html: layout(
			info.title,
			`${lines ? `<p style="white-space:pre-line">${esc(lines)}</p>` : ''}${info.link ? button(info.link, 'Im Portal öffnen') : ''}<p style="margin-top:20px;color:#5c626b;font-size:13px">Info-Mail „${esc(info.event)}". Welche Info-Mails du bekommst, kannst du unter „Mein Konto“ einzeln abschalten.</p>`,
			`${APP_NAME} · Info`
		)
	};
}

export function testMail(to: string): Mail {
	return {
		to,
		subject: `Test-Mail – ${APP_NAME}`,
		text: 'Der E-Mail-Versand funktioniert.',
		html: layout('Der E-Mail-Versand funktioniert', '<p>Info-Mails und Passwort-Links werden ab jetzt zugestellt.</p>')
	};
}
