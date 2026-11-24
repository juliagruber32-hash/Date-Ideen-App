# Datewell

*Your next favorite memory.*

Mobile Web-App für Paare: Budget und Tag eingeben, wettertaugliche Date-Vorschläge bekommen,
einen fertigen Plan mit Uhrzeiten und Links erstellen – allein als Überraschung, auf Wunsch des Partners
oder gemeinsam per Abstimmung. Dazu: Orte in der Nähe entdecken, eigene Ideen, gemeinsamer Kalender
mit Google-Anbindung, To-do- und Einkaufsliste.

## Einrichtung (einmalig)

Die App läuft ohne Einrichtung auf einem Gerät. Für alles andere gibt es drei Schritte. Nur Schritt 1 ist nötig,
damit Standort, Wetter und Ortssuche funktionieren.

### 1. Webseite veröffentlichen (GitHub Pages, ca. 3 Minuten)

GitHub Pages ist für private Repositories kostenpflichtig. Deshalb das Repository öffentlich machen
(der Code enthält keine persönlichen Daten – eure Dates liegen auf den Handys bzw. in Supabase):

1. Auf github.com dein Repository **Date-Ideen-App** öffnen.
2. Oben rechts auf **Settings** (Zahnrad) tippen. Am Handy ggf. erst auf „…“ tippen.
3. Ganz nach unten scrollen zu **Danger Zone** → **Change visibility** → **Change to public** → bestätigen.
4. Links im Menü **Pages** wählen.
5. Unter **Build and deployment** → **Source**: „Deploy from a branch“.
6. Unter **Branch**: `claude/new-session-8eur1k` und Ordner `/ (root)` wählen → **Save**.
7. Nach 1–2 Minuten ist die App erreichbar unter
   **https://juliagruber32-hash.github.io/Date-Ideen-App/**

Am Handy öffnen und über **Teilen → Zum Home-Bildschirm** (iPhone) bzw. **⋮ → App installieren** (Android)
wie eine echte App installieren.

### 2. Gemeinsam nutzen (Supabase, kostenlos, ca. 10 Minuten)

Damit ihr beide dieselben Dates, Listen und Abstimmungen seht und Überraschungen geheim bleiben:

1. Auf **supabase.com** ein kostenloses Konto anlegen (z. B. mit GitHub anmelden).
2. **New project**: Name `dately`, ein Datenbank-Passwort generieren lassen (wird nicht weiter gebraucht),
   Region **Central EU (Frankfurt)** → **Create new project**. Kurz warten.
3. Links **SQL Editor** → **New query**. Den kompletten Inhalt der Datei
   [`supabase/setup.sql`](supabase/setup.sql) hineinkopieren → **Run**. Es sollte „Success“ erscheinen.
4. **Konten einstellen** – links **Authentication**:
   - **Sign In / Providers → Email**: muss eingeschaltet sein (Standard). Hier entscheidest du bei
     **„Confirm email“**, ob neue Konten ihre E-Mail-Adresse erst per Link bestätigen müssen (empfohlen).
   - **URL Configuration**: bei **Site URL** `https://juliagruber32-hash.github.io/Date-Ideen-App/` eintragen
     und dieselbe Adresse unter **Redirect URLs** hinzufügen → **Save**. Sonst führen die Links in den
     Bestätigungs- und „Passwort vergessen“-Mails ins Leere.
   - Optional **Emails → Templates**: die Texte der Mails auf Deutsch übersetzen.
   - Gut zu wissen: Der eingebaute Mail-Versand von Supabase schickt nur wenige Mails pro Stunde. Für euch zwei
     reicht das. Sollen viele Leute Datewell nutzen, unter **Emails → SMTP Settings** einen Mail-Dienst wie
     Brevo oder Resend (beide mit kostenlosem Kontingent) eintragen.
5. Oben auf **Connect** tippen (oder **Project Settings → API Keys**). Kopiere:
   - **Project URL** (sieht aus wie `https://abcd1234.supabase.co`)
   - **Publishable key** bzw. **anon public** key
6. Entweder in der App: **Planen → Zahnrad oben rechts → Gemeinsam nutzen** – beide Werte einfügen → **Verbinden**.
   **Oder (empfohlen, nötig für die Community):** beide Werte in [`js/config.js`](js/config.js) eintragen
   (oder Claude schicken, dann trägt Claude sie ein). Dann verbindet sich die App für alle automatisch –
   auch für andere Paare, die eure Webseite nutzen. Beide Werte sind öffentlich gedacht, geschützt wird
   über die Zugriffsregeln aus `setup.sql`.
7. In Datewell ein **Konto erstellen** (Benutzername, E-Mail, Passwort). Danach unter **Zahnrad → Gemeinsam nutzen**
   den **Einladungslink** kopieren und der anderen Person schicken. Sie erstellt über den Link ihr eigenes Konto
   und ist danach automatisch mit dir verbunden.

Gut zu wissen: Kostenlose Supabase-Projekte pausieren nach etwa einer Woche ohne Nutzung. Dann im
Supabase-Dashboard auf **Restore** tippen – die Daten bleiben erhalten.

### 3. Google Kalender (optional, ca. 10 Minuten)

Ohne Einrichtung funktioniert immer der Knopf **„Zu Google Kalender“** beim Date (öffnet Google Kalender mit
vorausgefülltem Termin) sowie **„Handy-Kalender (.ics)“** für iPhone und Android.

Damit die App eure Termine **lesen** kann (zeigt, wann ihr schon etwas vorhabt) und Dates **automatisch**
einträgt, braucht sie eine Client-ID von Google:

1. **console.cloud.google.com** öffnen, mit deinem Google-Konto anmelden, oben **Projekt auswählen → Neues Projekt**
   (Name `Date-Ideen`) → **Erstellen**.
2. Suchfeld oben: **Google Calendar API** → öffnen → **Aktivieren**.
3. Suchfeld: **Google Auth Platform** (früher „OAuth-Zustimmungsbildschirm“) → **Jetzt starten**:
   App-Name `Date-Ideen`, deine E-Mail, Zielgruppe **Extern** → fertigstellen.
4. Unter **Zielgruppe** → **Testnutzer** → beide Gmail-Adressen (deine und die deines Partners) hinzufügen.
5. Unter **Datenzugriff** → **Bereiche hinzufügen** → `.../auth/calendar.events` auswählen → speichern.
6. Unter **Clients** → **Client erstellen** → Typ **Webanwendung** →
   **Autorisierte JavaScript-Quellen**: `https://juliagruber32-hash.github.io` → **Erstellen**.
7. Die **Client-ID** (endet auf `.apps.googleusercontent.com`) kopieren.
8. In der App: **Zahnrad → Google Kalender** → Client-ID einfügen → **Mit Google verbinden**.
   Google zeigt einen Hinweis „App nicht überprüft“ – das ist bei privaten Apps normal: **Weiter**.

Ihr verbindet beide euren eigenen Google Kalender. Die andere Person sieht von deinen Terminen nur „belegt“, keine Titel.
Die Google-Verbindung hält etwa eine Stunde; danach im Kalender-Tab auf **Verbinden** tippen.

### 4. Google-Bewertungen (optional)

**Bildrechte:** Datewell zeigt nur frei lizenzierte Fotos von Wikimedia Commons (mit Urheber und Lizenz direkt
am Foto) und eure eigenen Fotos. Fotos aus Google Maps werden nicht angezeigt – sie gehören den jeweiligen
Fotografen bzw. Google. Eigene Fotos einer Location bitte nur mit deren schriftlicher Erlaubnis einbauen.

Für Google-Sterne direkt in der App:

1. In der Google Cloud Console (gleiches Projekt wie Schritt 3) **Places API (New)** aktivieren.
   Google verlangt dafür ein Abrechnungskonto; für ein Paar bleibt die Nutzung im kostenlosen Kontingent.
2. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**.
3. Den Schlüssel einschränken: **Anwendungseinschränkung: Websites** → `https://juliagruber32-hash.github.io/*`,
   **API-Einschränkung: Places API (New)**.
4. In der App: **Zahnrad → Weitere Datenquellen → Google-Places-Schlüssel** einfügen.

Die App zeigt dann Google-Sterne auf den Date-Karten und im Plan und merkt sich jedes Ergebnis 7 Tage,
damit möglichst wenige Abfragen anfallen.

### 5. Veranstaltungen in der Nähe (optional, ca. 3 Minuten)

Konzerte, Shows, Theater und Festivals kommen von Ticketmaster (kostenlos):

1. Auf **developer.ticketmaster.com** ein Konto anlegen.
2. Unter **My Apps** steht der **Consumer Key** – kopieren.
3. In Datewell: **Zahnrad → Weitere Datenquellen → Ticketmaster API Key** einfügen.

Weihnachtsmärkte, Eislaufen, Open-Air-Kinos und Badeseen findet Datewell auch ohne Schlüssel über die Kartendaten (OpenStreetMap) – passend zur Jahreszeit.

### 6. Datewell-Server für Orte & Google (empfohlen, ca. 10 Minuten)

Damit Orte in 1–2 Sekunden statt in Minuten laden und Google-Daten (Sterne, Fotos, Öffnungszeiten) sicher über
euren Server kommen, gibt es die Server-Funktion `places`. Sie merkt sich alle Ergebnisse 7 Tage – eine Suche
hilft also allen.

1. **Tabelle anlegen:** Supabase → **SQL Editor** → **New query** → Inhalt von
   [`supabase/places.sql`](supabase/places.sql) einfügen → **Run**.
2. **Funktion anlegen:** Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
   - Name: `places`
   - Den gesamten Inhalt von [`supabase/functions/places/index.ts`](supabase/functions/places/index.ts) einfügen
     (vorhandenen Beispielcode vorher löschen) → **Deploy function**.
3. **Anmeldeprüfung umstellen:** In der Funktion `places` → **Details** → **Enforce JWT verification** ausschalten
   → **Save**. (Die Funktion prüft die Anmeldung selbst; nur so können Fotos direkt angezeigt werden.)
4. **Google-Schlüssel hinterlegen (optional):** **Edge Functions** → **Secrets** → **Add new secret**:
   - Name `GOOGLE_PLACES_KEY`, Wert: euer Google-Places-Schlüssel (`AIza…`).
   - Optional `GOOGLE_DAILY_LIMIT`, z. B. `300` (max. Google-Abfragen pro Tag, schützt vor Kosten).
5. Datewell neu öffnen. Unter **Einstellungen → Weitere Datenquellen** steht dann „Datewell-Server ist eingerichtet“.

Ohne diese Funktion arbeitet die App wie bisher (langsamer, direkt vom Handy aus).

### 7. Mitteilungen aufs Handy (ca. 5 Minuten)

Erinnerungen am Vorabend und 2 Stunden vorher, „Wie war’s?“ am Tag danach und sofortige Hinweise bei neuen
Überraschungen, Date-Wünschen und Matches. Überraschungen bleiben dabei geheim.

1. **Tabellen & Zeitplan:** Supabase → **SQL Editor** → **New query** → Inhalt von
   [`supabase/notify.sql`](supabase/notify.sql) einfügen → **Run**.
2. **Funktion anlegen:** **Edge Functions** → **Deploy a new function** → **Via Editor** → Name `notify` →
   Inhalt von [`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts) einfügen → **Deploy function**.
3. In der Funktion `notify` → **Details** → **Enforce JWT verification** ausschalten → **Save**.
4. In Datewell (jede Person auf ihrem Handy): **Einstellungen → Mitteilungen → Mitteilungen aktivieren**.
   - **iPhone:** Mitteilungen gibt es nur, wenn Datewell auf dem Home-Bildschirm liegt
     (Safari → Teilen → „Zum Home-Bildschirm“) und von dort geöffnet wird.

### 8. Kalender-Abo für Apple & Google (ca. 3 Minuten)

Damit eure Dates automatisch im Apple Kalender (iPhone, Mac) oder Google Kalender erscheinen:

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** → Name `calendar` →
   Inhalt von [`supabase/functions/calendar/index.ts`](supabase/functions/calendar/index.ts) einfügen → **Deploy function**.
2. In der Funktion `calendar` → **Details** → **Enforce JWT verification** ausschalten → **Save**
   (Kalender-Apps können sich nicht anmelden; geschützt ist das Abo über einen langen, geheimen Link pro Person).
3. In Datewell: **Kalender → Kalender verbinden → Im Apple Kalender abonnieren**. Bei Google: Link kopieren und
   im Google Kalender unter **Weitere Kalender → Per URL** einfügen.

Überraschungen erscheinen bei der überraschten Person nur als „Überraschung von …“ mit Uhrzeit und Hinweis.
Ohne diese Funktion bietet Datewell eine Kalenderdatei mit den kommenden Dates zum Hinzufügen an.
Hinweis: Apple erlaubt Web-Apps keinen Zugriff auf andere Termine im iPhone-Kalender – deshalb geht die Verbindung
nur in eine Richtung (Datewell → Kalender).

### 9. Mit Apple anmelden (optional, kostet 99 €/Jahr)

„Mit Apple anmelden“ ist vorbereitet, aber ausgeschaltet. Apple verlangt dafür eine Mitgliedschaft im
Apple Developer Program (99 € im Jahr). Pflicht ist es nur für Apps im App Store, die andere Logins wie Google
anbieten – Datewell als Web-App mit E-Mail-Login braucht es nicht.
Zum Einschalten: im Apple-Developer-Konto eine **Services ID** mit „Sign in with Apple“ anlegen, in Supabase unter
**Authentication → Sign In / Providers → Apple** eintragen und in [`js/config.js`](js/config.js) `apple: true` setzen.

### 10. Community: Melden, Blockieren, Moderation (ca. 3 Minuten, Pflicht vor dem Start)

Eigene Dates sind privat. Erst wer zum ersten Mal teilt, wählt einen Anzeigenamen (Vorname, Paarname oder ohne
Namen) und bestätigt die Community-Regeln. Ein Paarname erscheint erst, wenn beide zugestimmt haben. Andere sehen
nur die Stadt bzw. Region und öffentliche Orte – nie eine Adresse oder den Startpunkt.

Für den App Store (Richtlinie 1.2 „User-Generated Content“) und den Digital Services Act braucht es Melden,
Blockieren und Moderation. Das ist eingebaut:

- **Melden** mit Grund für geteilte Dates und Kommentare, **Blockieren** von Personen (aufheben in den Einstellungen).
- Nach drei Meldungen wird ein Inhalt **vorläufig ausgeblendet**, bis jemand entscheidet.
- **Moderation** in der App (Einstellungen → Community → Moderation öffnen): In Ordnung, Ausblenden mit Begründung,
  Löschen oder Person sperren. Gesperrte können nichts mehr teilen oder bewerten.
- Die betroffene Person sieht die **Begründung** und kann **Einspruch** einlegen; Einsprüche landen wieder in der Moderation.
- Offene Meldungen erscheinen für Moderator:innen als Hinweis auf der Startseite.

Einrichten:
1. Supabase → **SQL Editor** → Inhalt von [`supabase/community.sql`](supabase/community.sql) einfügen → **Run**.
2. Dich als Moderatorin eintragen – die letzte Zeile der Datei mit deiner E-Mail-Adresse ausführen:
   `insert into public.community_moderators (user_id) select id from auth.users where email = 'deine@adresse.de';`
3. Wichtig: Meldungen wirklich zeitnah prüfen (Apple erwartet eine Reaktion innerhalb von 24 Stunden).
   Die Kontakt-E-Mail im Impressum ist zugleich die Kontaktstelle nach dem Digital Services Act.

## Veröffentlichen – kostenlos

Alles hier geht ohne laufende Kosten. Reihenfolge einhalten, Häkchen setzen:

**1. Datenbank-Rechte (Pflicht)**
- [ ] Supabase → SQL Editor → Inhalt von [`supabase/grants.sql`](supabase/grants.sql) → **Run**
  (Zugriffsrechte, Fehlerprotokoll, Aufräumen leerer Paare).

**2. Rechtliches (Pflicht in Deutschland)**
- [ ] In [`js/legal.js`](js/legal.js) Name, Anschrift, E-Mail und Supabase-Region eintragen (alles in `[eckigen Klammern]`).
- [ ] Impressum, Datenschutzerklärung und Nutzungsbedingungen von einer fachkundigen Person prüfen lassen
  (die Texte sind sorgfältige Vorlagen, aber keine Rechtsberatung).
- [ ] Supabase → **Settings → Legal Documents**: den Vertrag zur Auftragsverarbeitung (DPA) abschließen (kostenlos).
- [ ] Prüfen, dass das Supabase-Projekt in der EU liegt (Project Settings → General → Region, z. B. Frankfurt).

**3. E-Mails zuverlässig verschicken (kostenlos bis 300 E-Mails/Tag)**
Ohne eigenen Versand schickt Supabase nur wenige E-Mails pro Stunde – bei mehreren neuen Nutzern kommen Bestätigungen nicht an.
- [ ] Kostenloses Konto bei **Brevo** (brevo.com) anlegen → *SMTP & API* → SMTP-Zugang erzeugen.
- [ ] Supabase → **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*:
  Host `smtp-relay.brevo.com`, Port `587`, Benutzer und Passwort aus Brevo, Absender z. B. `Datewell`.
- [ ] **Authentication → Emails → Templates**: „Confirm signup“ und „Reset password“ durch
  [`supabase/email/bestaetigen.html`](supabase/email/bestaetigen.html) und [`supabase/email/passwort.html`](supabase/email/passwort.html) ersetzen
  (Betreffzeilen stehen jeweils oben in der Datei).
- [ ] **Authentication → URL Configuration**: *Site URL* = Adresse der App, unter *Redirect URLs* dieselbe Adresse eintragen.

**4. Kosten im Griff (Google)**
- [ ] Google Cloud → **Abrechnung → Budgets & Benachrichtigungen**: Budget **1 €** mit E-Mail-Warnung anlegen.
- [ ] Supabase → Edge Functions → Secrets: `GOOGLE_DAILY_LIMIT` = `150`. Google gewährt pro Monat ein kostenloses Kontingent;
  mit dem Tageslimit bleibt ihr darunter. Ohne Google-Schlüssel funktioniert alles weiter (mit OpenStreetMap-Daten).

**5. Gratis-Grenzen kennen**
- Supabase Free: 500 MB Datenbank, 1 GB Fotos, 50.000 aktive Nutzer im Monat. Ein Projekt ohne jede Nutzung wird nach
  7 Tagen pausiert – im Dashboard mit einem Klick fortsetzbar.
- GitHub Pages: kostenlos für öffentliche Projekte. Im Projekt liegen keine Geheimnisse (der Supabase-Schlüssel in `config.js` ist öffentlich gedacht).
- OpenStreetMap-Dienste sind für kleine Apps frei nutzbar; Datewell fragt sie sparsam an und merkt sich Ergebnisse auf dem Server.

**6. Vor dem Start testen**
- [ ] Zwei neue Testkonten anlegen, verbinden (Einladungslink), Namen eintragen, abmelden, auf einem anderen Gerät anmelden: alles muss da sein.
- [ ] Ein Date planen, Überraschung prüfen (die andere Person darf nichts sehen), Mitteilungen testen.
- [ ] Ein paar befreundete Paare einladen und Feedback sammeln.
- Fehler aus der App landen in Supabase in der Tabelle `client_errors` (Table Editor).

## Funktionen

| Bereich | Inhalt |
| --- | --- |
| **Planen** | „Wer plant?“: *Ich* (optional als Überraschung mit Hinweis), *die andere Person* (Anfrage senden) oder *Zusammen*: beide beantworten getrennt eine kurze Umfrage (Tage, Tageszeit, Lust, drinnen/draußen, Budget, Entfernung), die App findet den besten gemeinsamen Tag, schlägt passende Ideen vor und ihr stimmt ab bis zum Match. Die App legt fest, wer mit Planen dran ist (abwechselnd, mit „Tauschen“), und erinnert, wenn ein Date fällig ist. Wann, Budget, Entfernung, Standort per GPS. Warnung, wenn an dem Tag schon Termine stehen. „Für dich“-Postfach mit Anfragen, Abstimmungen und Überraschungen. Date-Rhythmus und wer als Nächstes plant. |
| **Entdecken → Für euch** | Startet sofort mit Vorschlägen: passende Ideen fürs heutige Wetter und eure Bewertungen, Orte in der Nähe (abends Restaurants & Bars, tagsüber Cafés & Museen), beliebte Community-Ideen. Filter für Standort, Tageszeit, Budget, Stimmung, drinnen/draußen und Entfernung. |
| **Entdecken → Gemerkt** | Favoriten (Herz bei jeder Idee, jedem Ort und jeder Community-Idee) und eigene Ideen. Favoriten kommen auch bei Vorschlägen vor. |
| **Entdecken → Orte** | Restaurants (mit Küchen- und Vegan-Filter), Cafés, Bars, Weinbars, Eis, Museen, Kinos, Theater, Bowling, Bouldern, Escape Rooms, Minigolf, Zoo, Parks, Aussichtspunkte, Therme, Eislaufen – mit Bild, Entfernung, Öffnungszeiten und Eintritt, wo bekannt. Filter nach Stimmung. Tippen öffnet die Detailseite: Wochen-Öffnungszeiten, Google-Bewertungen, **Reservieren** (Webseite, OpenTable-Suche), **Anfahrt** zu Fuß/Rad/Bahn/Auto mit geschätzter Dauer und Google Maps bzw. Apple Karten. |
| **Entdecken → Community** | Dates anderer Paare: übernehmen, merken, bewerten, melden. Sortiert nach Bewertung, Nähe oder neu. Eigene Dates teilt ihr nach dem Date mit „Mit der Community teilen“ (ohne Namen und private Daten). |
| **Entdecken → Eure Ideen** | Eigene Ideen mit Stimmung, gemerkte Orte und Community-Ideen. |
| **Kosten** (im Tab Dates) | Ausgaben pro Monat, wer wie viel bezahlt hat, Ausgleich („Alex schuldet dir 32 €“). Aufteilung halbe-halbe oder eingeladen. Ausgaben lassen sich vor der anderen Person verstecken – z. B. für Überraschungen. |
| **Fotos & Erinnerung** | Zu jedem Date Fotos hochladen – nur für euch zwei oder öffentlich (erscheinen dann in der Community) – und einen Satz „Was war besonders?“. Fotos werden vor dem Hochladen verkleinert. Ohne Supabase bleiben sie auf dem Gerät. |
| **Jahresrückblick** (im Tab Dates) | Digitales Fotobuch: Titelseite mit Collage, euer Jahr in Zahlen (ohne Kosten), eine Seite pro Date mit Fotos, Erinnerung und Bewertung. Als PDF speichern über den Druckdialog. |
| **Empfehlungen** | Auf der Startseite: Ideen, die zu euren Bewertungen passen („Weil euch … gefallen hat“). Auch die normalen Vorschläge berücksichtigen eure Bewertungen und die Stimmung. |
| **Kalender** | „Gemeinsamen Tag finden“: beide markieren, wann sie Zeit haben (mit Hinweis auf Termine aus Google Kalender). Monatsansicht mit Dates, Anfragen, Abstimmungen, festen Terminen, besonderen Tagen, eigenen Terminen, To-dos, Google-Terminen und den belegten Zeiten des Partners. |
| **Listen** | To-do (mit Zuständigkeit und Fälligkeit) und Einkaufsliste. |
| **Dates** | Geplante Dates und Erinnerungen mit Bewertung von beiden. |
| **Einstellungen** (Zahnrad) | Namen, „Ich bin“, Gemeinsam nutzen, Stadt, vegan, Rhythmus, feste Termine, besondere Tage, Google Kalender, Backup speichern/laden. |

**Wetter** kommt automatisch von [Open-Meteo](https://open-meteo.com) für den Standort bzw. die Stadt. Bei Regen
gibt es nur Drinnen-Ideen. **Preise** sind in OpenStreetMap oft nicht eingetragen – dann zeigt die App
„Preis auf der Webseite“ und verlinkt die Webseite des Ortes.

### Die Claude-Version

Die App läuft auch als Claude-Artifact (geteilter Link aus Claude). Dort funktioniert gemeinsames Planen über
Claude, aber Claude erlaubt dort keinen Standort, kein automatisches Wetter und keine Ortssuche. Mit
**Backup speichern** (Claude-Version) und **Backup laden** (Webseite) lassen sich Daten umziehen.

## Technik

Kein Build-Schritt. Lokal testen:

```bash
python3 -m http.server 8000   # dann http://localhost:8000
```

```
index.html              App-Hülle, Tab-Leiste
css/app.css             Design (hell/dunkel)
js/app.js               Bildschirme und Abläufe
js/store.js             Datenhaltung: lokal, Claude-DB oder Supabase; feldgenaue Synchronisierung
js/remote.js            Supabase-Anbindung (Konten mit E-Mail + Passwort, Paar-Code, Live-Updates)
js/places.js            GPS, Ortsname, Overpass-Ortssuche, Öffnungszeiten
js/gcal.js              Google Kalender (lesen, eintragen, Vorlage-Link)
js/gplaces.js           Google-Bewertungen und Fotos (optional, eigener Schlüssel)
js/photos.js            Fotos verkleinern, speichern (Supabase Storage oder Gerät), anzeigen
js/config.js            Fester Supabase-Zugang für alle Nutzer (für die Community)
js/engine.js            Vorschläge, Plan mit Uhrzeiten, .ics, Rhythmus
js/weather.js           Open-Meteo
js/special.js           Jahrestag, Valentinstag, Geburtstage
data/ideas.json         46 eingebaute Date-Ideen
supabase/setup.sql      Tabellen, Zugriffsregeln, Funktionen für Supabase
```

Neue eingebaute Ideen kommen in `data/ideas.json`; eigene Ideen legt ihr direkt in der App an.
