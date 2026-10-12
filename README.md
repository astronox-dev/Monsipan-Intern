# Monsipan Portal

Die interne Anwendung von Monsipan Bautenschutz: alle Bereiche des Betriebs in einer
Oberfläche, auf dem Handy wie am PC. Die übrigen Bereiche kommen nach und nach dazu.

| Bereich | Stand |
|---|---|
| Übersicht | fertig – „Zu erledigen“ und Kennzahlen aus allen Bereichen, je nach Berechtigung |
| Auftragsmanagement | fertig – Anfragen, Angebote mit Kundenlink, Aufträge (Partie freiwillig), Summenblatt, Rechnungen (archiviert, PAdES-signiert, mit Prüfcode), Kunden |
| Dokumentation: Stundenzettel | fertig – Lohnwoche je Mitarbeiter, Freigabe und Prüfung |
| Dokumentation: Tagesberichte | fertig – Leistung je Tag und Baustelle, Freigabe, Prüfung, Unterschrift des Kunden |
| Planung | fertig – Wochenplanung je Partie und Tag mit Notizliste, Urlaubsanträge, Krankenstand mit Krankmeldung |
| Lagermanagement | fertig – Bestand, Buchen, Inventur, Bewegungen, Bestellliste, Berichte, Artikel |
| Benutzer | fertig – Zugänge, Gruppen, Berechtigungen |
| Administration | fertig – Stammdaten, Einstellungen, Sicherungen |
| Partien | geplant |
| Bestellungen, Dokumente, Auswertungen | geplant |

**Übersicht** (`/`): Oben **Zu erledigen** – was gerade ansteht, das Dringendste zuerst:
überfällige Rechnungen, abgeschlossene Aufträge mit noch nicht Abgerechnetem, Änderungswünsche und
angenommene Angebote ohne Auftrag, Anfragen ohne Angebot, Tagesberichte zum Prüfen oder
Freigeben, Stundenzettel zum Prüfen bzw. aus der Vorwoche noch offen, neue Aufträge der
Partie, Artikel zum Nachbestellen. Darunter je Bereich die Kennzahlen – Auftragsmanagement
(Anfragen, Angebote beim Kunden, Aufträge in Arbeit, offene Rechnungen, laufende Aufträge),
Dokumentation (Tagesberichte der Woche, Stundenzettel der Woche bzw. der eigene) und Lager.
Jeder sieht nur, was er auch öffnen darf – ein Partieführer etwa die Aufträge und Berichte
seiner Partie, keine Preise. Jeder Punkt führt in die passende, schon gefilterte Liste.

Welche Bereiche es gibt und welche davon freigeschaltet sind, steht an einer Stelle:
[`src/lib/modules.ts`](src/lib/modules.ts). Ein neuer Bereich bekommt dort einen Eintrag,
seine Seiten unter `src/routes/(app)/<bereich>/` und seinen Code unter
`src/lib/modules/<bereich>/`.

## Lagermanagement

Lagerverwaltung für die Bodenmarkierung: Bestand je Lagerort, Ein-/Ausbuchen per Scan,
Umlagern, Rückgaben, Inventur, Bestellliste mit Warn-Mails und Auswertungen.

- **Scannen** mit USB-/Bluetooth-Handscanner am PC oder mit der Handykamera
  (EAN, GTIN-14, Code 128, GS1, die Kansai-DataMatrix mit `bez:`/`art:`/`inh:` … und SWARCO-Palettenetiketten)
- **Handy und PC**, als App installierbar: Android-App zum Herunterladen oder als Web-App, Hell- und Dunkelmodus
- **Live**: Buchungen auf einem Gerät erscheinen sofort auf allen anderen
- **Drucken**: Bestand und Bewegungen aufs Papier, mit Zählspalte für die Inventur
- **Ein Container** plus Caddy für HTTPS, Datenbank ist eine einzige SQLite-Datei

**Inventur:** Ein eigener Bereich neben Buchen. Lagerort wählen, dann stehen alle Artikel
mit Bestand dort als Zählliste bereit: links der Bestand laut System, daneben ein Feld für die
gezählte Menge, rechts die Abweichung. **Alle übernehmen** füllt alle leeren Felder mit dem
Systembestand – praktisch, wenn nur wenige Zeilen abweichen. Gescannte Artikel springen in die
Liste und zählen je Scan ein Stück hoch; was am Lagerort gar nicht geführt wird, hängt sich
beim Scannen unten an. Gebucht wird nur, was eingetragen ist – jede gezählte Zeile wird als
Inventur-Buchung festgehalten, auch wenn sie stimmt.

---

## Inhalt

0. [Bereiche und Adressen](#bereiche-und-adressen)
1. [Rollen](#rollen)
2. [Stundenzettel](#stundenzettel)
3. [Tagesberichte](#tagesberichte)
4. [Auftragsmanagement](#auftragsmanagement)
5. [Benachrichtigungen](#benachrichtigungen)
5. [Lokale Entwicklung](#lokale-entwicklung)
3. [Betrieb auf dem Server](#betrieb-auf-dem-server)
4. [Datensicherung](#datensicherung)
5. [Alles zurücksetzen](#alles-zurücksetzen)
6. [Drucken, PDF und CSV](#drucken-pdf-und-csv)
7. [Materialbeschreibungen (PDF)](#materialbeschreibungen-pdf)
8. [App fürs Handy](#app-fürs-handy)
9. [Scanner einrichten](#scanner-einrichten)
10. [Technik und Projektstruktur](#technik-und-projektstruktur)

---

## Bereiche und Adressen

Jeder Bereich hat seinen eigenen Pfad. Das Lager liegt unter `/lager/…`, Benutzer und
Administration unter `/verwaltung/…`:

| Seite | Adresse |
|---|---|
| Übersicht | `/` |
| Stundenzettel | `/stundenzettel` |
| Tagesberichte | `/tagesberichte` |
| Wochenplanung, Urlaub, Krankenstand | `/planung` (`?woche=JJJJ-MM-TT`), `/urlaub`, `/krankenstand` |
| Tagesbericht für den Kunden (ohne Anmeldung) | `/bericht/<link>` |
| Anfragen, Angebote, Aufträge, Rechnungen, Kunden | `/anfragen`, `/angebote`, `/auftraege`, `/rechnungen`, `/kunden` |
| Summenblatt eines Auftrags bzw. einer Rechnung | `/auftraege/<id>/summenblatt`, `/rechnungen/<id>/summenblatt` |
| Angebot für den Kunden (ohne Anmeldung) | `/angebot/<link>` |
| Prüfseite einer Rechnung, hinter dem QR-Code (ohne Anmeldung) | `/pruefen/<schlüssel>` |
| Rechnungssignatur (Einstellungen) | `/verwaltung/einstellungen/signatur` |
| Import und Export (Kunden, Anfragen, Angebote, Aufträge, Rechnungen) | `/verwaltung/import` |
| Handschrift auf dem Formular | `/tagesberichte/<id>/handschrift`, `/stundenzettel/<id>/handschrift` |
| Bestand, Buchen, Bewegungen, Bestellliste, Berichte | `/lager/bestand` usw. |
| Inventur | `/lager/inventur` |
| Artikel | `/lager/artikel/<id>` |
| Scanner testen | `/lager/scanner-test` |
| Stammdaten, Benutzer, Einstellungen, Benachrichtigungen | `/verwaltung/…` |
| Eigene Benachrichtigungen (Glocke) | `/benachrichtigungen` |

Die alten Adressen (`/bestand`, `/buchen`, `/artikel/5`, `/benutzer` …) leiten dauerhaft
auf die neuen weiter – gespeicherte Lesezeichen und Verknüpfungen am Handy funktionieren
weiter. Die Weiterleitung steht in [`src/hooks.server.ts`](src/hooks.server.ts).

## Rollen

| Rolle | Darf |
|---|---|
| Admin | alles, zusätzlich Benutzer, Berechtigungen und Einstellungen |
| Geschäftsführer | sieht und prüft alles – von Haus aus alles, was Bauleitung oder Buchhaltung dürfen; Benutzer, Berechtigungen und Einstellungen bleiben beim Admin |
| Bauleiter | buchen, Inventur, Korrekturen, Artikel und Stammdaten pflegen, Berichte, Stunden und Tagesberichte |
| Buchhaltung/Sekretariat | Stundenzettel und Tagesberichte prüfen, Anfragen, Angebote, Aufträge und Rechnungen schreiben, Rechnungen als bezahlt markieren, Stammdaten pflegen – ohne Lagerbuchungen |
| Partieführer | Bestand und Bewegungen ansehen, buchen, Stundenzettel und Tagesberichte der eigenen Partie |
| Arbeiter | wie Partieführer, sieht aber keine Bewegungen (weder Liste noch Verlauf am Artikel) |
| Nur ansehen | alles ansehen außer Stammdaten, Benutzer und Einstellungen – keine Änderungen |

**Partieführer und Arbeiter** gehören immer zu einer Partie (Pflichtfeld unter Benutzer).
**Admin, Geschäftsführer, Bauleiter und Buchhaltung** können einer Partie angehören, wenn
sie dort mitarbeiten – dann stehen sie auch bei den Stundenzetteln dieser Partie.
Beim Ausbuchen („Ausgabe an“) und bei Rückgaben („Zurück von“) ist die eigene Partie vorausgewählt.
Wer zu keiner Partie gehört, bucht standardmäßig auf sich selbst – in der Bewegungsliste
steht dann der eigene Name. Eine Partie lässt sich jederzeit auswählen.

**Benutzerliste:** Unter **Verwaltung → Benutzer** stehen die Zugänge nach Gruppen
(Admin, Geschäftsführer, … in der Reihenfolge der Rollen), deaktivierte gesammelt am Ende.
Je Person steht, wann sie die App **zuletzt geöffnet** hat – ein grüner Punkt heißt „gerade
aktiv“ (in den letzten 10 Minuten). Gezählt wird jeder Seitenaufruf, gespeichert höchstens
alle 5 Minuten; Konten, die seit dieser Anzeige noch nicht da waren, zeigen ihre letzte
Anmeldung. Oben und je Gruppe steht, wie viele heute schon da waren.

**Benutzer löschen:** Wer nie gebucht hat, wird vollständig entfernt. Wer schon gebucht hat,
kann sich danach nicht mehr anmelden und verschwindet aus der Liste; der Name bleibt in der
Historie erhalten, Benutzername und E-Mail werden frei.

**Inhaber:** Genau ein Konto ist Inhaber – zu Beginn der erste Admin. Nur der Inhaber darf
Admins löschen, deaktivieren oder herabstufen; alle übrigen Benutzer verwaltet jeder Admin
wie bisher, und das Passwort eines anderen Admins darf auch jeder Admin zurücksetzen –
nur beim Inhaber-Konto nicht. Das Inhaber-Konto selbst kann niemand löschen,
deaktivieren oder herabstufen, auch der Inhaber nicht. Unter **Benutzer → Inhaber-Konto**
lässt sich die Inhaberschaft mit Passwortbestätigung an einen anderen aktiven Admin
übergeben; der bisherige Inhaber bleibt Admin. Beim Zurücksetzen aller Daten bleibt das
Inhaber-Konto immer erhalten. Die Regeln stehen in
[`src/lib/user-rules.ts`](src/lib/user-rules.ts).

**Berechtigungen:** Was eine Gruppe darf, steht unter **Verwaltung → Berechtigungen**. Oben
wählt man die Gruppe, darunter steht je Bereich eine Karte mit denselben Zeilen – Stufen
und Ja/Nein als Umschalter, die Status-Schritte als Knöpfe zum An- und Abwählen. Bereiche
ohne *Sehen* bleiben zugeklappt („Kein Zugriff“). Was noch nicht gespeichert ist, steht als
„Geändert“ an der Karte und als Punkt an der Gruppe; erst dann erscheint die Leiste mit
**Änderungen speichern** und **Verwerfen**. Die Ansicht **Vergleich** zeigt alle Gruppen
nebeneinander: je Bereich die Stufe beim Sehen und kleine Felder für Erstellen, Bearbeiten,
Status und Löschen (dunkel = ganz, gelb = teilweise); ein Klick springt zur Karte der Gruppe.

| Zeile | Bedeutung |
|---|---|
| **Sehen** | Den Bereich überhaupt öffnen. Bei Stundenzetteln, Tagesberichten und Aufträgen in Stufen: *Nein*, *Eigene Partie* oder *Alle* (Tagesberichte: auch die selbst angelegten); bei Stundenzetteln zusätzlich *Nur eigene* |
| **Erstellen** | Neu anlegen – im Lager heißt das *Buchen* |
| **Bearbeiten** | Ändern – bei Stundenzetteln in Stufen (eigene Partie / alle), bei Bewegungen *Korrigieren* (stornieren und neu buchen) |
| **Status** | Die Schritte des Bereichs, je ein Haken: z. B. Freigeben, Prüfen, Wieder öffnen, Link an den Kunden, Inventur, In Arbeit/abgeschlossen |
| **Löschen** | Wo es Löschen gibt. Bei Angeboten und Aufträgen in Stufen: nur in Arbeit bzw. nur neue – oder alle |

Bereiche: Bestand, Bewegungen, Artikel, Berichte und Bestellliste, Warnungen,
Stundenzettel, Tagesberichte, Anfragen, Angebote, Aufträge, Rechnungen, Kunden, Stammdaten, Benutzer,
Berechtigungen, Einstellungen. Wer in einem Bereich etwas darf, darf ihn auch sehen – das
wird beim Anhaken gleich mit gesetzt. Ohne *Bearbeiten* oder *Löschen* zeigen Stammdaten,
Benutzer, Kunden und Einstellungen alles nur zum Ansehen.

Änderungen gelten sofort, auch für bereits angemeldete Geräte. Die ausgelieferten
Standardrechte stehen in [`src/lib/permissions.ts`](src/lib/permissions.ts); ein neuer
Bereich bringt seine Zeile dort mit (`PERMISSION_AREAS`), und fehlende Rechte werden beim
Start automatisch ergänzt. Mit **Auf Standard zurücksetzen** geht es jederzeit zurück. Ein
paar Haken sind fest: Benutzer, Berechtigungen und Einstellungen sehen und bearbeiten bleibt
beim Admin, damit sich niemand aussperrt. Beim Umstieg auf diese Einteilung wurden die
bisherigen Einstellungen übernommen (Migration `0028_rechte_einheitlich`).

## Stundenzettel

Eine Woche je Mitarbeiter, aufgebaut wie der Lohnzettel auf Papier: Montag bis Sonntag mit
Kostenstelle, Baustelle/Tätigkeit, Arbeitszeit und den Stundenarten Norm, Überstunden 50 %
und 100 %, Urlaub, Feiertag, Regen und Efzg (Entgeltfortzahlung). Dazu Auslöse (Tage und
Betrag) und VAZ mit Prozentsatz. Die Summen je Spalte und die Gesamtstunden rechnet die
Seite mit, während getippt wird.

**Wochenübersicht:** nach Partien gegliedert – die eigene Partie zuerst, „Ohne Partie“
zuletzt. Maßgeblich ist die Partie, die den Zettel schreibt: Eine übernommene Aushilfe
steht bei der Partie, die sie übernommen hat, mit dem Zusatz „Aushilfe aus …“.

**Arbeitszeit:** je Tag beliebig viele Zeiten von **Beginn** bis **Ende** – mit **+ Zeit**
kommt eine dazu, mit × fällt eine weg (z. B. 07:00 – 13:00 und 18:00 – 04:00). Pausen
sind einfach die Lücken dazwischen. Endet eine Zeit vor ihrem Beginn, geht sie über
Mitternacht. Die Summe trägt die Seite als Norm-Stunden ein. Überstunden und die anderen
Stundenarten trägt man selbst ein; wer die Norm-Stunden von Hand ändert, behält seinen
Wert. Uhrzeiten dürfen auch als `0630` oder `6.30` getippt werden, Stunden als `8,5` oder
`8:30`. Ausdruck und PDF schreiben alle Zeiten in die Zeile „Zeit von/bis“; bei vielen
wird die Schrift kleiner. Eine Kostenstelle mit „/“ steht dort in zwei Zeilen: alles nach
dem ersten „/“ darunter (`24117/Halle 3` → `24117/` und `Halle 3`).

**Monatlich getrennt:** Der Lohn wird monatsweise abgerechnet, deshalb endet ein
Stundenzettel immer am Monatsende. Geht eine Woche über den Monatswechsel, gibt es zwei
Zettel – einen je Monat, jeder mit den Tagen, die in diesen Monat fallen. Die
Wochenübersicht zeigt dann je Monat einen Tab – gewählt ist der laufende Monat, sonst der
erste; der Tab steht in der Adresse (`&monat=JJJJ-MM`), der Weg zurück aus dem Zettel
landet also wieder im richtigen. Im Zettel führt ein Link zum anderen Teil. Ausdruck und PDF zeigen trotzdem alle sieben Tageszeilen wie der Vordruck;
die Tage des anderen Monats bleiben leer.

**Wer was sieht:** Ein Partieführer sieht und bearbeitet standardmäßig nur die Zettel
seiner eigenen Partie. Unter **Verwaltung → Berechtigungen** steht dafür bei Stundenzettel
**Sehen** auf *Nein*, *Nur eigene*, *Eigene Partie* oder *Alle* und **Bearbeiten** auf
*Eigene Partie* oder *Alle*. *Nur eigene* heißt: nur den eigenen Zettel ansehen, ohne etwas
daran zu ändern – so steht es von Haus aus bei Arbeitern und „Nur ansehen“. Bauleitung und
Admin sehen und bearbeiten alle, die Buchhaltung sieht alle. Bei *Nein* fehlen die
Stundenzettel in der Navigation ganz.

**Keine Stundenzettel:** Konten, die keine Stunden schreiben – etwa Admin- oder
Büro-Konten –, bekommen unter **Benutzer** das Häkchen **Keine Stundenzettel**. Sie fehlen
dann in der Wochenliste, und für sie wird kein Zettel angelegt. Gibt es für eine Woche
schon einen Zettel, bleibt er sichtbar, damit keine Stunden verloren gehen.

**Aushilfe aus einer anderen Partie:** Den Zettel einer Woche schreibt der Partieführer,
bei dem der Arbeiter die meisten Tage war – und zwar für die ganze Woche, auch für die
Tage bei der anderen Partie. War er mehr Tage bei einer fremden Partie, übernimmt deren
Partieführer die Woche über **Aushilfe übernehmen** in der Wochenliste. Was die eigene
Partie schon eingetragen hat, bleibt stehen; sie sieht den Zettel danach nur noch, mit
dem Hinweis, wer ihn schreibt. Geht die Woche über den Monatswechsel, werden beide
Monatsteile übernommen. Solange die Woche in Arbeit ist, lässt sie sich mit **Woche
zurückgeben** wieder abgeben. Wer übernehmen darf, regelt das Recht **Aushilfen
übernehmen** (standardmäßig Partieführer, Bauleitung und Admin, jeweils mit eigener
Partie).

**Ablauf:** In Arbeit → freigegeben → geprüft.

- Der **Partieführer** erfasst die Woche und gibt sie frei. Beim Freigeben unterschreibt er
  mit Finger, Stift oder Maus; die Unterschrift steht danach auf Ausdruck und PDF in der
  Zeile „Unterschrift Vorarbeiter", mit Name und Datum. Freigeben ohne Unterschrift geht
  auch. Noch nicht gespeicherte Eingaben werden beim Freigeben mitgespeichert. Danach kann
  der Partieführer die Woche weder ändern noch selbst wieder öffnen.
- **Buchhaltung und Bauleitung** prüfen und unterschreiben dabei – ohne Unterschrift geht
  das Prüfen nicht. Die Unterschrift steht mit Name und Datum beim Feld „überprüft"; danach
  ist die Woche zu.
- **Zurück auf freigegeben** (nach Rückfrage) nimmt nur die Prüfung zurück: Die
  Prüf-Unterschrift verfällt, die Freigabe samt Unterschrift bleibt.
- **Wieder öffnen** (nach Rückfrage) macht die Woche erneut änderbar. Die Unterschriften
  verfallen, weil sich der Inhalt danach noch ändern kann.

Wer zurücksetzen darf, steht unter **Verwaltung → Berechtigungen** bei Stundenzettel in der
Spalte Status: **Freigegebene öffnen**, **Geprüfte öffnen** und **Prüfung zurücknehmen**.
Standardmäßig haben sie Admin, Bauleitung und Buchhaltung.

**Drucken** und **PDF** geben das Blatt im Aufbau des Vordrucks aus. Die Unterschriften
liegen als Linienzug vor und bleiben in jeder Größe scharf.

## Tagesberichte

Ein Bericht je Tag und Baustelle, wie der Block im Auto: Nummer, Datum, Bundesstraße,
Baustelle und Kostenstelle im Kopf, darunter beliebig viele LB-Positionen mit Einheit
(**LB-Pos. hinzufügen**) und beliebig viele Zeilen „Ortsbezeichnungen und Markierungsarten"
mit den Mengen je Position. Die Einheitssumme je Spalte wird mitgerechnet, die Gesamtmenge
wird von Hand eingetragen. Dazu Tagesleistung und LV-Position Nr.

**Material:** Je Zeile wird ein Artikel aus dem Lager gewählt – Material (die Farbe, ohne
Farbe die Materialart) und Kenn-Nr. (der Artikelname) füllen sich selbst aus, einzutragen
bleibt nur die Filmdicke (frei, auch mit Text wie „0,6 nass“). Ohne Artikel lässt sich alles
von Hand eintragen.

Die Nummer schlägt die App als nächste freie vor, bleibt aber frei änderbar – so passt sie
zum Papierblock.

**Auftrag:** Ein Bericht kann zu einem Auftrag gehören (siehe [Auftragsmanagement](#auftragsmanagement)).
Zur Auswahl stehen die offenen Aufträge, die man sieht – der Partie also die eigenen.

**Bezeichnung aus dem Auftrag:** Gehört der Bericht zu einem Auftrag mit Positionen, wählt man
die Bezeichnung jeder Zeile aus dessen Positionen („1.1 RRL 0,15 MSK C ref“ …) statt sie zu
tippen. Gespeichert wird die erste Zeile des Positionstexts – genau so findet die Rechnung
später die richtige Angebotsposition, und gleiche Positionen aus allen Berichten zählen
zusammen. Für den Notfall gibt es **Sonstiges (frei eingeben)**: Die Zeile wird zum Textfeld,
mit dem Listen-Knopf daneben geht es zurück zur Auswahl. Ältere Bezeichnungen, die keiner
Position entsprechen, bleiben als freier Text stehen.

**Mehrere Tage:** Neben dem Datum gibt es ein freiwilliges **bis**. Ist es ausgefüllt, steht im
Bericht „vom 07.10. bis 09.10.2026" (höchstens 62 Tage). Der Zeitfilter der Liste findet so
einen Bericht an jedem seiner Tage.

**Fotos** (nur intern – nicht im Bericht-PDF und nicht beim Kunden): Am Handy oder Tablet
direkt mit der Kamera aufnehmen (**Foto aufnehmen**) oder aus der Galerie wählen, am Computer
hochladen. In der Android-App öffnet sich dafür eine Kamera in der Seite (das Dateifeld der
App-Hülle kommt dort nicht an die Kamera); sie bleibt offen, bis man **Fertig** tippt, und lädt
jedes Foto gleich hoch. Vor dem Hochladen werden die Bilder am Gerät verkleinert (JPEG, lange
Seite 2400 Pixel, dazu eine kleine Vorschau) – das schont das Datenvolumen auf der Baustelle.
Antippen öffnet ein Foto groß, wischen oder die Pfeiltasten blättern.

**Fotos drucken und laden:** **Drucken** und **PDF** neben den Fotos geben alle Fotos aus – zwei
je A4-Seite, darüber Nummer, Datum und Baustelle des Berichts, darunter je Foto wer es wann
aufgenommen hat. In der Großansicht gibt es dasselbe für ein einzelnes Foto, dazu
**Herunterladen** als JPG (am iPhone über das Teilen-Menü „Bild sichern“, in der App als PDF
im Ordner „Downloads“). Hinzufügen und löschen kann, wer gerade am
Bericht arbeiten darf – auch nachdem der Kunde vor Ort unterschrieben hat, denn Fotos ändern
nichts an dem, was er unterschreibt. Höchstens 60 Fotos je Bericht.

**Ablauf** – wie beim Stundenzettel, mit dem Kunden als letztem Schritt:

1. **In Arbeit:** Die Partie füllt den Bericht aus.
2. **Freigegeben:** Der Partieführer unterschreibt beim Freigeben – die Unterschrift steht
   im Ausdruck bei „Für den Auftragnehmer". Danach kann er nichts mehr ändern.
3. **Geprüft:** Bauleitung, Buchhaltung oder Geschäftsführung prüfen; vorher dürfen sie
   noch korrigieren. Mit der Prüfung entsteht der **Link für den Kunden**.
4. **Abgeschlossen:** Der Kunde öffnet den Link, trägt seinen Namen ein und unterschreibt
   („Für den Auftraggeber"). Danach lädt er den fertigen Bericht als PDF – der Link bleibt
   dauerhaft gültig, der Bericht lässt sich darüber jederzeit wieder laden oder drucken.

**Unterschrift vor Ort:** Der Kunde kann auch schon auf der Baustelle am Gerät unterschreiben
(**Kunde unterschreibt vor Ort**, solange der Bericht noch nicht geprüft ist). Danach ist der
Inhalt gesperrt – geändert wird erst nach **Unterschrift des Kunden entfernen**. Freigeben
geht wie gewohnt; mit der Prüfung ist der Bericht dann gleich **abgeschlossen**, und der Link
entsteht trotzdem – zum Herunterladen. Im Bericht steht, ob der Kunde vor Ort oder über den
Link unterschrieben hat.

Den Link kann man kopieren, am Handy teilen (WhatsApp, Mail-App …) oder direkt aus der App
per E-Mail schicken – dafür muss der Mailversand (SMTP) eingerichtet sein. Die Seite des
Kunden (`/bericht/<link>`) zeigt den Bericht im Aufbau des Vordrucks (am Handy verkleinert, umschaltbar auf eine Liste) und braucht keine Anmeldung; der Link besteht aus 128 Bit Zufall,
wird von Suchmaschinen nicht erfasst und zeigt weder Kostenstelle noch Notiz – beides
fehlt auch im PDF für den Kunden. Ist der Bericht gerade wieder geöffnet, steht dort nur
„wird gerade überarbeitet".

**Wieder öffnen** fragt nach und hat je Stand ein eigenes Recht: freigegebene und geprüfte
Berichte standardmäßig Admin, Geschäftsführung, Bauleitung und Buchhaltung, vom Kunden
unterschriebene nur Admin und Geschäftsführung. Dabei verfallen die Unterschriften; der
Kunde unterschreibt später über denselben Link neu. **Zurück auf freigegeben** nimmt nur
die Prüfung zurück, solange der Kunde noch nicht unterschrieben hat. Alle Rechte lassen
sich unter Verwaltung → Berechtigungen anpassen.

**Drucken** und **PDF** geben den Bericht im Aufbau des Vordrucks aus: Briefkopf, Titel mit
Datum und Nummer, das Kästchen „Bundesstraße Nr.", je Blatt acht LB-Spalten und 33 Zeilen,
darunter Material, Einheitssumme, Gesamtmenge, Tagesleistung, LV-Position und die beiden
Unterschriftszeilen. Mehr Positionen oder Zeilen gehen auf weitere Blätter („Blatt 1 von 2").
Die Baustelle steht groß unter dem Briefkopf (mit Linie – am Tablet lässt sie sich auch von
Hand eintragen), die Kostenstelle klein darunter. Am Handy zeigt die Druckansicht die
Angaben untereinander.

Wer kein Recht auf „alle sehen" hat, sieht die Berichte der eigenen Partie und die selbst
angelegten.

## Planung

Drei Seiten unter **Planung** in der Seitenleiste.

**Wochenplanung** (`/planung`) – wie der Zettel im Büro: je Partie eine Spalte (mit den
Leuten darunter), je Tag eine Zeile, Montag bis Sonntag, Feiertage stehen beim Tag. In ein
Feld kommt ein **Auftrag** (die Aufträge der Partie stehen in der Auswahl oben) oder **freier
Text** wie „Stbe 1“ oder „Leitschutz?“ – oder beides, dann ist der Text ein Zusatz. Beim
Eintragen lassen sich **mehrere Tage** auf einmal ankreuzen; ein Eintrag lässt sich ändern,
auf einen anderen Tag oder zu einer anderen Partie schieben und löschen. Mit den Pfeilen geht
es eine Woche vor oder zurück.

**PDF und Drucken:** Die Woche gibt es als PDF (A4 quer, wie der Zettel – die Zeilen wachsen mit
dem Inhalt, die Notizen stehen darunter) und als Druckansicht. Jeder bekommt dabei genau das,
was er auf der Seite sieht: die Partie nur ihre Spalte, ohne Notizen.

- **Urlaub und Krankenstand** stehen von selbst im Feld der Partie: genehmigter Urlaub mit
  Palme, Krankenstand mit Thermometer. Wer Krankenstände nicht sehen darf (z. B. Arbeiter),
  sieht bei anderen nur „abwesend“.
- **An die Partien schicken:** Ist die Woche fertig, bekommt jede Partie mit Einträgen eine
  Benachrichtigung – statt bei jedem einzelnen Eintrag.
- **Nicht zugeteilte Aufträge** unten: die offenen Aufträge ohne Partie, die ältesten zuerst.
  **Einplanen** öffnet das Eintragen mit dem Auftrag – Partie und Tage wählen; die Partie
  bekommt den Auftrag damit **zugeteilt** (und eine Benachrichtigung). Das gilt genauso, wenn
  man einen nicht zugeteilten Auftrag über das Plus in einem Feld auswählt. Ein schon
  zugeteilter Auftrag bleibt bei seiner Partie – plant man ihn woanders ein, hilft die andere
  Partie nur aus. Die Liste steht auch im PDF und im Ausdruck; die Partien sehen sie nicht.
- **Notizen** unten: eine durchgehende Liste („noch einzuplanen“), unabhängig von der Woche.
  Abgehakte bleiben unter „Erledigte“ stehen und lassen sich wieder öffnen. **Die Partien sehen
  die Notizen nicht.**
- **Die Partie sieht nur ihre eigene Woche** – als Liste je Tag; Aufträge führen zum Auftrag.
  Auf der Übersicht steht für sie „Heute laut Plan“.
- Planen dürfen von Haus aus Admin, Geschäftsführung und Bauleitung; alle Partien sehen
  zusätzlich Buchhaltung und Lesezugriff.

**Urlaub** (`/urlaub`) – jeder beantragt für sich (von – bis, Notiz). Gezählt werden
**Arbeitstage**: Montag bis Freitag ohne die österreichischen Feiertage (Ostern, Pfingsten,
Fronleichnam usw. werden je Jahr berechnet). Überschneidet sich ein Antrag mit einem offenen
oder genehmigten, kommt eine Meldung.

- Die **Leitung** (Admin, Geschäftsführung, Bauleitung) genehmigt oder lehnt ab, auf Wunsch
  mit Hinweis; die Person bekommt dazu eine Benachrichtigung. Sie kann auch **für andere
  eintragen** – das gilt dann gleich als genehmigt – und Urlaub löschen.
- Ein offener Antrag lässt sich zurückziehen.
- Je Jahr: die genehmigten Tage je Person (über den Jahreswechsel zählt jeder Tag in seinem Jahr).
- Sehen: die eigenen; der Partieführer die seiner Partie; das Büro alle.

**Krankenstand** (`/krankenstand`) – melden mit „krank seit“ und, falls bekannt, „bis“ (leer
heißt noch offen). Die **Krankmeldung** kommt als Foto (am Handy direkt aufnehmen, auch in der
Android-App) oder PDF dazu – oder wird später nachgereicht. Fotos werden am Gerät verkleinert.

- Jeder meldet sich selbst; der Partieführer auch für seine Leute, das Büro für alle.
- **Die Krankmeldung sehen nur** die Person, wer gemeldet hat, und wer alle Krankenstände
  sieht (Büro). Der Partieführer sieht, dass jemand krank ist, und ob die Krankmeldung da ist.
- Ende eintragen („Gesund – Ende eintragen“), Belege ergänzen oder entfernen: die Person,
  wer gemeldet hat, und das Büro; löschen: wer gemeldet hat und das Büro.
- Auf der Übersicht sieht das Büro, wie viele Krankenstände der letzten 60 Tage noch keine
  Krankmeldung haben.
- Die Belege liegen unter `/data/krankmeldungen/` (wie Fotos und PDFs: nach dem Löschen noch
  90 Tage, damit eine eingespielte Sicherung sie findet).

Urlaub und Krankenstand landen **nicht** von selbst im Stundenzettel – die Stunden trägt man
dort weiter ein.

## Auftragsmanagement

Der Weg einer Arbeit durch den Betrieb: **Anfrage → Angebot → Auftrag → Tagesberichte →
Summenblatt → Rechnung**. In der Seitenleiste steht alles unter „Auftragsmanagement“.

**Anfragen** (`/anfragen`): Die E-Mail des Kunden mit **Neue Anfrage** hineinkopieren – am
besten ganz, mit „Von“, „Betreff“ und Signatur. Betreff, Absender, E-Mail-Adresse und Telefon
werden erkannt und vorgeschlagen (die eigene Adresse bei weitergeleiteten Mails zählt nicht);
der passende Kunde wird über die E-Mail-Adresse gesucht. In der Anfrage lässt sich der Kunde
zuordnen oder direkt aus der Anfrage neu anlegen, dazu der Ausführungsort und eine Notiz.
**Angebot erstellen** übernimmt Kunde, Betreff (als BV) und Ausführungsort; im Angebot steht
die E-Mail daneben. Ist das Angebot angenommen, ist die Anfrage **erledigt** und verschwindet
aus der Liste der offenen. Kommt kein Angebot zustande, legt man sie mit **Als erledigt
ablegen** ab. Erkannt wird nur im Browser – die E-Mail geht an keinen fremden Dienst.

**Kunden** (`/kunden`): Anschrift, UID-Nummer, E-Mail, Ansprechpartner und Telefon – einmal
anlegen, im Angebot auswählen. Ein neuer Kunde lässt sich auch direkt beim Schreiben eines
Angebots anlegen. Kunden, die schon in Angeboten stehen, werden ausgeblendet statt gelöscht.

**Angebote** (`/angebote`) sehen aus wie die bisherigen aus dem Büro: Briefkopf, Anschrift
links, rechts Angebotsdatum, Kunden-UID, Projektnummer und Angebotsnummer, darunter
„Angebot Nr. 26 659 / BV: …“, die Einleitung, die Positionen mit **Nr., Bezeichnung, Menge,
Einheit, Einheitspreis (EP) und Gesamtpreis (GP)**, darunter Gesamt Netto, Umsatzsteuer
(20 %, je Angebot änderbar) und Gesamtbetrag, der Schlusstext und unten Anschrift,
Bankverbindung und Kontakt.

- Der **Ausführungsort** (wo gearbeitet wird) steht im PDF unter der Überschrift und geht in
  den Auftrag über.
- Positionen werden 1.1, 1.2 … nummeriert; eine **Überschrift** beginnt eine neue Gruppe (2,
  2.1, 2.2 …). Positionen lassen sich verschieben und entfernen.
- Angebots- und Projektnummer schlägt die App vor (nächste freie), beide bleiben frei änderbar.
- Einleitung und Schlusstext kommen aus der Vorlage unter **Einstellungen → Angebote,
  Aufträge und Rechnungen** und lassen sich im einzelnen Angebot ändern. Dort stehen auch die drei Spalten
  der Fußzeile und der **Briefkopf**: als hochgeladenes Bild (PNG/JPG, oben mittig
  eingepasst) oder – ohne Bild – aus dem Logo mit Firma und Anschrift darunter.
- **Logo:** Alle PDFs (Angebot, Auftrag, Rechnung, Summenblatt, Tagesbericht, Lohnzettel)
  und die Druckansichten von Tagesbericht und Lohnzettel setzen das Monsipan-Logo als
  Vektor – die Pfade stehen in [`src/lib/logo.ts`](src/lib/logo.ts).
- **Zertifizierung:** Auf Angebot und Rechnung steht wie auf dem Briefpapier rechts neben der
  Anschrift das Zeichen von Bureau Veritas (ISO 9001, ISO 45001) –
  [`zertifikat.png`](src/lib/modules/auftraege/server/zertifikat.png), wird ins Programm mit
  eingebaut. Für ein neues Zertifikat einfach die Datei austauschen. Ist unter Einstellungen
  ein eigenes Briefkopf-Bild hochgeladen, ersetzt es den ganzen Kopf samt Zeichen.

**Ablauf:**

1. **In Arbeit:** Angebot schreiben, Vorschau über **PDF**.
2. **Freigeben** (Admin, Geschäftsführung, Bauleitung): Danach gibt es den **Link für den
   Kunden** – kopieren, am Handy teilen oder per E-Mail schicken (der Vorschlag ist die
   E-Mail aus dem Kundenstamm).
3. Der Kunde sieht das Angebot (als Blatt oder als Liste, als PDF zum Laden) und
   - **nimmt es an** – mit Name und Unterschrift; sie steht danach unten im PDF, oder
   - **wünscht Änderungen** – mit einem kurzen Text. Im Büro steht der Wunsch oben am
     Angebot; **Überarbeiten** holt es zurück in Arbeit, danach wird es neu freigegeben.
     Der Link bleibt derselbe; solange es überarbeitet wird, sieht der Kunde „wird
     überarbeitet“.
   Wer das Angebot angelegt und freigegeben hat, bekommt bei beidem eine E-Mail (wenn SMTP
   eingerichtet ist und eine Adresse hinterlegt ist).
4. **Angenommen:** **Auftrag erstellen** – Partie wählen (freiwillig: ohne Partie bleibt der
   Auftrag „nicht zugeteilt“ und wird später zugeteilt, z. B. beim Einplanen in der
   Wochenplanung), optional ein Hinweis für die Partie und gleich die **Pläne als PDF**
   (mehrere auf einmal).
   Ein angenommenes Angebot lässt sich nur wieder öffnen (Admin, Geschäftsführung), solange
   es keinen Auftrag gibt; die Annahme verfällt dabei.

**Aufträge** (`/auftraege`) bekommen dieselbe Nummer wie das Angebot, die Anschrift und alle
Positionen – **ohne Preise** und ohne Einleitung, Schlusstext und Fußzeile, dafür mit Partie,
Ausführungsort (antippen öffnet die Karte), Ansprechpartner und Telefon des Kunden und dem
Hinweis. Die Partie lässt sich im Auftrag ändern oder wieder entfernen; in der Liste filtert
„Partie → Nicht zugeteilt“ die Aufträge ohne Partie. Einen nicht zugeteilten Auftrag sehen
nur, wer alle Aufträge sieht – die Partien nicht.

- **Pläne und Unterlagen:** PDFs am Auftrag – beim Erstellen oder später hochladen (das Büro),
  die Partie sieht sie direkt in der App. Abgelegt werden sie wie die PDFs am Artikel unter
  `/data/dokumente`; im Auftrags-PDF steht, welche Unterlagen es in der App gibt.
- **Tagesberichte zum Auftrag:** Beim Anlegen oder im Bericht lässt sich ein offener Auftrag
  wählen – die Baustelle wird dann aus dem Ausführungsort übernommen (oder dem BV, wenn keiner
  eingetragen ist). Im Auftrag stehen alle seine Tagesberichte, **Neuer Tagesbericht** legt
  gleich einen mit diesem Auftrag an. Im Tagesbericht-PDF steht „Auftrag Nr. …“ unter der
  Baustelle.

Die Liste der Aufträge hat drei Reiter mit der Anzahl je Stand: **Erstellt**, **In Arbeit**
und **Abgeschlossen** – Suche und Partie gelten für alle drei. Bei den abgeschlossenen steht,
ob es schon eine Rechnung gibt und ob sie bezahlt ist (bei Teilrechnungen: offen, solange eine
offen ist). Die Partie sieht nur ihre eigenen
Aufträge und setzt sie auf **In Arbeit** und **Abgeschlossen** (und bei Bedarf zurück auf in
Arbeit). Das Büro sieht alle, wechselt die Partie, ändert den Hinweis, setzt zurück auf
„Auftrag erstellt“ oder löscht einen noch nicht begonnenen Auftrag – das Angebot bleibt dann
angenommen und der Auftrag lässt sich neu erstellen. Auftrag und Angebot gibt es als PDF
und zum Drucken.

**Summenblatt** (`/auftraege/<id>/summenblatt`, ab zwei Tagesberichten am Auftrag): alle
Tagesberichte des Auftrags in einer Tabelle – je Bericht eine Zeile, je LB-Position und
Einheit eine Spalte, unten die Summe; dazu Zeitraum, Material und mit welcher Rechnung ein
Bericht abgerechnet ist. Es zählen nur **geprüfte** und vom Kunden unterschriebene Berichte;
Berichte in Arbeit oder nur freigegeben stehen darunter als „Nicht in der Summe“.

PDF und Druck sehen aus wie der Vordruck **Tagesbericht-Summenblatt** (A4 quer): Briefkopf,
Titel mit Jahr, **zu Rechnung Nr.**, rechts **Bundesland** und **Abschnitt**; im Raster
T.B.Nr., vom und elf Mengenspalten mit **LV.** (Nummer der zugeordneten Angebotsposition),
**LB.**, MSK (frei zum Ausfüllen) und **Einheit** – bei Mengen nach Bezeichnung steht statt
LB. und MSK die Bezeichnung (z. B. „RRL 0,15 MSK C ref“) – je Bericht eine Zeile, in der letzten die
**Summe**. Mehr als 21 Berichte gehen auf der nächsten Seite mit **Übertrag** weiter, mehr als
elf Spalten in einem weiteren Blatt. Das Summenblatt gibt es zum ganzen Auftrag und **zu jeder
Rechnung** (nur deren Berichte, Rechnungsnummer, Bundesland und Abschnitt ausgefüllt).

**Rechnungen** (`/rechnungen`): Entweder **eine Rechnung** über alles oder nach und nach
**Teilrechnungen** – jeder geprüfte Tagesbericht wird genau **einmal** abgerechnet. Die erste
Rechnung trägt die **Nummer** von Angebot und Auftrag, weitere zum selben Auftrag „-2“, „-3“ …
Teilrechnungen gehen schon, während der Auftrag **in Arbeit** ist (sobald es geprüfte Berichte
gibt); eine Rechnung ohne Berichte nur nach dem Abschluss. Oben in der Liste stehen die
abgeschlossenen Aufträge, bei denen noch etwas abzurechnen ist („Bereit zur Rechnung“),
darunter die Reiter **Offen**, **Bezahlt** und **Alle**; überfällige sind rot markiert.

- **Rechnung erstellen** (im Auftrag oder in der Liste): Ganz oben die **Tagesberichte**, die
  noch auf keiner Rechnung stehen – alle sind angekreuzt; wer nur einen Teil abrechnen will,
  nimmt die übrigen heraus (sie bleiben für die nächste Teilrechnung). Mengen, Leistungszeitraum
  und die **Art** (Rechnung oder Teilrechnung) folgen der Auswahl: „Rechnung“, wenn es die erste
  ist, der Auftrag abgeschlossen ist und alle Berichte drin sind, sonst „Teilrechnung“ – lässt
  sich umstellen und steht so als Überschrift auf dem PDF.
- Darunter die Mengen der gewählten Berichte – je Spalte (LB-Position und Einheit) wählt man die **Angebotsposition**, deren
  Einheitspreis gilt, oder „Nicht abrechnen“. Vorgeschlagen wird die Position mit genau der
  Nummer aus der LB-Pos. (wer im Tagesbericht z. B. „1.2“ einträgt, landet auf 1.2), sonst die
  Position, in deren Text die LB-Position steht, sonst die einzige mit passender Einheit (m,
  lfm, lfd. m gelten als gleich). Die Zuordnung merkt sich der Auftrag.
- **Spalten ohne LB-Pos.** zählen nach der **Bezeichnung der Zeile** (Ortsbezeichnung/
  Markierungsart) und Einheit zusammen: alle Zeilen „RRL 0,15 MSK C ref“ aus allen gewählten
  Berichten ergeben eine Menge, „LL 0,15 MSK C ref“ eine andere. Groß/Klein und doppelte
  Leerzeichen spielen keine Rolle. Vorgeschlagen wird die Angebotsposition, in deren Text alle
  Wörter der Bezeichnung stehen („RRL 0,15“ → „RRL 0,15 MSK C ref“). Zeilen ohne Bezeichnung
  bleiben nach der Spalte getrennt („Spalte 1“ …).
- **Nicht im Auftrag, aber gemacht:** Für eine Menge, zu der es keine Angebotsposition gibt,
  wählt man **Eigene Position**. Sie kommt ans Ende unter „Zusätzliche Leistungen lt.
  Tagesbericht“ – mit Bezeichnung, Menge und Einheit aus den Berichten (der Kunde hat sie ja
  unterschrieben); den **Einheitspreis trägt man selbst ein**, ohne ihn lässt sich die Rechnung
  nicht erstellen. Auch das merkt sich der Auftrag für die nächste Teilrechnung.
- Darunter die Positionen des Angebots mit den übernommenen Mengen; **Pauschalen** kommen mit
  der Menge aus dem Angebot – aber nur auf die erste Rechnung, auf der sie stehen. Mengen, Preise und Texte lassen sich ändern, eigene Positionen
  dazunehmen. Positionen ohne Menge kommen nicht auf die Rechnung; die **Nummern bleiben wie
  im Angebot** (1.3 bleibt 1.3).
- Kopf: Rechnungsdatum, **zahlbar bis** (Rechnungsdatum plus Zahlungsziel), **Leistungszeitraum**
  (aus den gewählten Berichten), BV, Ausführungsort, Anschrift und UID des Kunden aus dem
  Angebot, dazu **Bundesland** und **Abschnitt** fürs Summenblatt (von der letzten Rechnung zum
  Auftrag übernommen).
- **Übergang der Steuerschuld (Reverse Charge)** für Bauleistungen an Bauunternehmen: ohne
  Umsatzsteuer, mit Hinweis auf § 19 Abs. 1a UStG und der UID des Kunden (dann Pflicht).
- Das PDF sieht aus wie das Angebot: Briefkopf, Rechnungsdatum, UID, Projekt- und
  Rechnungsnummer, zahlbar bis, die abgerechneten Tagesberichte, Positionen mit EP und GP,
  Summen, „Zahlbar bis … ohne Abzug“, Schlusstext und Fußzeile mit Bankverbindung. Die
  Rechnung zeigt ihre Tagesberichte und hat ein eigenes **Summenblatt**.
- Eine neue Rechnung ist ein **Entwurf** (PDF mit „ENTWURF“) – nur Entwürfe lassen sich
  **bearbeiten** und löschen (löschen: Admin, Geschäftsführung). Wird ein Entwurf gelöscht,
  sind seine Tagesberichte wieder abzurechnen. Welche Berichte drin sind, lässt sich
  nachträglich nicht ändern – dafür den Entwurf löschen und neu erstellen. Mit **Rechnung
  endgültig ausstellen** wird sie archiviert, auf Wunsch digital signiert und gesperrt –
  siehe [Rechnungen: Ausstellen, Signatur und Archiv](#rechnungen-ausstellen-signatur-und-archiv).
- **Offen → Bezahlt** mit dem Datum der Zahlung (von Haus aus Admin, Geschäftsführung,
  Buchhaltung), zurück auf offen ebenso – auch bei ausgestellten Rechnungen. Ein Auftrag mit
  Rechnung lässt sich nicht löschen.
- Rechnungen von vor den Teilrechnungen: Die Berichte, die beim Erstellen schon geprüft waren,
  gelten als mit ihnen abgerechnet.
- Einleitung, Schlusstext und **Zahlungsziel** (von Haus aus 30 Tage) stehen unter
  **Einstellungen → Angebote, Aufträge und Rechnungen**.

**Löschen** hat bei Angeboten und Aufträgen zwei Stufen: *In Arbeit* bzw. *Nur neue* (noch
nicht begonnen) – von Haus aus das Büro – oder *Alle*, also auch freigegebene, angenommene,
laufende und abgeschlossene – von Haus aus Admin und Geschäftsführung. Beim Löschen eines Angebots mit Auftrag lässt sich wählen, ob
der Auftrag mitgeht; sonst bleibt er ohne Angebot bestehen. Ein gelöschter Auftrag nimmt
Positionen und Unterlagen mit, seine Tagesberichte bleiben (ohne Auftrag), das Angebot bleibt
angenommen. Der Link des Kunden zu einem gelöschten Angebot funktioniert nicht mehr.

Wer was darf, steht unter Verwaltung → Berechtigungen im Abschnitt „Auftragsmanagement“
(Anfragen, Angebote, Aufträge, Rechnungen, Kunden). Preise sieht nur, wer Angebote oder
Rechnungen sehen darf – Partieführer und Arbeiter sehen sie nicht.

## Rechnungen: Ausstellen, Signatur und Archiv

Ausgestellte Rechnungen lassen sich nicht unbemerkt verändern: Sie werden unverändert
archiviert, mit Prüfsumme (SHA-256) und Protokoll abgesichert, auf Wunsch nach **PAdES**
(eIDAS, ETSI EN 319 142) digital signiert und tragen einen **Prüfcode** zur öffentlichen
Prüfseite.

**Ablauf:** Entwurf erstellen und bearbeiten → **Rechnung endgültig ausstellen** (Recht
„Endgültig ausstellen“, von Haus aus das Büro) → die Rechnung behält ihre eindeutige Nummer,
das endgültige PDF wird **genau einmal** erzeugt (mit QR-Code), archiviert und – wenn die
Signatur an ist – signiert. Stufen: *Entwurf → Ausgestellt → Signierung läuft → Signiert*
bzw. *Signierung fehlgeschlagen*; danach jederzeit *Storniert*.

- **Gesperrt** sind danach Nummer, Datum, Leistungszeitraum, Empfänger, Rechnungssteller
  (steht im archivierten PDF), Texte, Positionen, Preise, Steuersatz und Beträge. Das sichern
  **Trigger in der Datenbank** – auch wer an der App vorbei schreibt, wird abgewiesen.
  Archiv, Signaturangaben und Protokoll lassen sich gar nicht ändern oder löschen.
- **Ausgeliefert** wird ab dann nur noch das archivierte Dokument (PDF, Drucken, Download) –
  die signierte Fassung, sonst das Original. Nichts wird neu erzeugt.
- **Scheitert die Signierung** (Zeitstempeldienst nicht erreichbar, Zertifikat abgelaufen
  …), heißt die Rechnung „Signierung fehlgeschlagen“ – nie „signiert“. Sie ist trotzdem
  ausgestellt und archiviert; **Signierung erneut versuchen** signiert dasselbe Original.
  Die Benachrichtigung „Digitale Signatur fehlgeschlagen“ geht an Admin, GF und Buchhaltung.
- **Korrekturen nur per Storno** (Recht „Stornieren“, von Haus aus Admin, GF, Buchhaltung):
  mit Grund; es entsteht eine **Stornorechnung** mit umgekehrten Mengen und Bezug auf die
  Rechnung („Storno zu Rechnung Nr. …“), selbst ausgestellt und signiert, Nummer wie jede
  weitere Rechnung zum Auftrag. Die Rechnung bleibt unverändert archiviert und gilt als
  storniert; ihre Tagesberichte sind wieder frei für eine neue (Korrektur-)Rechnung.
  Stornierte Rechnungen und Stornorechnungen zählen nicht bei offenen Beträgen und Mahnungen.
- **Löschen zum Testen:** Mit dem Recht „Löschen → Alle“ (von Haus aus nur Admin) lassen
  sich auch ausgestellte Rechnungen und Stornorechnungen löschen – mit Grund, samt
  Archivdateien und Signatur. Die Sperren werden dafür nur innerhalb der Lösch-Transaktion
  abgelegt und danach wieder angelegt; die Löschung steht im Protokoll. Mit einer Rechnung geht
  ihre Stornorechnung mit; wird nur die Stornorechnung gelöscht, gilt die Rechnung wieder
  (nicht mehr storniert) und ihre Tagesberichte hängen wieder an ihr. Für echte, an Kunden
  gegangene Rechnungen ist das nicht gedacht – die sind aufzubewahren und werden storniert.
- **Bisherige Rechnungen** (vor diesem Stand) sind als **Entwurf** übernommen – Inhalt
  unverändert, weiter bearbeitbar und jederzeit ausstellbar. Nichts wurde automatisch
  ausgestellt oder neu erzeugt.

**Abschnitt „Digitale Signatur & Sicherheit“** in jeder ausgestellten Rechnung:
Signaturstatus, Standard (z. B. PAdES-B-LT), Signaturdatum mit Zeitstempeldienst,
Zertifikat und seine Einstufung, letzte Prüfung, SHA-256 von Original und signierter Fassung,
Aufbewahrungsfrist – dazu **Digitale Signatur überprüfen**, **Signierte Rechnung
herunterladen**, **Rechnung verifizieren** (öffnet die Prüfseite), **Signaturinformationen
anzeigen** und das **Protokoll** aller Schritte.

**Prüfcode und Prüfseite:** Unten auf der Rechnung steht ein QR-Code mit Adresse
(`https://portal.monsipan.at/pruefen/<schlüssel>`, 144 Bit Zufall, nicht erratbar) und dem
Hinweis, dass es **kein Registrierkassen-Beleg (RKSV)** ist. Die Seite braucht keine
Anmeldung und zeigt nur Nummer, Datum, Ausstellung, Rechnungssteller, Status, Signatur und
das Prüfergebnis – **keine Beträge, keine Positionen, keinen Kunden**:

| Anzeige | Bedeutung |
|---|---|
| Rechnung gültig (grün) | Archiv unverändert, Signatur erfolgreich geprüft |
| Signatur ungültig (rot) | Datei fehlt oder verändert, Daten weichen ab oder Signatur ungültig |
| Rechnung storniert (gelb) | ursprünglich ausgestellt, inzwischen storniert |
| Verifizierung nicht möglich (grau) | z. B. nicht signiert – der Signaturstatus ist nicht feststellbar |

Wer die Rechnung bekommen hat, kann dort seine PDF auswählen: Der Browser rechnet die
Prüfsumme aus, nur sie wird verglichen – die Datei verlässt das Gerät nicht.

**Signatur (PAdES):** unsichtbares Signaturfeld, `/SubFilter /ETSI.CAdES.detached`, CMS mit
SHA-256 und *signing-certificate-v2* (ohne *signing-time*), PDF 1.7. Stufen zum Einstellen:

| Stufe | Inhalt |
|---|---|
| PAdES-B-B | nur die Signatur |
| PAdES-B-T | + Zeitstempel (RFC 3161) über den Signaturwert – die Signaturzeit ist belegt |
| PAdES-B-LT (Standard) | + Document Security Store mit Zertifikaten und Sperrinformationen (OCSP/CRL) – prüfbar, auch wenn Aussteller und Dienste nicht mehr erreichbar sind |
| PAdES-B-LTA | + Archivzeitstempel über alles |

Ausgewiesen wird nur, was tatsächlich drin ist: Fehlen Sperrinformationen, steht B-T statt
B-LT. Jede Signatur wird vor dem Archivieren selbst geprüft. Ein gesperrtes Zertifikat wird
nicht verwendet. Signiert wird als neue Revision ans Original angehängt – das Original
steckt Byte für Byte in der signierten Datei.

**Einstufung, ehrlich:** „Qualifiziert“ steht nur da, wenn das Zertifikat es selbst über
die QC-Statements erklärt (qualifiziert *und* Schlüssel in einer QSCD). Ein eigenes
Zertifikat ist „nicht qualifiziert“; Adobe meldet dazu „Identität unbekannt“, prüft aber
die Unversehrtheit. Für normale Rechnungen verlangt Österreich keine qualifizierte Signatur –
Echtheit der Herkunft, Unversehrtheit und Lesbarkeit müssen gesichert sein.

**Archiv und Aufbewahrung:** Dateien unter `/data/rechnungen/<Jahr>/`, einmal geschrieben
(nur anlegen, schreibgeschützt), nach dem Schreiben gegen die Prüfsumme verglichen. In der
Datenbank stehen Prüfsumme, Zeitpunkt und Verfahren der Signatur sowie eine Prüfsumme der
Rechnungsdaten – so fällt auch eine Änderung an der Datenbank vorbei auf. Aufbewahrung
mindestens sieben Jahre ab Ende des Rechnungsjahres (§ 132 BAO), einstellbar bis 50 Jahre;
ausgestellte Rechnungen werden nicht gelöscht (außer von Hand zum Testen, siehe oben). **Jede Nacht** prüft die Wartung alle
ausgestellten Rechnungen (Datei, Prüfsumme, Daten, Signatur) und die **Hash-Kette des
Protokolls** (jeder Eintrag enthält den Hash des vorigen); Fehler gehen als
Benachrichtigung „Archivprüfung mit Fehlern“ an Admin und GF.

**Einstellungen** (Verwaltung → Einstellungen → Rechnungssignatur, nur Admin): Signatur an/aus,
Anbieter, Verfahren, Zeitstempeldienst, Prüfseite an/aus und ihre Adresse, Grund und Ort,
Aufbewahrung, Zertifikat (anzeigen, erzeugen, hochladen), **Verbindung testen** (Zertifikat,
Testsignatur, Zeitstempel, Sperrinformationen – ohne Rechnung) und **Archiv prüfen**.
Jede Änderung steht im Protokoll.

### Einrichten

1. **Umgebungsvariable** `SIGNATUR_PASSWORT` in Portainer setzen (mindestens 12 Zeichen,
   gut aufbewahren) und **Pull and redeploy**. Damit wird der Schlüssel am Server
   verschlüsselt; ohne sie lässt er sich nicht öffnen. **Achtung:** Docker Compose liest ein `$` als
   Beginn einer Variable – ein `$` im Passwort als `$$` schreiben oder gleich ein Passwort ohne `$`
   nehmen (z. B. `openssl rand -hex 16`), sonst fehlen Zeichen und es ist zu kurz. Das Passwort nur
   in Portainer eintragen, nie in `portainer-stack.yml` im Repository.
2. Unter **Rechnungssignatur** ein Zertifikat hinterlegen:
   - **Eigenes Zertifikat erzeugen** – sofort und kostenlos (RSA 3072, SHA-256), oder
   - **Gekauftes Zertifikat hochladen** (.p12/.pfx mit RSA oder PEM mit Schlüssel und Kette);
     das Passwort der Datei dient nur zum Öffnen.

   Abgelegt wird es verschlüsselt unter `/data/signatur/siegel.pem` (anderer Ort:
   `SIGNATUR_DATEI`); ein ersetztes bleibt als `.bak` daneben.
3. Verfahren wählen (empfohlen **PAdES-B-LT**), Zeitstempeldienst eintragen (vorgeschlagen:
   DigiCert, kostenlos), **Verbindung testen**, dann **Ausgestellte Rechnungen digital
   signieren** einschalten und speichern.
4. Adresse für den Prüfcode prüfen – sie steht dauerhaft auf jeder Rechnung. Leer heißt
   `ORIGIN`; vor dem Umzug auf `portal.monsipan.at` am besten dort schon
   `https://portal.monsipan.at` eintragen.

**A-Trust (qualifiziertes elektronisches Siegel):** Ein qualifiziertes Siegel liegt nie als
Datei vor, sondern beim Vertrauensdiensteanbieter. A-Trust bietet dafür *Hash-Signing über die
CSC-API* an (Cloud Signature Consortium). Die App spricht CSC v1 und v2; an A-Trust geht nur
der SHA-256, nie die Rechnung. Nötig ist ein Vertrag (z. B. a.sign premium seal als
Fernsiegel) – A-Trust nennt dann Adresse der CSC-API, Token-Adresse, Client-ID und die Kennung
des Siegels (credentialID). Diese unter **Vertrauensdiensteanbieter über CSC-API** eintragen,
das Client-Secret als `SIGNATUR_CSC_SECRET` und – falls verlangt – die PIN als
`SIGNATUR_CSC_PIN` setzen, **Verbindung testen**. Für qualifizierte Zeitstempel die Adresse
des A-Trust-Zeitstempeldienstes eintragen; Zugangsdaten über `SIGNATUR_TSA_BENUTZER` und
`SIGNATUR_TSA_PASSWORT`. Die CSC-Anbindung ist gegen einen nachgebauten Dienst getestet; mit
echten Zugangsdaten zuerst **Verbindung testen**.

| Umgebungsvariable | Wofür |
|---|---|
| `SIGNATUR_PASSWORT` | verschlüsselt den Schlüssel des eigenen Zertifikats (Pflicht für „Eigenes Zertifikat“) |
| `SIGNATUR_DATEI` | anderer Ablageort des Schlüssels (Standard `/data/signatur/siegel.pem`) |
| `SIGNATUR_CSC_SECRET` | Client-Secret bzw. Passwort für die CSC-API |
| `SIGNATUR_CSC_PIN` | PIN des Siegels, falls der Anbieter sie verlangt |
| `SIGNATUR_TSA_BENUTZER`, `SIGNATUR_TSA_PASSWORT` | Zugang zu einem Zeitstempeldienst mit Anmeldung |

### Kosten und Abhängigkeiten

| Funktion | Kostenlos | Externer Anbieter |
|---|---|---|
| Sperre nach dem Ausstellen, Archiv mit SHA-256, Protokoll mit Hash-Kette | ✅ | nein |
| QR-Code mit Prüfseite | ✅ | nein |
| PAdES mit eigenem Zertifikat (B-B bis B-LTA) | ✅ (Zeitstempel von DigiCert/Sectigo kostenlos) | nur der Zeitstempeldienst |
| PAdES ohne Warnung in Adobe | ⚠️ | Zertifikat eines Ausstellers in der Adobe-Liste (AATL) bzw. EU-Vertrauensliste – jährliche Kosten |
| Qualifiziertes elektronisches Siegel | ❌ | ja, z. B. A-Trust über die CSC-API – Vertrag, laufende Kosten je Siegel bzw. Paket |
| Qualifizierter Zeitstempel | ❌ | ja, z. B. A-Trust – kostenpflichtig |

**Grenzen:** Eine PAdES-Signatur verhindert nicht, dass jemand eine PDF-Kopie verändert –
sie macht jede Änderung sichtbar (in Adobe und auf der Prüfseite). Für sehr lange
Aufbewahrung müssen Zeitstempel vor dem Ablauf des Zeitstempelzertifikats erneuert werden
(B-LTA-Erneuerung); die Signatur ist dafür vorbereitet (Archivzeitstempel, DSS), das
regelmäßige Nachstempeln selbst ist noch nicht eingebaut. Wird eine ältere Sicherung
eingespielt, fehlen danach die später ausgestellten Rechnungen in der Datenbank – ihre
Dateien bleiben im Archiv, der Stand davor steckt in der „-vor-restore“-Sicherung.

## Import und Export

Unter **Verwaltung → Import und Export** (`/verwaltung/import`) gehen Kunden, Anfragen,
Angebote, Aufträge und Rechnungen als **Excel (.xlsx) oder CSV** hinaus und herein.

**Exportieren** (Recht „Import und Export → Exportieren“, von Haus aus das Büro – je Bereich
nur, wer dort alles sieht): alle Einträge; Angebote, Aufträge und Rechnungen mit **einer Zeile je
Position**, die Kopfdaten in jeder Zeile, Rechnungen dazu mit Stufe und Summen. Die
Spaltenüberschriften sind genau die Felder des Imports – ein Export lässt sich unverändert
wieder einlesen.

**Importieren** (Recht „Importieren“, von Haus aus nur Admin) – gedacht für Daten aus dem
bisherigen Programm:

1. Art wählen (Kunden, Anfragen, Angebote, Aufträge, Rechnungen) und die Datei – Excel oder CSV.
   CSV darf Semikolon, Komma oder Tabulator trennen und in UTF-8, UTF-16 oder Windows-1252
   (ältere Programme) gespeichert sein. Die erste Zeile enthält die Spaltenüberschriften.
2. **Spalten zuordnen:** Die Seite schlägt die Zuordnung nach den Überschriften vor – auch
   für übliche fremde Namen wie „Re-Nr.“, „Belegdatum“, „Netto“, „EP“, „ME“ – und zeigt je
   Feld einen Beispielwert. Bei mehreren Blättern einer Excel-Datei lässt sich das Blatt
   wählen. **Vorlage** lädt eine leere Datei mit den richtigen Spalten.
3. **Prüfen** schreibt noch nichts: neu, schon vorhanden, mit Fehlern – mit Zeilennummern.
4. **Importieren** schreibt alles in einer Transaktion – ganz oder gar nicht. Zeilen mit
   Fehlern werden nicht übernommen.

- **Reihenfolge:** zuerst Kunden, dann Anfragen, Angebote und Aufträge, zuletzt Rechnungen.
  Rechnungen hängen sich über die Auftragsnummer an ihren Auftrag, ein Auftrag an das Angebot
  mit derselben Nummer, Angebote und Anfragen über den Namen an den Kunden.
- **Angebote:** Stand „beim Kunden“ (auch „ausstehend“, „versendet“), „angenommen“ (auch
  „abgerechnet“) oder „in Arbeit“; ohne Positionen wird „Netto gesamt“ eine Position.
- **Angebote, Aufträge und Rechnungen** haben je Zeile eine Position; Zeilen mit gleicher Nummer – oder
  ohne Nummer direkt darunter – gehören zum selben Beleg. „Titel“ in der Positionsart (oder
  eine Zeile nur mit Text) wird zur Zwischenüberschrift. Eine Rechnung ohne Positionen braucht
  „Netto gesamt“ – das wird dann eine Position.
- **Werte:** Datum als Excel-Datum, „12.10.2026“, „12.10.26“ oder „2026-10-12“; Zahlen mit
  Komma oder Punkt; ja/nein auch als x, 1, wahr. Der Stand eines Auftrags wird aus Wörtern wie
  „in Arbeit“, „fertig“, „abgeschlossen“ erkannt, die Partie über ihren Namen („Erich“ findet
  „Partie Erich“); unbekannte Partien bleiben „nicht zugeteilt“.
- **Schon vorhanden:** Kunden (gleicher Name, bei Angabe gleiche PLZ) und Aufträge (gleiche
  Nummer) lassen sich überspringen oder **aktualisieren** – leere Felder ändern dabei nichts,
  Positionen eines Auftrags werden ersetzt. Anfragen und Rechnungen werden übersprungen.
- **Rechnungen kommen als Altbestand** (Stufe „Importiert“): gesperrt wie ausgestellte, aber
  ohne Archiv, Signatur und Prüfcode – maßgeblich bleibt das ursprünglich ausgestellte
  Dokument; das PDF trägt dazu einen Hinweis. Offen/bezahlt lässt sich ändern, korrigiert wird
  per Storno. Schon überfällige, offene melden sich nicht als „überfällig“. Die Archivprüfung
  lässt sie aus; im Protokoll steht, aus welcher Datei sie kamen.
- **Stornos aus dem bisherigen Programm:** „Storniert = ja“ übernimmt eine Rechnung als
  storniert; eine Stornorechnung nennt in „Storno zu Rechnung“ die stornierte – beide werden
  miteinander verknüpft (wie ein Storno im Portal) und zählen nicht bei offenen Beträgen.

## Benachrichtigungen

Bei wichtigen Schritten bekommen die richtigen Leute Bescheid – unter der **Glocke** oben
rechts (mit Zahl der ungelesenen, live) und als **Push** aufs Handy bzw. den PC, auch wenn
die App zu ist. Ein Tipp führt direkt zur Stelle und markiert die Benachrichtigung als
gelesen. Ältere als 90 Tage räumt die nächtliche Wartung weg.

**Ereignisse:** neue Anfrage · Angebot freigegeben · Angebot vom Kunden angenommen ·
Änderungswunsch des Kunden · Auftrag einer Partie zugeordnet (neu oder Partie gewechselt) ·
neue Pläne/Unterlagen am Auftrag · Auftrag in Arbeit · Auftrag abgeschlossen · Rechnung
erstellt · Rechnung bezahlt · Rechnung überfällig (am Tag nach „zahlbar bis“, ab 7 Uhr,
einmal je Rechnung) · Digitale Signatur einer Rechnung fehlgeschlagen · Archivprüfung der
Rechnungen mit Fehlern · Tagesbericht freigegeben · Tagesbericht vom Kunden unterschrieben ·
Tagesbericht wieder geöffnet · Stundenzettel freigegeben · Stundenzettel wieder geöffnet ·
Arbeiter hilft bei einer anderen Partie aus · Wochenplan an die Partie geschickt · Urlaub
beantragt · Urlaub genehmigt oder abgelehnt (geht immer an die Person selbst) · Krankenstand
gemeldet · Artikel am Mindestbestand.

**Wer was bekommt** stellt der Admin unter **Verwaltung → Benachrichtigungen** ein: je
Ereignis die Gruppen anhaken und bei Bedarf einzelne Personen dazunehmen. Dabei gilt immer:

- Ankommen kann nur, was die Person auch öffnen darf (Berechtigungen) – Gruppen ohne Recht
  sind ausgegraut.
- Bei Ereignissen einer Partie (Aufträge, Tagesberichte, Stundenzettel) bekommen es
  Partieführer und Arbeiter nur für ihre eigene Partie; wer „alle sehen“ darf, für alle.
- Wer einen Schritt selbst macht, bekommt dazu nichts.
- Jede Person kann einzelne Benachrichtigungen unter **Mein Konto → Benachrichtigungen** für
  sich abschalten.

Von Haus aus z. B.: neuer Auftrag → Partieführer der Partie; Angebot angenommen →
Geschäftsführung, Bauleitung, Büro; Tagesbericht freigegeben → Bauleitung und Büro;
Stundenzettel freigegeben → Büro; Rechnung überfällig → Geschäftsführung und Büro.
Der Katalog mit den Vorgaben steht in [`src/lib/notifications.ts`](src/lib/notifications.ts).

**Push einschalten:** je Gerät einmal – unter der Glocke oder unter Mein Konto auf
**Einschalten** tippen und die Nachfrage des Browsers bzw. von Android erlauben. **Test**
schickt eine Probe an die eigenen Geräte.

- **Browser und Web-App** (PC, Android im Chrome, iPhone als Web-App am Home-Bildschirm):
  läuft ohne Einrichtung. Die Schlüssel (VAPID) erzeugt der Server beim ersten Mal selbst und
  legt sie in der Datenbank ab; wer eigene will, setzt `VAPID_PUBLIC_KEY` und
  `VAPID_PRIVATE_KEY`.
- **Android-App:** braucht ein kostenloses Firebase-Projekt und eine neue APK. Einmalig:
  1. [console.firebase.google.com](https://console.firebase.google.com) → Projekt anlegen
     (Analytics nicht nötig).
  2. **Android-App hinzufügen** mit dem Paketnamen `at.monsipan.intern` und die Datei
     **google-services.json** herunterladen.
  3. Auf GitHub unter Settings → Secrets and variables → Actions ein Secret
     **GOOGLE_SERVICES_JSON** anlegen und den ganzen Inhalt der Datei einfügen. Danach den
     Workflow „Android-App (APK)“ einmal laufen lassen und die neue App installieren.
  4. In Firebase unter Projekteinstellungen → **Dienstkonten** → „Neuen privaten Schlüssel
     generieren“. Die heruntergeladene JSON-Datei unter **Verwaltung → Benachrichtigungen →
     Push in der Android-App einrichten** hochladen – fertig, ohne Neustart. Der Schlüssel
     bleibt am Server (in der Datenbank, also auch in den Sicherungen) und wird nie wieder
     angezeigt. Wer ihn lieber im Stack hat: Variable **FIREBASE_SERVICE_ACCOUNT** (Inhalt,
     Base64 oder Pfad) – sie hat Vorrang.
  5. In der neuen App unter der Glocke bzw. Mein Konto **Einschalten** tippen, Android fragt
     nach der Erlaubnis; **Test** schickt eine Probe.

  Ohne diese Schritte läuft alles andere weiter; in der App kommt dann nur die Glocke, und
  die Seite Benachrichtigungen zeigt „noch nicht eingerichtet“. Eine App ohne Firebase meldet
  sich gar nicht erst für Push an (das Anmelden würde sie sonst beenden).

## Handschrift am Tablet

Tagesberichte und Stundenzettel lassen sich auch wie ein Papierformular ausfüllen. Oben im
Dokument wählt man **Digital** oder **Handschrift**; das Gerät merkt sich die Wahl, ein Tablet
öffnet Dokumente danach gleich in der Handschrift-Ansicht.

- Das Formular sieht aus wie im Ausdruck. Was schon digital eingetragen ist (Name, Woche,
  Baustelle, Mengen …), steht darin – geschrieben wird obenauf. Beides lässt sich mischen.
- **Stift oder Finger:** Mit dem Schalter **Finger** schreiben auch Finger und einfache
  Displaystifte (Gummispitze – der Browser sieht sie wie einen Finger); verschoben und gezoomt
  wird dann mit zwei Fingern. Ohne Finger-Schalter schreibt nur ein aktiver Stift (Apple
  Pencil, S Pen …) bzw. die Maus, ein Finger verschiebt, zwei zoomen, und der aufliegende
  Handballen zählt nicht. Am Tablet ist **Finger** voreingestellt, bis zum ersten Mal ein
  aktiver Stift aufsetzt; das Gerät merkt sich die Einstellung.
- Werkzeuge: Stift blau oder schwarz, Radierer (auch die Radiertaste am Stift), Rückgängig,
  Wiederholen, Zoom. Gespeichert wird nach jedem Strich von selbst. Am besten im Hochformat.
- **Ausdruck, PDF und Kundenlink** zeigen das Formular mit der Handschrift an ihrer Stelle.
  Steht in einem Feld Handschrift, fällt dort der getippte Wert weg – nichts erscheint doppelt.
- **Das Büro trägt nach:** In der digitalen Ansicht steht die Handschrift oben („Handschriftlich
  ausgefüllt“), darunter die Felder. Was dort eingetragen wird, zählt für Summen, Lohn und
  Auswertungen; im Ausdruck bleibt an diesen Stellen die Handschrift stehen.
- Schreiben darf, wer das Dokument auch digital ändern darf – nach Freigabe bzw. Prüfung oder
  der Unterschrift des Kunden vor Ort ist die Handschrift ebenso gesperrt.

Technisch liegen die Striche in den Koordinaten der PDF-Seite (`src/lib/ink.ts`); die Ansicht
zeichnet das PDF ohne Handschrift als Hintergrund (`?tinte=0`) und die Striche darüber
(`InkEditor.svelte`).

## Lokale Entwicklung

Voraussetzung: Node.js 22.12 oder neuer.

```bash
npm install
npm run dev
```

Beim ersten Start wird die Datenbank in `./data/lager.db` angelegt. Mit `DEMO_DATA=true`
in der `.env` kommen Beispielartikel (u. a. die fotografierten Kansai- und 3M-Etiketten),
Partien und ein halbes Jahr Buchungen dazu. Grund- und Demodaten werden nur bei einer
leeren Datenbank angelegt – nach einem Zurücksetzen kommen sie nicht von selbst wieder.

| Zugang (nur Entwicklung) | Passwort |
|---|---|
| `admin` | `admin1234` |
| `bauleiter` (ohne Partie), `partie` (Partieführer, Partie Nord), `arbeiter` (Partie Nord), `buero` (nur ansehen) | `demo1234` |

Die Handykamera braucht HTTPS. Zum Testen im WLAN ein lokales Zertifikat erzeugen,
z. B. mit [mkcert](https://github.com/FiloSottile/mkcert) für `localhost` und die
IP-Adresse des PCs, und in `vite.config.ts` unter `server.https` eintragen. Auf dem Handy
muss die mkcert-Stammzertifizierungsstelle (`mkcert -CAROOT` → `rootCA.pem`) installiert
und vertraut sein, sonst blockiert der Browser die Kamera.

Weitere Befehle:

```bash
npm run check      # Typprüfung
npm test           # Tests (Scan-Parser, Tastaturlayouts, Scanner-Erkennung)
npm run build      # Produktions-Build nach ./build
npm run db:generate  # nach Änderungen am Schema: neue Migration erzeugen
```

## Betrieb auf dem Server

Zwei Wege: fertiges Image aus GitHub über Portainer (wenn schon ein Cloudflare Tunnel
läuft) oder selbst bauen mit Docker Compose und Caddy.

### Mit Portainer und Cloudflare Tunnel

Bei jedem Push auf `main` baut GitHub Actions
([`.github/workflows/docker.yml`](.github/workflows/docker.yml)) erst Typprüfung und
Tests, dann das Image für `linux/amd64` und `linux/arm64`:

```
ghcr.io/mstreicher98/monsipan-intern:latest
```

Dazu gibt es Tags mit dem Commit (`sha-…`) und, bei einem Git-Tag wie `v1.0.1`, mit der
Version. In Portainer **Stacks → Add stack → Repository**, Repository-URL des Projekts,
Compose path `portainer-stack.yml`. Die Datei ist kommentiert; nötig ist nur:

| Variable | Wert |
|---|---|
| `ORIGIN` | `https://intern.monsipan.at`, künftig `https://portal.monsipan.at` – muss exakt der öffentlichen Adresse entsprechen, sonst lehnt die App alle Formulare ab |
| `INITIAL_ADMIN_PASSWORD` | Passwort des ersten Admins (leer lassen: die App erzeugt eines und zeigt es im Log) |
| `SMTP_*`, `MAIL_FROM` | nur falls E-Mail gewünscht |
| `SIGNATUR_*` | nur für die digitale Rechnungssignatur – siehe [Einrichten](#einrichten) |

Der Tunnel zeigt auf `http://<Server-IP>:3000`. Läuft `cloudflared` als Container in
einem eigenen Docker-Netz, stattdessen in `portainer-stack.yml` Variante B aktivieren
und im Tunnel `http://app:3000` eintragen. TLS macht Cloudflare, Caddy wird dann nicht
gebraucht.

Das Paket ist derzeit öffentlich, Portainer braucht also keine Zugangsdaten. Wird es auf
GitHub unter **Packages → Package settings** auf privat gestellt, in Portainer unter
**Registries** eine GHCR-Registry mit GitHub-Benutzer und einem Token mit
`read:packages` hinterlegen.

**Update:** Änderungen pushen, Actions abwarten, in Portainer **Pull and redeploy**.
Die Datenbank liegt im Volume `lager-data` und bleibt dabei erhalten; Migrationen laufen
beim Start automatisch. Volume und Dateiname heißen weiterhin „lager“ – beim Umbenennen
der Anwendung wurden sie bewusst nicht angefasst, damit keine Daten verloren gehen.

**Umzug auf `portal.monsipan.at`:** Die Anwendung heißt jetzt Monsipan Portal; die Adresse
zieht später von `intern.monsipan.at` nach `portal.monsipan.at`. Dafür:

1. Im Cloudflare-Tunnel unter **Public Hostnames** `portal.monsipan.at` auf denselben
   Dienst legen wie `intern.monsipan.at` – die alte Route bleibt stehen.
2. In Portainer `ORIGIN` auf `https://portal.monsipan.at` setzen, **Pull and redeploy**.
   Ab dann leitet die App Aufrufe von `intern.monsipan.at` (und dem noch älteren
   `lager.monsipan.at`) selbst auf die neue Adresse weiter, mit Pfad und Query – Lesezeichen,
   Links in Mails und Kundenlinks bleiben gültig. Alle melden sich einmal neu an, weil die
   Anmeldung an der Adresse hängt; Push im Browser einmal neu einschalten.
3. Die Android-App mit der neuen Adresse bauen: unter Actions „Android-App (APK)“ → **Run
   workflow** mit der Adresse `https://portal.monsipan.at` (oder dauerhaft als
   Repository-Variable `APP_URL`). Die App aktualisiert sich über die bestehende
   Installation – Kennung, Signatur und Firebase bleiben gleich.

Leitet die alte Adresse nicht weiter (etwa weil im Tunnel ein eigener Host-Kopf
eingestellt ist), geht dasselbe in Cloudflare unter **Rules → Redirect Rules**. Innerhalb
der Anwendung leiten auch die alten Pfade von selbst weiter (siehe
[Bereiche und Adressen](#bereiche-und-adressen)).

### Selbst bauen mit Docker Compose und Caddy

Benötigt: ein Linux-Server mit Docker, Ports 80 und 443 offen, und ein DNS-Eintrag
(A-Record) von `portal.monsipan.at` auf die Server-IP.

```bash
git clone <repo> monsipan-intern && cd monsipan-intern
cp .env.example .env        # Domain, SMTP und ersten Admin eintragen
docker compose up -d --build
docker compose logs app     # zeigt das Passwort des ersten Admins, falls keines gesetzt wurde
```

Caddy holt das HTTPS-Zertifikat automatisch und erneuert es. Beim ersten Login muss das
Admin-Passwort geändert werden.

**Update:** `git pull && docker compose up -d --build` – Datenbank-Migrationen laufen beim
Start automatisch.

**Wichtige Umgebungsvariablen** (siehe [`.env.example`](.env.example)):

| Variable | Zweck |
|---|---|
| `DOMAIN` | Domain für HTTPS und Links in E-Mails |
| `INITIAL_ADMIN_*` | erster Admin, nur beim allerersten Start |
| `SMTP_*`, `MAIL_FROM` | E-Mail für „Passwort vergessen“, Einladungen, Warnungen |
| `DEMO_DATA` | `true` legt Beispieldaten an – im Echtbetrieb `false` lassen |

Ohne SMTP funktioniert alles außer E-Mail; Mails landen dann nur im Log. Den Versand
testet ein Admin unter **Einstellungen → Test senden**.

## Datensicherung

- Jede Nacht ab 2 Uhr entsteht automatisch eine Sicherung in `/data/backups`
  (Docker-Volume `lager-data`), die letzten 14 bleiben erhalten. Sicherungen werden nie
  überschrieben; entsteht eine zweite in derselben Sekunde, bekommt sie ein `-2` angehängt.
- Unter **Einstellungen → Datensicherung** lassen sich Sicherungen sofort erstellen und herunterladen.

**Wiederherstellen (in der App, nur Admin):** In der Liste der Sicherungen auf das
Verlaufs-Symbol klicken oder über **Sicherungsdatei hochladen** eine `.db`-Datei von
außerhalb einspielen (bis 200 MB, deshalb steht `BODY_SIZE_LIMIT` im Container auf 210M).
Bestätigt wird mit dem eigenen Passwort. Ablauf: Datei prüfen (SQLite, Schema, Zustand),
bei Bedarf auf den aktuellen Schemastand migrieren, Sicherung des jetzigen Standes anlegen
(`-vor-restore` im Namen) und dann den gesamten Inhalt in einer Transaktion ersetzen –
entweder ganz oder gar nicht. Die Datenbankdatei selbst wird nicht getauscht, damit
laufende Anfragen nicht ins Leere greifen. Anmeldungen kommen danach aus der Sicherung;
wer dadurch abgemeldet wird, meldet sich einfach neu an.
Der Code steht in [`src/lib/server/restore.ts`](src/lib/server/restore.ts).

**Wiederherstellen von Hand** (z. B. wenn die App nicht startet): Container stoppen,
gewünschte Sicherung als `lager.db` in das Volume kopieren, Container starten.

```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c "rm -f /data/lager.db-wal /data/lager.db-shm"
docker compose cp ./lager-2026-09-18-020000.db app:/data/lager.db
docker compose start app
```

Für echte Ausfallsicherheit die Sicherungen zusätzlich außerhalb des Servers ablegen
(z. B. nächtliches `rsync` des Volumes oder Download über die Oberfläche).

## Alles zurücksetzen

Unter **Einstellungen → Alles zurücksetzen** (nur Admin) lässt sich das Lager komplett leeren:
Artikel und Codes, Bestand, alle Bewegungen, Lagerorte, Partien, Materialarten und Farben.

- **Doppelte Bestätigung:** `ALLES LÖSCHEN` eintippen (Groß-/Kleinschreibung egal) und
  das eigene Passwort eingeben. Nach 5 Fehlversuchen ist die Aktion kurz gesperrt.
- Das eigene Admin-Konto bleibt immer erhalten. Optional werden alle anderen Benutzer
  mitgelöscht, sonst verlieren sie nur ihre Partie-Zuordnung. Bereits gelöschte Benutzer
  werden endgültig entfernt.
- Optional werden die Standard-Materialarten und RAL-Verkehrsfarben gleich wieder angelegt.
- **Vorher entsteht automatisch eine Sicherung** mit `-vor-reset` im Namen. Sie ist in der
  Liste gekennzeichnet, wird getrennt aufbewahrt (die letzten 10) und verdrängt keine der
  14 regulären Sicherungen. Wiederherstellen wie oben beschrieben.

## Drucken, PDF und CSV

**Bestand** und **Bewegungen** haben je einen Knopf **Drucken**. Er öffnet eine eigene
Druckansicht, die den aktuellen Filter übernimmt und alle Treffer enthält – nicht nur die
angezeigte Seite, sondern bis zu 2000 Zeilen. Das Druckfenster öffnet sich von selbst;
sonst hilft der Knopf auf der Seite.

- Eingestellt auf A4 mit Kopfzeile: Firma, Titel, Filter und Zeitpunkt des Ausdrucks.
  Der Tabellenkopf wiederholt sich auf jeder Seite, Zeilen werden nicht umgebrochen.
  Navigation, Filter und Knöpfe kommen nicht aufs Papier.
- **Bestandsliste:** je Artikel Nummer, Hersteller und die Mengen der einzelnen Lagerorte.
  Bestände auf oder unter dem Mindestbestand stehen fett mit dem Hinweis „unter
  Mindestbestand“. Ganz rechts ist eine leere Spalte **gezählt** zum Eintragen bei der Inventur.
- **Bewegungen:** Zeitpunkt, Art, Artikel, Menge mit Vorzeichen, Von/Nach und wer gebucht
  hat. Stornierte Buchungen sind durchgestrichen. Nur für Rollen, die Bewegungen sehen dürfen.

**Als PDF herunterladen:** Überall, wo es Drucken oder CSV gibt, gibt es auch **PDF**. Die
Datei entsteht am Server (pdfkit, keine Browser-Druckfunktion nötig), übernimmt die
eingestellten Filter und eignet sich zum Weiterschicken oder Ablegen:

| Dokument | Adresse |
|---|---|
| Bestandsliste | `/export/bestand.pdf` |
| Bewegungen | `/export/bewegungen.pdf` |
| Bestellliste (nach Hersteller gruppiert, mit Unterschriftszeile) | `/export/bestellliste.pdf` |
| Verbrauch je Monat | `/export/verbrauch.pdf` |
| Lohnzettel einer Woche (im Aufbau des Formulars aus dem Block) | `/stundenzettel/<id>/pdf` |
| Tagesbericht (im Aufbau des Vordrucks aus dem Block) | `/tagesberichte/<id>/pdf` |
| Fotos zum Tagesbericht (zwei je Seite, `?foto=<id>` für eines) | `/tagesberichte/<id>/fotos/pdf` |

**Lohnzettel:** Druckansicht und PDF sind dem Vordruck nachgebaut – Briefkopf mit
Lohnwoche, das Raster mit je einer Zeile pro Tag und einer schmalen für Zeit von/bis,
Gesamtstunden, VAZ, Auslöse und die beiden Unterschriftszeilen mit dem KV-Satz dazwischen.
Mit `?nodruck=1` lässt sich eine Druckansicht ohne Druckfenster anschauen.

Alle PDFs schreiben mit Liberation Sans (Ordner `fonts/`, im Docker-Image enthalten) –
so kommen auch Namen wie Kokić oder Čolić richtig aufs Papier.

Jede Seite hat Kopf (Titel, Filter) und Fuß (Anwendung, Ausdruckzeitpunkt, Seite x von y);
der Tabellenkopf wiederholt sich beim Seitenumbruch. Lohnzettel und Tagesbericht bringen
ihre Unterschriftszeilen mit. **CSV** gibt es unverändert daneben – für Excel.

**Am Handy:** Jede Druckansicht hat neben **Drucken** auch **PDF**.

- **Android-App:** **Drucken** öffnet den Android-Druckdienst (dort geht auch „Als PDF
  speichern“), **PDF** legt die Datei in „Downloads“ ab und öffnet sie. Beides übernimmt
  ein kleines Plugin der App ([`NativePlugin.java`](android/app/src/main/java/at/monsipan/intern/NativePlugin.java)),
  weil die WebView weder `window.print()` noch Downloads kann – dafür braucht es die
  aktuelle APK.
- **iPhone/iPad** (Safari und vom Home-Bildschirm): **PDF** öffnet das Teilen-Menü mit
  „In Dateien sichern“, „Drucken“ und Verschicken. Kommt beim Drucken kein Druckfenster,
  ist das der Weg.
- **Android-Browser:** Drucken und PDF wie am Computer.

Der **Lohnzettel** erscheint am Handy in einer lesbaren Fassung nach Tagen; gedruckt und
im PDF bleibt er im Aufbau des Vordrucks.

## Materialbeschreibungen (PDF)

Am Artikel lassen sich PDFs hinterlegen – Materialbeschreibungen, Sicherheitsdatenblätter
und Sonstiges. **Hochladen und entfernen** dürfen nur Admin und Bauleiter, **ansehen**
alle Angemeldeten. Bis 25 MB je Datei; der Titel wird aus dem Dateinamen vorgeschlagen.

Angezeigt werden die PDFs direkt auf der Seite (pdf.js, wird erst beim Öffnen geladen) –
auch am Android-Handy und in der Android-App, wo der Browser PDFs sonst nur herunterlädt.
Im Browser gibt es zusätzlich „Im Browser öffnen“ und „Herunterladen“.

**Ablage:** Die Datenbank kennt nur Titel, Art und Prüfsumme, die Dateien liegen im Volume
unter `/data/dokumente/<sha256>.pdf`. Dieselbe Datei an mehreren Artikeln liegt nur einmal da.
Die Sicherungen der Datenbank bleiben dadurch klein.

**Sicherungen:** Wird ein PDF entfernt oder alles zurückgesetzt, bleibt die Datei noch
90 Tage liegen. Eine in dieser Zeit eingespielte Sicherung findet ihre PDFs also wieder.
Danach räumt die tägliche Wartung unbenutzte Dateien weg. Für den Umzug auf einen anderen
Server das ganze Volume mitnehmen (Datenbank, `/data/dokumente`, `/data/fotos`, `/data/krankmeldungen`, `/data/briefkopf`, **das Rechnungsarchiv `/data/rechnungen`** **und** `/data/signatur`) – eine
hochgeladene Sicherung allein enthält die PDFs nicht.

Die Fotos der Tagesberichte liegen genauso unter `/data/fotos/<sha256>.jpg` (Foto und Vorschau)
und bleiben nach dem Löschen ebenfalls 90 Tage liegen.

## App fürs Handy

Im Lager erscheint am Handy unter **Mehr → App installieren** (und als Hinweis auf der
Übersicht) die Seite [`/app`](src/routes/(app)/app/+page.svelte). Sie zeigt je nach Gerät
den passenden Weg. Am PC steht dort nur, dass die Seite am Handy zu öffnen ist – der
Download-Knopf erscheint ausschließlich am Handy und nur angemeldet.

**Android:** echte App (Capacitor), die die laufende Webseite anzeigt. Beim ersten Mal
fragt Android, ob Apps aus dieser Quelle installiert werden dürfen, weil die Datei nicht
aus dem Play Store kommt.

> **Einmalig beim Umstieg von der Lager-App:** Die App hat eine neue Kennung
> (`at.monsipan.intern` statt `at.monsipan.lager`). Android hält sie deshalb für eine
> andere App – die neue muss installiert und die alte „Lagermanagement" danach
> deinstalliert werden. Ein Update über die alte Installation ist nicht möglich.

Fester Download-Link:

```
https://github.com/mstreicher98/Monsipan-Intern/releases/download/app/monsipan-portal.apk
```

Die App heißt am Handy „Monsipan Portal“. Ihre interne Kennung bleibt `at.monsipan.intern`
– so aktualisiert sich jede Installation ohne Neuinstallation, und die Anmeldung bei
Firebase passt weiter. Repository, Image (`monsipan-intern`) und Volume behalten ihre
Namen ebenfalls; die sieht niemand außer der Verwaltung.

**iPhone und iPad:** Apple erlaubt kein Installieren per Datei. Safari legt das Lager
stattdessen über **Teilen → Zum Home-Bildschirm** als App an – mit eigenem Symbol,
Vollbild und Kamera-Scan. Die Seite zeigt die drei Schritte mit Symbolen.

Die App ist nur eine Hülle: Inhalte, Anmeldung und Updates kommen vom Server. Eine neue
APK-Datei braucht es nur, wenn sich an der Hülle etwas ändert (Adresse, Symbol, Berechtigungen).

**Bauen:** [`.github/workflows/android.yml`](.github/workflows/android.yml) baut die APK
bei Änderungen an `android/`, `capacitor/` oder `capacitor.config.ts` und hängt sie an das
Release mit dem Tag `app`. Über **Actions → Android-App (APK) → Run workflow** lässt sich
auch eine andere Adresse mitgeben; dauerhaft geht das über die Repository-Variable `APP_URL`.
Liegt die Datei woanders, zeigt die Umgebungsvariable `APK_URL` im Container auf den
eigenen Download.

**Signatur:** Ohne hinterlegten Schlüssel wird mit dem Debug-Schlüssel signiert. Die App
lässt sich damit installieren, aber Updates über eine neue APK scheitern, weil sich die
Signatur ändert. Für den Dauerbetrieb einmalig einen Schlüssel anlegen:

```bash
keytool -genkeypair -v -keystore lager.jks -alias lager -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 lager.jks > lager.jks.base64
```

Danach unter **Settings → Secrets and variables → Actions** hinterlegen:
`ANDROID_KEYSTORE_BASE64` (Inhalt der base64-Datei), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`lager`) und `ANDROID_KEY_PASSWORD`. Die Datei `lager.jks` gut
aufbewahren – ohne sie sind keine Updates mehr möglich.

**Icons:** `npm run app:icons` erzeugt die Symbole für Webseite und Android aus einer
Zeichenvorschrift, ohne Zusatzpakete. `npm run app:sync` überträgt Adresse und
Offline-Seite ins Android-Projekt.

## Scanner einrichten

**Handscanner am PC** (USB oder Bluetooth im Tastaturmodus):

- Suffix auf **Enter** stellen (Werkseinstellung bei fast allen Geräten).
- Tastaturlayout am besten auf **Deutsch (QWERTZ)**. Steht es auf US, rechnet die App
  die Eingabe automatisch um – `y`/`z`, `:`, `|` und `=` kommen trotzdem richtig an,
  Umlaute aber meist nicht.
- Einfach auf einer beliebigen Seite scannen: Die App erkennt Scanner am typischen
  Zeichenabstand (höchstens 50 ms). Auf **Buchen** landet jeder Scan in der Liste – auch
  wenn gerade ein Mengen- oder Notizfeld aktiv ist, die Menge bleibt dann unverändert.
  Sonst öffnet sich der Artikel; in normalen Formularfeldern landet der Code als Text.
- **Bluetooth** (z. B. Inateck BCST-36, eingestellt über die App „Inateck Office“):
  Zeichen kommen oft stoßweise. Aussetzer bis 0,6 s werden überbrückt, Enter mitten im
  Code (mehrzeilige DataMatrix), CR+LF, Gruppentrenner (Strg+]) und Alt-Codes für
  Umlaute werden verstanden. Scanner ohne Enter am Ende werden nach einer kurzen Pause
  erkannt (ab 8 Zeichen). Fehlen trotzdem Zeichen, die Übertragungsgeschwindigkeit am
  Scanner verringern.
- **Scanner testen** (unter Mein Konto) zeigt, was genau ankommt und wie es zerlegt wird.
  Das **Tastenprotokoll** dort listet jede Taste mit Abstand in ms – auch bei Eingaben,
  die nicht als Scan erkannt wurden – und lässt sich zur Fehlersuche kopieren.
  Die Erkennung selbst steckt in [`src/lib/scan/detector.ts`](src/lib/scan/detector.ts).

**Handykamera:** gelber Knopf unten in der Mitte. Funktioniert in Chrome (Android) und
Safari (iPhone), nur über HTTPS. Die Erkennung läuft vollständig auf dem Gerät; die
Scanner-Bibliothek (~1 MB) wird erst geladen, wenn die Kamera zum ersten Mal geöffnet wird.

**Unbekannter Code:** Bauleitung und Admin können direkt einen Artikel anlegen – bei
Kansai-DataMatrix werden Bezeichnung, Artikelnummer, Inhalt, Farbe und Materialart
automatisch ausgefüllt – oder den Code einem bestehenden Artikel zuordnen.

**SWARCO-Palettenetiketten:** Die DataMatrix enthält vier Felder mit `$` dazwischen,
z. B. `1524603$30016618$2450240$1000,000` – Liefer-/Palettennummer, Artikelnummer,
Charge und Menge der Palette. Gesucht wird über die Artikelnummer, damit jede Lieferung
denselben Artikel findet, egal welche Palette und Charge. Beim Anlegen wird nur die
Artikelnummer übernommen; Bezeichnung, Hersteller und Inhalt je Stück trägt man selbst
ein (die Menge im Code gilt für die ganze Palette). Die Materialnummer wird mit und ohne
führende Nullen gefunden – auf dem Etikett steht `30016618`, in der Materialliste des
Lieferanten `000000000030016618`.

**Dieselbe Nummer bei zwei Artikeln:** Manche Lieferanten drucken auf verschiedene
Produkte dieselbe Nummer. Beim Speichern kommt deshalb erst die Rückfrage „gehört schon
zu …“; mit **Trotzdem speichern** wird die Nummer doppelt vergeben. Beim Scannen zeigt
die App dann alle Artikel mit dieser Nummer zur Auswahl – auch beim Buchen – statt
stillschweigend den falschen zu nehmen. Auf der Artikelseite steht unter dem Code, zu
welchen anderen Artikeln er ebenfalls gehört.

**Farben und RAL:** Unter **Stammdaten → Farben** wird eine Farbe über ihre RAL-Nummer
oder den RAL-Namen gewählt (alle 215 RAL-Classic-Farben, z. B. `6024` oder „Verkehrsgrün“);
das Farbmuster wird übernommen und lässt sich per Hex-Wert anpassen. Farben ohne
RAL-Nummer (z. B. Transparent) bekommen nur ein Hex-Farbmuster. Steht auf dem Etikett
eine RAL-Angabe wie `R6024`, ordnet der Scan die passende Farbe automatisch zu.
Die Artikelsuche findet Artikel auch über die RAL-Nummer.

## Technik und Projektstruktur

- [SvelteKit](https://svelte.dev) mit Svelte 5, serverseitig gerendert, Node-Adapter
- Tailwind CSS 4, Schrift Barlow (selbst gehostet)
- SQLite über libsql und [Drizzle ORM](https://orm.drizzle.team), Migrationen in `drizzle/`
- Kamera: native BarcodeDetector-API, sonst [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)
- E-Mail: Nodemailer, Live-Updates: Server-Sent Events
- PDF: pdfkit mit der Schrift Liberation Sans aus `fonts/` (maßgleich mit Helvetica, kann auch
  ć, č, š, ž, đ, ł usw. für Namen; Lizenz liegt daneben)

```
src/
  lib/
    modules.ts     Alle Bereiche: Beschriftung, Symbol, Pfad, Recht, aktiv oder geplant
    permissions.ts Rollen und Rechte: je Bereich Sehen, Erstellen, Bearbeiten, Status, Löschen
    app.ts         Name der Anwendung und Seitentitel
    nav.ts         Navigation, gefiltert nach Rolle
    components/    Geteilte Bausteine (Dialog, Tabelle, Diagramm, PDF-Ansicht, Navigation,
                   Handschrift auf dem Formular)
    server/        Geteilt: Datenbank, Anmeldung, Mail, Sicherungen, Dokumente, Ereignisse,
                   Benachrichtigungen (notifications.ts) und Push (push.ts)
    notifications.ts  Katalog der Benachrichtigungen und wer sie bekommen darf
    server/db/schema/   core.ts (Benutzer, Partien, Einstellungen) + je Bereich eine Datei
    modules/
      auftraege/   Auftragsmanagement: offer.ts (Beträge, Summen, Nummern), inquiry.ts
                   (E-Mail auslesen), summary.ts (Summenblatt, Zuordnung zur Rechnung),
                   server/ (Kunden, Anfragen, Angebote, Aufträge, Rechnungen, PDF), components/,
                   signature.ts (Stufen und Bezeichnungen), server/signatur/ (siehe unten)
      lager/       Alles zum Lager: server/ (Bestand, Buchungen, Warnungen),
                   components/, scan/ (Parser, Tastaturlayouts, Handscanner, Kamera)
      stunden/     Lohnwoche: Wochenrechnung und server/ (Zettel, Freigabe, Prüfung)
      tagesberichte/ server/ (Berichte, Ablauf, Kundenlink, PDF), components/ (Ansicht
                   für Handy und Kunden), sheet.ts (Aufteilung auf Blätter wie der Vordruck)
  routes/
    (auth)/        Anmelden, Passwort vergessen/zurücksetzen
    (app)/         Übersicht, lager/…, verwaltung/…, Konto, App fürs Handy
    (app)/verwaltung/import/  Import und Export (Logik in modules/auftraege/server/transfer.ts,
                   Felder in modules/auftraege/transfer.ts, Excel/CSV in server/table.ts)
    (kunde)/       Seiten für Kunden ohne Anmeldung: Tagesbericht unterschreiben, Angebot annehmen,
                   Rechnung prüfen (/pruefen/<schlüssel>)
    api/           Code-Suche, Artikelsuche, Live-Ereignisse
    export/        CSV-Exporte (Excel-kompatibel) und Backup-Download
```

**Rechnungssignatur** (`src/lib/modules/auftraege/server/signatur/`) – modular, jeder
Baustein für sich getestet:

| Baustein | Datei |
|---|---|
| InvoiceSigningService – ausstellen, signieren, stornieren | `signing.ts` |
| InvoiceVerificationService – Archiv, Daten und Signatur prüfen, Prüfseite, Archivprüfung | `verification.ts` |
| InvoiceArchiveService – unveränderliche Ablage, Prüfsummen, Aufbewahrung | `archive.ts` |
| InvoiceAuditService – Protokoll mit Hash-Kette | `audit.ts` |
| SignatureProviderInterface – eigenes Zertifikat und CSC-API (A-Trust) | `provider.ts`, `csc.ts`, `keys.ts` |
| PAdES: PDF-Revisionen, CMS, Zeitstempel, OCSP/CRL, DSS, Prüfen | `pdf-update.ts`, `cms.ts`, `tsa.ts`, `revocation.ts`, `pades.ts`, `verify-pdf.ts` |

Ein weiterer Anbieter implementiert `SignatureProvider` (Zertifikatskette liefern, Hash
signieren) und bekommt einen Eintrag in `createProvider()`. Gebaut auf pkijs/asn1js (CMS,
Zeitstempel, OCSP), node-forge (.p12 lesen) und qrcode.

**Ein neuer Bereich** braucht: einen Eintrag in `modules.ts` (zunächst `status: 'geplant'`),
seinen Rechte-Block in `permissions.ts`, seine Tabellen in `server/db/schema/<bereich>.ts`,
seinen Code unter `lib/modules/<bereich>/` und seine Seiten unter `routes/(app)/<bereich>/`.
Sobald er läuft, wird aus `'geplant'` ein `'aktiv'` – dann erscheint er in der Navigation
und auf der Übersicht. `'leer'` zeigt eine Kategorie schon als Überschrift in der
Seitenleiste, bevor sie Einträge hat. Mehrere Seiten
unter einer Überschrift sind ein Bereich mit `items` (wie Dokumentation); mit
`cardsPerItem` bekommt auf der Übersicht jede Seite ihre eigene Karte.

**Buchungslogik:** Jede Buchung ist eine unveränderliche Bewegung. Korrekturen stornieren
die alte Bewegung und legen eine neue an – der Bestand je Lagerort wird in derselben
Transaktion fortgeschrieben, gleichzeitige Buchungen können sich nicht überschneiden.
