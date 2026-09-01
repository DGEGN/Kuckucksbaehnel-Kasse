# Kassenapp · Kuckucks-Bähnel

Web-App für den Fahrkartenschalter, im selben Design und mit derselben
Firebase-Datenbank wie der Fahrgastzähler. Läuft ohne Build-Schritt direkt
im Browser (HTML/CSS/JS) und synchronisiert **live** zwischen allen
geöffneten Kassen.

## Funktionsweise

### Verkauf
Ticketart(en) und Anzahl auswählen (− / + oder direkt die Zahl eintippen) —
die Summe wird automatisch aus den hinterlegten Preisen berechnet. Den vom
Kunden gegebenen Betrag über das große Feld eingeben (öffnet einen
Ziffernblock; Schnellwahl-Chips für 5/10/20/50/100 € oder „passend"). Die
App zeigt sofort Rückgeld **und** die günstigste Stückelung. Mit „Kauf
abschließen" wird der Verkauf gebucht:
- die Summe wird als Einzahlung im Kassenbuch dieser Kasse erfasst,
- der Verkauf wird (je Ticketart) für den Verkaufsbericht gespeichert,
- **die passende Anzahl Fahrgäste wird automatisch in der Fahrgastzählapp
  mitgezählt** (Erwachsene/Kinder/Familie, je nach verkaufter Ticketart) —
  vorausgesetzt, für den Fahrtag/Standort läuft dort bereits eine Zählung.
  Ist das (noch) nicht der Fall, wird der Verkauf trotzdem gebucht, die App
  weist aber darauf hin, dass die Fahrgastzahlen nicht aktualisiert wurden.

### Kassenbuch
Anfangsbestand einmal pro Fahrtag/Standort eintragen. Danach einfach
„+ Einzahlung" / „− Auszahlung" mit Betrag und Grund erfassen (z. B.
Wechselgeld geholt, Trinkgeld, Materialkauf). Die App summiert automatisch:
**Anfangsbestand + Einzahlungen − Auszahlungen = Kassenbestand (Soll)**.
Alle Buchungen aller Kassen desselben Fahrtags/Standorts erscheinen live in
der gemeinsamen Liste — jeder abgeschlossene Verkauf erscheint hier
automatisch als Einzahlung.

### Verkaufsbericht
Schlägt Anzahl und Umsatz je Ticketart automatisch aus den über „Kauf
abschließen" erfassten Verkäufen aller Kassen vor. Jeder Wert lässt sich
anklicken und überschreiben, z. B. bei einer nachträglichen Korrektur.
Optional lässt sich der tatsächlich gezählte Kassenbestand eintragen — die
App zeigt die Differenz zum berechneten Umsatz. „Bericht speichern" sichert
die Werte in Firestore, „als Text kopieren" erzeugt eine fertige
Zusammenfassung zum Einfügen in ein Formular oder eine Nachricht.

### Preise
Preise für alle sechs Ticketarten (Einfache Fahrt / Hin- Rückfahrt ×
Erwachsene / Kind / Familie) — gelten sofort für alle Kassen und fließen in
Verkauf und Verkaufsbericht ein. Einmal einrichten, danach nur bei
Preisänderungen anpassen.

## 1. Mit demselben Firebase-Projekt verbinden

Diese App nutzt **dieselbe Firebase-Konfiguration** wie die Fahrgastzählapp,
damit beide auf dieselbe Datenbank zugreifen (Verkaufsbericht braucht Zugriff
auf die Zähldaten).

1. In [`app.js`](app.js) ganz oben dieselben `firebaseConfig`-Werte eintragen,
   die auch in der `app.js` der Fahrgastzählapp stehen.
2. **Sicherheitsregeln aktualisieren**: [`firestore.rules`](firestore.rules)
   enthält die bestehenden Regeln für `fahrten` **plus** drei neue Bereiche
   (`kassenbuch`, `berichte`, `einstellungen`). In der Firebase-Konsole unter
   *Firestore Database* → *Regeln* den **gesamten Inhalt dieser Datei**
   einfügen und veröffentlichen (ersetzt die bisherige Regel-Datei
   vollständig, enthält aber weiterhin alles für die Fahrgastzählapp).
3. Einmal in der App unter dem Tab **„Preise"** die aktuellen Ticketpreise
   eintragen und speichern.

## 2. Auf GitHub veröffentlichen (GitHub Pages)

Am einfachsten als **eigenes Repository** neben der Fahrgastzählapp, z. B.
`kuckucksbaehnle-kasse`:

```bash
git init
git add .
git commit -m "Kassenapp Kuckucks-Bähnel"
git branch -M main
git remote add origin https://github.com/DEIN-NUTZERNAME/DEIN-REPO.git
git push -u origin main
```

Dann: *Settings* → *Pages* → *Source*: `Deploy from a branch` → Branch
`main`, Ordner `/ (root)` → *Save*. Nach ein bis zwei Minuten erreichbar
unter `https://DEIN-NUTZERNAME.github.io/DEIN-REPO/`.

Falls die App stattdessen im selben Repository wie die Fahrgastzählapp
liegen soll: diesen Ordnerinhalt in einen Unterordner (z. B. `/kasse`) legen
und dort mit `index.html` verlinken.

**Wichtig**: Die GitHub-Pages-Domain muss (falls noch nicht geschehen) unter
*Authentication* → *Settings* → *Authorized domains* in Firebase eingetragen
sein — ist sie bei der Fahrgastzählapp bereits eingetragen, gilt das auch
hier, sofern beide Apps dieselbe Domain nutzen.

## Logo

Bitte `logo.png` (dieselbe Datei wie bei der Fahrgastzählapp) in den Ordner
`assets/` kopieren. Fehlt die Datei, blendet die App das Logo automatisch
aus, ohne Fehler anzuzeigen.

## Datenmodell (Firestore, neu hinzugekommen)

```
kassenbuch/{fahrtag}_{standort}
  fahrtag, standort
  anfangsbestand: 5000        (Cent, hier 50,00 €)
  erstellt / aktualisiert: Timestamp

kassenbuch/{kassenId}/buchungen/{id}
  typ: "einzahlung" | "auszahlung"
  betrag: 500                 (Cent, hier 5,00 €)
  grund: "Verkauf: 2× Einfache Fahrt Erwachsene, 1× Hin- Rückfahrt Kind" | frei eingegeben
  kasse: "Schalter 1"
  zeit: Timestamp

verkaeufe/{fahrtag}_{standort}/eintraege/{id}
  ticket: "ea" | "ra" | "ek" | "rk" | "ef" | "rf"
  anzahl: 2
  einzelpreis: 500             (Cent, Preis zum Verkaufszeitpunkt)
  summe: 1000                  (Cent)
  kasse: "Schalter 1"
  zeit: Timestamp

berichte/{fahrtag}_{standort}
  fahrtag, standort, kasse
  werte: {
    ea: { anzahl: 42, umsatz: 21000 },
    ra: { anzahl: 12, umsatz:  9600 },
    ek: { anzahl: 18, umsatz:  5400 },
    rk: { anzahl:  9, umsatz:  4050 },
    ef: { anzahl:  6, umsatz:  9000 },
    rf: { anzahl:  3, umsatz:  6000 }
  }
  kassenbestandIst: 55050 | null
  bemerkung: "..."
  aktualisiert: Timestamp

einstellungen/preise            (ein einzelnes globales Dokument)
  ea: 500   (Cent) — Einfache Fahrt Erwachsene
  ra: 800   — Hin- Rückfahrt Erwachsene
  ek: 300   — Einfache Fahrt Kind
  rk: 450   — Hin- Rückfahrt Kind
  ef: 1500  — Einfache Fahrt Familie
  rf: 2000  — Hin- Rückfahrt Familie
  aktualisiert: Timestamp
```

Ein abgeschlossener Verkauf schreibt außerdem in die bestehenden
Collections der Fahrgastzählapp: `fahrten/{fahrtag}_{standort}` (Felder
`erwachsene`/`kinder`/`familien` werden per `increment()` um die verkaufte
Anzahl erhöht) sowie je einen Eintrag in
`fahrten/{fahrtId}/ereignisse` (gleiche Struktur wie die manuelle Zählung,
damit sich ein Verkauf dort wie gewohnt nachvollziehen/rückgängig machen
lässt).

Alle Beträge werden intern in **ganzen Cent** gespeichert, um
Rundungsfehler bei Kommazahlen zu vermeiden.

## Lokal testen

```bash
python3 -m http.server 8000
# dann im Browser: http://localhost:8000
```

## Anpassen

- Andere Standardwerte für die Schnellwahl-Chips beim Rückgeld: in
  `index.html` im Block `#rgSchnellwahl` die `data-val`-Werte ändern.
- Weitere oder andere Ticketarten: in `app.js` das Array `TICKET_TYPES`
  ergänzen/ändern (Schlüssel, Bezeichnung, Zählkategorie) und in
  `index.html` (Preise-Tab) sowie `firestore.rules` entsprechend nachziehen.
  Der Verkaufsbericht (`BERICHT_KATEGORIEN`) übernimmt neue Ticketarten
  automatisch aus `TICKET_TYPES`.
