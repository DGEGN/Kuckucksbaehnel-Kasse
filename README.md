# Kassenapp · Kuckucks-Bähnel

Web-App für den Fahrkartenschalter, im selben Design und mit derselben
Firebase-Datenbank wie der Fahrgastzähler. Läuft ohne Build-Schritt direkt
im Browser (HTML/CSS/JS) und synchronisiert **live** zwischen allen
geöffneten Kassen. Alle Bereiche (Kassenbuch, Verkaufsbericht, Ticketbestand)
gelten gemeinsam pro Fahrtag, für alle Kassen zusammen — es gibt keinen
Standort-Bezug mehr, da die Fahrgastzählapp Fahrten nur noch pro Fahrtag
führt (eine Fahrt = ein Fahrtag).

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
  mitgezählt**: Erwachsene- und Kinder-Tickets als `einzelperson`,
  Familientickets als `familien` — vorausgesetzt, für den Fahrtag existiert
  dort bereits eine Fahrt. Ist das (noch) nicht der Fall, wird der Verkauf
  trotzdem gebucht, die App weist aber darauf hin, dass die Fahrgastzahlen
  nicht aktualisiert wurden.

### Kassenbuch
Anfangsbestand einmal pro Fahrtag eintragen. Danach einfach „+ Einzahlung" /
„− Auszahlung" mit Betrag und Grund erfassen (z. B. Wechselgeld geholt,
Trinkgeld, Materialkauf). Die App summiert automatisch:
**Anfangsbestand + Einzahlungen − Auszahlungen = Kassenbestand (Soll)**.
Alle Buchungen aller Kassen desselben Fahrtags erscheinen live in der
gemeinsamen Liste — jeder abgeschlossene Verkauf erscheint hier automatisch
als Einzahlung.

### Verkaufsbericht
Für jede Ticketart trägt man **Anfangsbestand** und **Endstand** der
fortlaufenden Nummern auf den Fahrkarten ein (gilt gemeinsam für alle Kassen
an diesem Fahrtag — ein Fahrkartenblock pro Ticketart). Die App berechnet
daraus automatisch die verkaufte Anzahl (Endstand − Anfangsbestand), den
Umsatz je Ticketart und die Gesamteinnahme. In den Feldern „Absatz durch
Kartenzahlung" sowie „Familien-" und „Einzelperson-Gutscheine" trägt man die
Beträge ein, die nicht bar eingenommen wurden — die App addiert sie und
zieht sie von der Gesamteinnahme ab, das Ergebnis sind die erwarteten
**Bargeldeinnahmen**. Diese werden automatisch mit der Summe verglichen, die
die Kassenapp selbst über „Kauf abschließen" (alle Kassen) erfasst hat, samt
Differenz-Anzeige. „Bericht speichern" sichert alles in Firestore, „als Text
kopieren" erzeugt eine fertige Zusammenfassung.

### Ansicht: Kompakt / Ausführlich
Oben rechts lässt sich jederzeit zwischen einer **kompakten** Ansicht (eine
Spalte, reduzierte Zusatzinfos — ideal für kleine Handy-Bildschirme) und der
**ausführlichen** Ansicht (mehrspaltig, alle Details — ideal für Tablet/PC)
umschalten. Die Wahl wird im Browser gespeichert und bleibt beim nächsten
Öffnen erhalten.

### Preise
Preise für alle sechs Ticketarten (Einfache Fahrt / Hin- Rückfahrt ×
Erwachsene / Kind / Familie) — gelten sofort für alle Kassen und fließen in
Verkauf und Verkaufsbericht ein. Einmal einrichten, danach nur bei
Preisänderungen anpassen.

## 1. Mit demselben Firebase-Projekt verbinden

Diese App nutzt **dieselbe Firebase-Konfiguration** wie die Fahrgastzählapp,
damit beide auf dieselbe Datenbank zugreifen (Verkauf braucht Zugriff auf die
Fahrten und schreibt Fahrgastzahlen zurück).

1. In [`app.js`](app.js) ganz oben dieselben `firebaseConfig`-Werte eintragen,
   die auch in der `app.js` der Fahrgastzählapp stehen.
2. **Sicherheitsregeln aktualisieren**: [`firestore.rules`](firestore.rules)
   enthält (zur Orientierung) die Regeln für `fahrten` **plus** vier neue
   Bereiche (`kassenbuch`, `berichte`, `verkaeufe`, `einstellungen`). In der
   Firebase-Konsole unter *Firestore Database* → *Regeln* die **vier neuen
   Blöcke** in die tatsächlich dort hinterlegte Regel-Datei der
   Fahrgastzählapp einfügen — den `fahrten`-Block **nicht** blind
   überschreiben, sondern die dort bereits laufenden Regeln behalten und nur
   ergänzen, damit die Fahrgastzählapp weiterläuft.
3. Einmal in der App unter dem Tab **„Preise"** die aktuellen Ticketpreise
   eintragen und speichern.

Beim Start wählt man eine der bereits in der Fahrgastzählapp angelegten
Fahrten aus einer Liste — nur so kann die App Verkäufe automatisch als
Fahrgäste mitzählen. Ist noch keine Fahrt angelegt, lässt sich der Fahrtag
über „Fahrtag stattdessen manuell eingeben" trotzdem frei wählen; die
automatische Fahrgastzählung greift dann erst, sobald die passende Fahrt in
der Fahrgastzählapp existiert.

**Hinweis zur automatischen Zählung**: Die Kassenapp erhöht beim „Kauf
abschließen" direkt die Felder `einzelperson`/`familien` im `fahrten`-
Dokument per `increment()`. Falls die Fahrgastzählapp diese Summen
stattdessen aus den einzelnen Wagen (Feld `wagen`) neu berechnet und dabei
überschreibt, würde ein per Kassenapp verbuchter Verkauf wieder verloren
gehen. Bitte einmal testen (ein Ticket verkaufen, dann in der Fahrgastzählapp
prüfen, ob die Zahl dauerhaft ankommt) und mir Bescheid geben, falls nicht —
dann müsste die Kassenapp stattdessen z. B. einem bestimmten Wagen oder
einer separaten „nicht zugeordnet"-Position zugeordnet werden.

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
kassenbuch/{fahrtag}                     z. B. kassenbuch/2026-09-01
  fahrtag
  anfangsbestand: 5000        (Cent, hier 50,00 €)
  erstellt / aktualisiert: Timestamp

kassenbuch/{fahrtag}/buchungen/{id}
  typ: "einzahlung" | "auszahlung"
  betrag: 500                 (Cent, hier 5,00 €)
  grund: "Verkauf: 2× Einfache Fahrt Erwachsene, 1× Hin- Rückfahrt Kind" | frei eingegeben
  kasse: "Schalter 1"
  zeit: Timestamp

verkaeufe/{fahrtag}/eintraege/{id}
  ticket: "ea" | "ra" | "ek" | "rk" | "ef" | "rf"
  anzahl: 2
  einzelpreis: 500             (Cent, Preis zum Verkaufszeitpunkt)
  summe: 1000                  (Cent)
  kasse: "Schalter 1"
  zeit: Timestamp

berichte/{fahrtag}
  fahrtag, kasse
  ticketBestand: {
    ea: { anfang: 1200, ende: 1242 },   (fortlaufende Fahrkartennummern)
    ra: { anfang:  340, ende:  352 },
    ek: { anfang:  800, ende:  818 },
    rk: { anfang:  210, ende:  219 },
    ef: { anfang:   60, ende:   66 },
    rf: { anfang:   30, ende:   33 }
  }
  kartenzahlung: 4500        (Cent)
  gutscheinFamilie: 1500     (Cent)
  gutscheinEinzel: 500       (Cent)
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

Ein abgeschlossener Verkauf schreibt außerdem in die bestehende Collection
der Fahrgastzählapp: `fahrten/{fahrtag}` (Felder `einzelperson`/`familien`
werden per `increment()` um die verkaufte Anzahl erhöht) sowie — sofern die
Fahrgastzählapp das noch nutzt — je einen Eintrag in
`fahrten/{fahrtag}/ereignisse` (Felder `kategorie`, `anzahl`, `kasse`,
`zeit`), analog zur manuellen Zählung.

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
  Der Verkaufsbericht übernimmt neue Ticketarten automatisch aus
  `TICKET_TYPES`.
