# Date-Ideen-App

Mobile Web-App für Paare: Budget und Tag eingeben, wettertaugliche Date-Vorschläge bekommen,
mit einem Tipp einen fertigen Plan mit Uhrzeiten und Links erstellen und in den Kalender eintragen.
Dazu gibt es einen gemeinsamen Kalender, eine To-do- und eine Einkaufsliste.

Prototyp nach dem Konzept: kein Login, alle Daten bleiben im Browser (localStorage),
Wetter kommt von [Open-Meteo](https://open-meteo.com) (kostenlos, ohne Anmeldung),
die Date-Ideen stehen in `data/ideas.json`.

## Starten

Die App braucht keinen Build-Schritt, muss aber über einen Webserver laufen (nicht per Doppelklick auf `index.html`):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

**Auf dem Handy:** Ordner auf einen statischen Host legen (z. B. GitHub Pages: Settings → Pages → Branch wählen)
und die Seite im Handy-Browser öffnen. Über „Teilen → Zum Home-Bildschirm“ (iPhone) bzw. „App installieren“ (Android)
wird sie wie eine echte App installiert und funktioniert danach auch offline (Wetter braucht Internet).

## Bildschirme

| Tab | Inhalt |
| --- | --- |
| **Finden** | Wann (heute Abend / Wochenende / Datum), Tageszeit, Budget, Entfernung, Stadt. Erinnerungen an Jahrestag & Co. sowie euren Date-Rhythmus. |
| → Vorschläge | 1–3 Karten mit Wetter, Kosten, Dauer und Ablauf. „Andere Ideen“ würfelt neu. Bei Regen nur Drinnen-Ideen. |
| → Date-Plan | Ablauf mit Uhrzeiten (Startzeit anpassbar), pro Station Links zu Orten (Google Maps), Webseiten oder Rezepten. „In Kalender eintragen“. |
| **Kalender** | Monatsansicht mit Dates, festen Terminen, besonderen Tagen, eigenen Terminen und fälligen To-dos. Fortschritt zum Monatsziel. |
| **Listen** | To-do (mit Zuständigkeit und Fälligkeit) und Einkaufsliste. Zutaten und Reservierungs-To-dos lassen sich aus einem Date übernehmen. |
| **Dates** | Geplante und vergangene Dates, vergangene mit Herzen bewerten. Export als `.ics` für den Handy-Kalender. |
| **Mehr** | Namen, Stadt, vegan-Modus, Dates pro Monat, Jahrestag, Valentinstag, Geburtstage/besondere Tage, feste Termine, Backup. |

## Wie die Vorschläge entstehen

`js/engine.js` filtert die Ideen nach Budget, Entfernung, Tageszeit und Wetter (Regen → nur drinnen,
Sternegucken nur bei klarem Himmel) und bewertet sie dann: gutes Wetter bevorzugt Draußen-Ideen, Kälte
Drinnen-Ideen; zuletzt gemachte Dates werden seltener vorgeschlagen; liegt der Tag nahe an einem
besonderen Tag, kommen die „besonderen“ Ideen nach vorne. Im vegan-Modus suchen Essens-Links nach
veganen Orten und Rezepte tauschen Zutaten aus.

## Neue Ideen hinzufügen

Ein Eintrag in `data/ideas.json`:

```json
{
  "id": "eindeutige-id",
  "title": "Titel",
  "emoji": "🎳",
  "teaser": "Ein Satz Beschreibung",
  "place": "drinnen",          // oder "draußen"
  "cost": 35,                  // geschätzt, für beide zusammen in €
  "reach": 1,                  // 0 = zuhause, 1 = in der Stadt, 2 = Ausflug
  "times": ["abend", "tag"],
  "special": false,            // true = für Jahrestag & Co.
  "needsClear": false,         // true = nur bei klarem Himmel
  "start": { "abend": "19:00" },
  "steps": [
    { "t": "Station", "min": 90, "q": "Suchbegriff für Maps", "url": "https://…",
      "food": true, "book": true, "todo": "Tisch reservieren", "note": "Tipp" }
  ],
  "recipe": { "name": "…", "url": "…", "ingredients": ["Mehl", { "std": "Käse", "vegan": "Hefeflocken" }] }
}
```

## Struktur

```
index.html            App-Hülle + Tab-Leiste
css/app.css           Design (hell/dunkel)
js/app.js             Router + alle Bildschirme
js/engine.js          Vorschläge, Plan, .ics, Date-Rhythmus
js/weather.js         Open-Meteo (Geocoding + Vorhersage)
js/special.js         Jahrestag, Valentinstag, Geburtstage
js/store.js           Speicherung im Browser
data/ideas.json       46 Date-Ideen
sw.js, manifest.webmanifest, icons/   Installierbar & offline
```

## Später (laut Konzept)

Echte Orte über Google Places/OpenStreetMap, GPS-Standort, Paar-Profil mit Vorlieben,
gemeinsames Paar-Konto mit Synchronisierung (z. B. Supabase/Firebase), direkte Buchung.
