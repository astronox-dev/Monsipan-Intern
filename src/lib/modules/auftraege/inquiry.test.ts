import { describe, expect, it } from 'vitest';
import { companyDomain, guessFromEmail, readWebsiteInquiry, websiteInquiryText } from './inquiry';

describe('guessFromEmail', () => {
	it('liest Kopfzeilen aus Outlook', () => {
		const g = guessFromEmail(
			[
				'Von: Muster, Max <max.muster@strabag.com>',
				'Gesendet: Mittwoch, 7. Oktober 2026 09:12',
				'An: office@monsipan.com',
				'Betreff: AW: Bodenmarkierung Parkplatz Süd',
				'',
				'Sehr geehrte Damen und Herren,',
				'bitte um ein Angebot für 400 lfm Leitlinie.',
				'',
				'Mit freundlichen Grüßen',
				'Max Muster',
				'Tel.: +43 664 123 45 67'
			].join('\n')
		);
		expect(g).toEqual({ subject: 'Bodenmarkierung Parkplatz Süd', name: 'Muster, Max', email: 'max.muster@strabag.com', phone: '+43 664 123 45 67' });
	});

	it('überspringt die eigene Adresse bei Weiterleitungen', () => {
		const g = guessFromEmail(
			[
				'Von: Office Monsipan <office@monsipan.com>',
				'Betreff: WG: Anfrage Markierung',
				'Tel. 01/706 2006 – Monsipan',
				'',
				'-----Ursprüngliche Nachricht-----',
				'From: "Anna Bau" [mailto:anna@baufirma.at]',
				'Subject: Anfrage Markierung',
				'Mobil 0699 11 22 33 44'
			].join('\n')
		);
		expect(g.email).toBe('anna@baufirma.at');
		expect(g.name).toBe('Anna Bau');
		expect(g.subject).toBe('Anfrage Markierung');
		expect(g.phone).toBe('0699 11 22 33 44');
	});

	it('nimmt ohne Kopfzeilen den Namen unter dem Gruß', () => {
		const g = guessFromEmail('Hallo,\nwir brauchen neue Parkplatzmarkierungen.\n\nLG\nPeter Huber\npeter@huber-bau.at');
		expect(g.name).toBe('Peter Huber');
		expect(g.email).toBe('peter@huber-bau.at');
		expect(g.subject).toBe('');
	});

	it('hält Datum und IBAN nicht für Telefonnummern', () => {
		const g = guessFromEmail('Termin am 08.10.2026\nIBAN AT47 1200 0006 1620 5407');
		expect(g.phone).toBe('');
	});

	it('kommt mit leerem Text zurecht', () => {
		expect(guessFromEmail('')).toEqual({ subject: '', name: '', email: '', phone: '' });
	});
});

describe('companyDomain', () => {
	it('liefert die Firmen-Domain, bei Freemail nichts', () => {
		expect(companyDomain('max@Strabag.com')).toBe('strabag.com');
		expect(companyDomain('max@gmail.com')).toBe('');
		expect(companyDomain('kaputt')).toBe('');
	});
});

describe('Kontaktformular der Webseite', () => {
	const form = { name: ' Max  Muster ', company: 'Gemeinde Schwechat', email: 'max@schwechat.gv.at', phone: '01 234 56', topic: 'Bodenmarkierung', message: 'Guten Tag,\r\nbitte um ein Angebot.' };

	it('prüft und bereinigt die Felder', () => {
		const w = readWebsiteInquiry(form);
		expect(w).toEqual({ ...form, name: 'Max Muster', message: 'Guten Tag,\nbitte um ein Angebot.' });
		expect(readWebsiteInquiry({ ...form, email: 'kaputt' })).toMatch(/E-Mail/);
		expect(readWebsiteInquiry({ ...form, message: '  ' })).toMatch(/Nachricht/);
		expect(readWebsiteInquiry({ ...form, name: 42 })).toMatch(/kein Text/);
		expect(readWebsiteInquiry(null)).toBe('Keine Daten');
		// Optionales darf fehlen
		expect(readWebsiteInquiry({ name: 'A', email: 'a@b.at', message: 'x' })).toMatchObject({ company: '', phone: '', topic: '' });
	});

	it('Betreff aus dem Thema, sonst aus der ersten Zeile', () => {
		const w = readWebsiteInquiry(form);
		if (typeof w === 'string') throw new Error(w);
		const t = websiteInquiryText(w);
		expect(t.subject).toBe('Bodenmarkierung');
		expect(t.body).toBe(
			'Anfrage über das Kontaktformular auf monsipan.at\nName: Max Muster\nFirma: Gemeinde Schwechat\nE-Mail: max@schwechat.gv.at\nTelefon: 01 234 56\nThema: Bodenmarkierung\n\nGuten Tag,\nbitte um ein Angebot.'
		);
		const long = 'Wir brauchen für die neue Wohnhausanlage in der Hauptstraße eine komplette Markierung der Tiefgarage mit Stellplatznummern';
		expect(websiteInquiryText({ ...w, topic: 'Sonstiges', message: `\n${long}` }).subject).toBe(
			'Wir brauchen für die neue Wohnhausanlage in der Hauptstraße eine komplette …'
		);
		expect(websiteInquiryText({ ...w, topic: '', company: '', phone: '' }).body).not.toMatch(/Firma|Telefon|Thema/);
	});
});
