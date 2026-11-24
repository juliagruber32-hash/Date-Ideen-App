// Rechtliche Seiten: Impressum, Datenschutzerklärung, Nutzungsbedingungen.
// ▸ Vor der Veröffentlichung die Angaben in LEGAL ausfüllen (alles in [eckigen Klammern]).
// ▸ Die Texte sind sorgfältig erstellte Vorlagen, ersetzen aber keine Rechtsberatung.
//   Lasst sie vor dem öffentlichen Start von einer fachkundigen Person prüfen.

export const LEGAL = {
  name: '[Vor- und Nachname]',
  street: '[Straße und Hausnummer]',
  city: '[PLZ und Ort]',
  email: '[E-Mail-Adresse]',
  // Zuständige Aufsichtsbehörde für Datenschutz (für private Anbieter in Bayern: BayLDA)
  authority: 'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach, www.lda.bayern.de',
  // Region eures Supabase-Projekts (Supabase → Project Settings → General → Region)
  supabaseRegion: '[Region, z. B. Frankfurt (eu-central-1)]',
  updated: '24. November 2026',
};

export const legalComplete = () => !Object.values(LEGAL).some((v) => /^\[|\[/.test(String(v)));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const contact = () => `${esc(LEGAL.name)}<br>${esc(LEGAL.street)}<br>${esc(LEGAL.city)}<br>E-Mail: ${esc(LEGAL.email)}`;

export function impressumHTML() {
  return `
    <h2>Angaben gemäß § 5 DDG</h2>
    <p>${contact()}</p>
    <h2>Verantwortlich für den Inhalt</h2>
    <p>${esc(LEGAL.name)}, Anschrift wie oben.</p>
    <h2>Inhalte anderer Nutzer</h2>
    <p>In der Community teilen Paare eigene Date-Ideen. Für diese Inhalte sind die jeweiligen Nutzer verantwortlich. Rechtswidrige Inhalte entfernen wir nach Kenntnis unverzüglich – über „Melden“ in der App oder per E-Mail.</p>
    <h2>Haftung für Links und Ortsangaben</h2>
    <p>Datewell verweist auf Webseiten Dritter (z. B. Restaurants, Google Maps, Ticketanbieter). Für deren Inhalte sind ausschließlich die Betreiber verantwortlich. Orte, Öffnungszeiten und Preise stammen aus öffentlichen Quellen (u. a. OpenStreetMap) und können unvollständig oder veraltet sein.</p>
    <h2>Streitbeilegung</h2>
    <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>`;
}

export function datenschutzHTML() {
  return `
    <p class="muted small">Stand: ${esc(LEGAL.updated)}</p>
    <h2>1. Verantwortlich</h2>
    <p>${contact()}</p>

    <h2>2. Das Wichtigste in Kürze</h2>
    <ul>
      <li>Datewell zeigt keine Werbung, verkauft keine Daten und nutzt keine Analyse- oder Tracking-Dienste.</li>
      <li>Eure Dates, Fotos und Notizen sehen nur ihr beide. Überraschungen sieht nur, wer sie plant.</li>
      <li>Ihr könnt eure Daten jederzeit herunterladen und euer Konto vollständig löschen (Einstellungen → Dein Konto).</li>
    </ul>

    <h2>3. Konto und gemeinsame Daten</h2>
    <p>Für ein Konto speichern wir E-Mail-Adresse und Passwort (verschlüsselt). Eure Inhalte – Namen, besondere Tage, Vorlieben, Dates, Kosten, Fotos, Abstimmungen, Listen – speichern wir, damit ihr sie auf allen Geräten gemeinsam nutzen könnt. Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO). Die Daten liegen bei unserem Auftragsverarbeiter Supabase Inc. (Region: ${esc(LEGAL.supabaseRegion)}). Mit Supabase besteht ein Vertrag zur Auftragsverarbeitung; Übermittlungen außerhalb der EU sind durch Standardvertragsklauseln abgesichert.</p>
    <p>Geburtstage und Jahrestage gebt ihr freiwillig an; sie dienen nur den Erinnerungen in der App. Bitte tragt keine besonders sensiblen Informationen (z. B. Gesundheitsdaten) in Notizen ein.</p>

    <h2>4. Standort und Ortssuche</h2>
    <p>Nur wenn ihr es erlaubt, nutzt Datewell euren Standort, um Orte, Wege und Wetter in der Nähe zu finden (Art. 6 Abs. 1 lit. a DSGVO, jederzeit in den Geräte-Einstellungen widerrufbar). Für die Ortssuche werden ungefähre Koordinaten bzw. eingegebene Orte an folgende Dienste übermittelt – ohne Namen oder Konto-Daten:</p>
    <ul>
      <li>OpenStreetMap-Dienste (Nominatim, Overpass, Photon/Komoot) für Orte und Adressen; Kartenbilder von tile.openstreetmap.org (OpenStreetMap Foundation, Vereinigtes Königreich).</li>
      <li>Open-Meteo (Schweiz) für das Wetter.</li>
      <li>Wikipedia/Wikimedia Commons (Wikimedia Foundation, USA) für Fotos bekannter Orte.</li>
      <li>Über unseren Server (Supabase): Google Places (Google Ireland Ltd./Google LLC) für Bewertungen, Fotos und Öffnungszeiten von Orten. Dabei werden nur Ortsnamen und -koordinaten übertragen, keine Daten über euch.</li>
    </ul>
    <p>Diese Dienste erhalten technisch bedingt eure IP-Adresse. Rechtsgrundlage ist unser berechtigtes Interesse an einer funktionierenden Ortssuche (Art. 6 Abs. 1 lit. f DSGVO).</p>

    <h2>5. Optionale Verbindungen</h2>
    <ul>
      <li><strong>Google Kalender:</strong> Nur wenn ihr ihn verbindet. Datewell liest eure Termine, um freie Zeiten zu zeigen, und trägt Dates ein. Die Verbindung erfolgt direkt zwischen eurem Gerät und Google und lässt sich jederzeit trennen.</li>
      <li><strong>Veranstaltungen (Ticketmaster):</strong> Nur wenn ein Schlüssel hinterlegt ist; übertragen werden ungefähre Koordinaten und der Zeitraum.</li>
      <li><strong>Mitteilungen:</strong> Wenn ihr sie aktiviert, speichern wir eine technische Adresse eures Geräts, über die der Push-Dienst von Apple, Google bzw. Mozilla Erinnerungen zustellt. Abschaltbar in den Einstellungen.</li>
    </ul>

    <h2>6. Community</h2>
    <p>Teilt ihr eine Date-Idee mit der Community, sehen andere Nutzer Titel, Ablauf, Orte, Kosten und – wenn ihr sie freigebt – Fotos, aber keine Namen oder E-Mail-Adressen. Bewertungen werden ohne Namen angezeigt. Gemeldete Inhalte prüfen wir und entfernen sie bei Verstößen.</p>

    <h2>7. Fehlerprotokoll</h2>
    <p>Stürzt eine Funktion ab, speichern wir eine technische Fehlermeldung (Fehlertext, App-Version, Bildschirm) zu eurem Konto, um den Fehler zu beheben. Inhalte eurer Dates sind darin nicht enthalten. Die Einträge werden nach 90 Tagen gelöscht (Art. 6 Abs. 1 lit. f DSGVO).</p>

    <h2>8. Hosting der App</h2>
    <p>Die App wird über GitHub Pages (GitHub Inc., USA) ausgeliefert. Dabei verarbeitet GitHub eure IP-Adresse in Server-Protokollen, um die Seite sicher auszuliefern. Schriften und Programmbibliotheken liegen direkt bei der App; beim Öffnen werden keine Daten an Google Fonts oder andere CDNs übertragen.</p>

    <h2>9. Speicher auf eurem Gerät</h2>
    <p>Datewell speichert Einstellungen, eure Anmeldung und zwischengespeicherte Orte im Speicher eures Browsers bzw. der App (localStorage, IndexedDB, Service Worker). Das ist für die Funktion notwendig (§ 25 Abs. 2 TDDDG); Cookies zu Werbe- oder Analysezwecken gibt es nicht.</p>

    <h2>10. Speicherdauer</h2>
    <p>Eure Daten speichern wir, solange euer Konto besteht. Löscht ihr euer Konto, werden eure persönlichen Daten, geheimen Planungen, Bewertungen und geteilten Ideen gelöscht. Gemeinsame Dates bleiben für die andere Person erhalten, bis auch sie ihr Konto löscht.</p>

    <h2>11. Eure Rechte</h2>
    <p>Ihr habt das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit (Einstellungen → „Meine Daten herunterladen“) und Widerspruch sowie das Recht, erteilte Einwilligungen zu widerrufen. Schreibt dazu an ${esc(LEGAL.email)}. Außerdem könnt ihr euch bei einer Datenschutz-Aufsichtsbehörde beschweren, z. B. beim ${esc(LEGAL.authority)}.</p>`;
}

export function agbHTML() {
  return `
    <p class="muted small">Stand: ${esc(LEGAL.updated)}</p>
    <h2>1. Worum es geht</h2>
    <p>Datewell hilft Paaren, Dates zu planen, zu erleben und Erinnerungen festzuhalten. Die Nutzung ist kostenlos. Anbieter ist ${esc(LEGAL.name)} (siehe Impressum).</p>
    <h2>2. Konto</h2>
    <p>Für die Nutzung braucht jede Person ein eigenes Konto. Haltet euer Passwort geheim. Ihr müsst mindestens 16 Jahre alt sein.</p>
    <h2>3. Eure Inhalte</h2>
    <p>Eure Inhalte gehören euch. Damit wir sie speichern und euch anzeigen können, erlaubt ihr uns, sie zu diesem Zweck zu verarbeiten. Teilt ihr eine Idee mit der Community, dürfen andere Nutzer sie ansehen, übernehmen und bewerten, bis ihr sie wieder entfernt.</p>
    <h2>4. Regeln für die Community</h2>
    <p>Nicht erlaubt sind rechtswidrige, beleidigende, diskriminierende oder sexuelle Inhalte, Werbung sowie Fotos von Personen ohne deren Einverständnis. Inhalte, die mehrfach gemeldet werden, blenden wir automatisch aus; bei Verstößen können wir Inhalte löschen und Konten sperren.</p>
    <h2>5. Orte und Vorschläge</h2>
    <p>Orte, Öffnungszeiten, Preise, Wege und Wetter stammen aus öffentlichen Quellen und werden automatisch zusammengestellt. Sie können falsch oder veraltet sein – bitte prüft wichtige Angaben (z. B. Öffnungszeiten, Reservierungen) direkt beim Anbieter. Für Leistungen von Restaurants, Veranstaltern oder anderen Dritten sind diese selbst verantwortlich.</p>
    <h2>6. Verfügbarkeit und Haftung</h2>
    <p>Wir bemühen uns um einen zuverlässigen Betrieb, können aber keine ständige Verfügbarkeit garantieren. Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit; im Übrigen nur bei Verletzung wesentlicher Pflichten und begrenzt auf den vorhersehbaren Schaden.</p>
    <h2>7. Kündigung</h2>
    <p>Ihr könnt euer Konto jederzeit in den Einstellungen löschen. Wir können das Angebot mit angemessener Frist einstellen; vorher könnt ihr eure Daten herunterladen.</p>
    <h2>8. Änderungen</h2>
    <p>Ändern sich diese Bedingungen wesentlich, informieren wir euch in der App. Es gilt deutsches Recht.</p>`;
}
