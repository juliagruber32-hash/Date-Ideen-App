# Dately

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
     reicht das. Sollen viele Leute Dately nutzen, unter **Emails → SMTP Settings** einen Mail-Dienst wie
     Brevo oder Resend (beide mit kostenlosem Kontingent) eintragen.
5. Oben auf **Connect** tippen (oder **Project Settings → API Keys**). Kopiere:
   - **Project URL** (sieht aus wie `https://abcd1234.supabase.co`)
   - **Publishable key** bzw. **anon public** key
6. Entweder in der App: **Planen → Zahnrad oben rechts → Gemeinsam nutzen** – beide Werte einfügen → **Verbinden**.
   **Oder (empfohlen, nötig für die Community):** beide Werte in [`js/config.js`](js/config.js) eintragen
   (oder Claude schicken, dann trägt Claude sie ein). Dann verbindet sich die App für alle automatisch –
   auch für andere Paare, die eure Webseite nutzen. Beide Werte sind öffentlich gedacht, geschützt wird
   über die Zugriffsregeln aus `setup.sql`.
7. In Dately ein **Konto erstellen** (Benutzername, E-Mail, Passwort). Danach unter **Zahnrad → Gemeinsam nutzen**
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

### 4. Google-Bewertungen & Fotos (optional)

Ohne Einrichtung zeigt die App Bilder aus Wikimedia (für bekannte Orte wie Museen) und verlinkt bei jedem
Ort die Google-Bewertungen. Für Google-Sterne und Fotos direkt in der App:

1. In der Google Cloud Console (gleiches Projekt wie Schritt 3) **Places API (New)** aktivieren.
   Google verlangt dafür ein Abrechnungskonto; für ein Paar bleibt die Nutzung im kostenlosen Kontingent.
2. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**.
3. Den Schlüssel einschränken: **Anwendungseinschränkung: Websites** → `https://juliagruber32-hash.github.io/*`,
   **API-Einschränkung: Places API (New)**.
4. In der App: **Zahnrad → Weitere Datenquellen → Google-Places-Schlüssel** einfügen.

Die App zeigt dann Google-Sterne und Fotos auf den Date-Karten und im Plan und merkt sich jedes Ergebnis 7 Tage,
damit möglichst wenige Abfragen anfallen.

### 5. Veranstaltungen in der Nähe (optional, ca. 3 Minuten)

Konzerte, Shows, Theater und Festivals kommen von Ticketmaster (kostenlos):

1. Auf **developer.ticketmaster.com** ein Konto anlegen.
2. Unter **My Apps** steht der **Consumer Key** – kopieren.
3. In Dately: **Zahnrad → Weitere Datenquellen → Ticketmaster API Key** einfügen.

Weihnachtsmärkte, Eislaufen, Open-Air-Kinos und Badeseen findet Dately auch ohne Schlüssel über die Kartendaten (OpenStreetMap) – passend zur Jahreszeit.

### 6. Dately-Server für Orte & Google (empfohlen, ca. 10 Minuten)

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
5. Dately neu öffnen. Unter **Einstellungen → Weitere Datenquellen** steht dann „Dately-Server ist eingerichtet“.

Ohne diese Funktion arbeitet die App wie bisher (langsamer, direkt vom Handy aus).

### 7. Mitteilungen aufs Handy (ca. 5 Minuten)

Erinnerungen am Vorabend und 2 Stunden vorher, „Wie war’s?“ am Tag danach und sofortige Hinweise bei neuen
Überraschungen, Date-Wünschen und Matches. Überraschungen bleiben dabei geheim.

1. **Tabellen & Zeitplan:** Supabase → **SQL Editor** → **New query** → Inhalt von
   [`supabase/notify.sql`](supabase/notify.sql) einfügen → **Run**.
2. **Funktion anlegen:** **Edge Functions** → **Deploy a new function** → **Via Editor** → Name `notify` →
   Inhalt von [`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts) einfügen → **Deploy function**.
3. In der Funktion `notify` → **Details** → **Enforce JWT verification** ausschalten → **Save**.
4. In Dately (jede Person auf ihrem Handy): **Einstellungen → Mitteilungen → Mitteilungen aktivieren**.
   - **iPhone:** Mitteilungen gibt es nur, wenn Dately auf dem Home-Bildschirm liegt
     (Safari → Teilen → „Zum Home-Bildschirm“) und von dort geöffnet wird.

### Community: Gut zu wissen

Wenn andere Paare eure Webseite nutzen und Ideen teilen, betreibst du eine Plattform mit Inhalten von Nutzern.
Ideen werden nach drei Meldungen automatisch ausgeblendet; löschen kannst du sie in Supabase unter
**Table Editor → community_ideas**. Wenn die App öffentlich beworben wird, braucht sie in Deutschland und
Österreich ein Impressum und eine Datenschutzerklärung.

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
