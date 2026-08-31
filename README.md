# Kassenapp · Kuckucks-Bähnel

Web-App für den Fahrkartenschalter, im selben Design und mit derselben
Firebase-Datenbank wie der Fahrgastzähler. Läuft ohne Build-Schritt direkt
im Browser (HTML/CSS/JS) und synchronisiert **live** zwischen allen
geöffneten Kassen.

## Funktionsweise

### Rückgeld
Preis und gegebenen Betrag über die großen Beträge-Felder eingeben (öffnet
einen Ziffernblock; die letzten beiden eingegebenen Ziffern sind automatisch
die Cent-Stellen, wie bei einem Taschenrechner: `1250` → 12,50 €). Schnellwahl-
Chips (5/10/20/50/100 €, „passend") für den gegebenen Betrag. Die App zeigt
sofort das Rückgeld **und** die günstigste Stückelung (welche Scheine/Münzen
herausgegeben werden sollten). Über „Als Einnahme im Kassenbuch verbuchen"
wird der Verkaufspreis automatisch als Einzahlung im Kassenbuch dieser Kasse
gebucht.

### Kassenbuch
Anfangsbestand einmal pro Fahrtag/Standort eintragen. Danach einfach
„+ Einzahlung" / „− Auszahlung" mit Betrag und Grund erfassen (z. B.
Wechselgeld geholt, Trinkgeld, Materialkauf). Die App summiert automatisch:
**Anfangsbestand + Einzahlungen − Auszahlungen = Kassenbestand (Soll)**.
Alle Buchungen aller Kassen desselben Fahrtags/Standorts erscheinen live in
der gemeinsamen Liste.

### Verkaufsbericht
Schlägt Anzahl und Umsatz je Ticketkategorie automatisch aus den
Zähldaten der Fahrgastzählapp vor (Anzahl × hinterlegter Preis). Jeder Wert
lässt sich anklicken und überschreiben, z. B. wenn ein Ticket zum
Vorzugspreis verkauft wurde. Optional lässt sich der tatsächlich gezählte
Kassenbestand eintragen — die App zeigt die Differenz zum berechneten Umsatz.
„Bericht speichern" sichert die Werte in Firestore, „als Text kopieren"
erzeugt eine fertige Zusammenfassung zum Einfügen in ein Formular oder eine
Nachricht.

### Preise
Zentrale Ticketpreise (Erwachsene, Kinder, Familie pro Ticket, Gruppe pro
Person) — gelten sofort für alle Kassen und fließen in den Verkaufsbericht
ein. Einmal einrichten, danach nur bei Preisänderungen anpassen.

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
  grund: "Verkauf (Rückgeldrechner)" | frei eingegeben
  kasse: "Schalter 1"
  zeit: Timestamp

berichte/{fahrtag}_{standort}
  fahrtag, standort, kasse
  werte: {
    erwachsene: { anzahl: 42, umsatz: 21000 },
    kinder:     { anzahl: 18, umsatz:  5400 },
    familien:   { anzahl:  6, umsatz:  9000 },
    gruppen:    { anzahl: 30, umsatz: 12000 }
  }
  kassenbestandIst: 47500 | null
  bemerkung: "..."
  aktualisiert: Timestamp

einstellungen/preise            (ein einzelnes globales Dokument)
  erwachsene: 500   (Cent)
  kinder: 300
  familie: 1500
  gruppe: 400
  aktualisiert: Timestamp
```

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
- Weitere Ticketkategorien im Verkaufsbericht: in `app.js` das Array
  `BERICHT_KATEGORIEN` ergänzen und in `index.html`/`firestore.rules`
  entsprechend nachziehen.
