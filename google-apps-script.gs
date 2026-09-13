/**
 * Kuckucks-Bähnel Kassenapp -> Google Sheets
 * ============================================================
 * Nimmt per Web-App-POST einen Verkaufsbericht entgegen und trägt ihn in
 * zwei Bereichen ein:
 *   1. Ein eigenes Tabellenblatt je Fahrtag (Name = Fahrtag, z.B. "2026-09-01"),
 *      im Stil des Papier-"Verkaufsnachweis für Fahrkarten".
 *   2. Eine Jahresübersicht ("Jahresübersicht <Jahr>"), eine Zeile je Fahrtag
 *      (wird beim erneuten Senden desselben Tages aktualisiert, nicht doppelt
 *      angehängt).
 *
 * EINRICHTUNG:
 * 1. Neues Google Sheet anlegen (leer, beliebiger Name).
 * 2. Erweiterungen -> Apps Script öffnen.
 * 3. Den gesamten Inhalt dieser Datei dort einfügen (Code.gs ersetzen).
 * 4. Oben rechts "Bereitstellen" -> "Neue Bereitstellung".
 *    - Typ: "Web-App"
 *    - Ausführen als: "Ich" (dein Google-Konto)
 *    - Zugriff: "Jeder" (WICHTIG, sonst kann die Kassenapp nicht senden,
 *      da sie sich nicht mit einem Google-Konto anmeldet)
 * 5. Bereitstellen, Google fragt nach Berechtigungen -> zulassen.
 * 6. Die angezeigte Web-App-URL (endet auf /exec) kopieren und in der
 *    Kassenapp in app.js bei GOOGLE_SHEETS_WEBHOOK_URL eintragen.
 * 7. Bei jeder Änderung an diesem Skript: erneut "Bereitstellen" ->
 *    "Bereitstellungen verwalten" -> Version erhöhen -> Bereitstellen
 *    (die URL bleibt dabei gleich).
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    schreibeFahrtagBlatt(ss, data);
    schreibeJahresuebersicht(ss, data);
    return jsonAntwort({ ok: true });
  } catch (err) {
    return jsonAntwort({ ok: false, fehler: String(err) });
  }
}

// Für einen schnellen Erreichbarkeits-Test im Browser (URL direkt aufrufen)
function doGet(e) {
  return jsonAntwort({ ok: true, hinweis: 'Kassenapp-Webhook ist erreichbar. Erwartet POST-Daten.' });
}

function jsonAntwort(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function euroZahl(cents) {
  return Math.round(cents || 0) / 100;
}

// ============================================================
// Tabellenblatt je Fahrtag ("Verkaufsnachweis für Fahrkarten")
// ============================================================
function schreibeFahrtagBlatt(ss, data) {
  var name = data.fahrtag;
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(name);
  }

  sheet.getRange(1, 1).setValue('Verkaufsnachweis für Fahrkarten').setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1).setValue('Fahrtag');
  sheet.getRange(2, 2).setValue(data.fahrtag);
  sheet.getRange(2, 4).setValue('Zuletzt gesendet von');
  sheet.getRange(2, 5).setValue(data.kasse || '');

  var headerRow = 4;
  sheet.getRange(headerRow, 1, 1, 6)
    .setValues([['Ticketart', 'Anfangsbestand', 'Endstand', 'Verkauft', 'Preis', 'Umsatz']])
    .setFontWeight('bold');

  var zeilen = data.zeilen || [];
  var startRow = headerRow + 1;
  zeilen.forEach(function (z, i) {
    var row = startRow + i;
    sheet.getRange(row, 1, 1, 6).setValues([[
      z.label,
      z.anfang == null ? '' : z.anfang,
      z.ende == null ? '' : z.ende,
      z.verkauft == null ? '' : z.verkauft,
      euroZahl(z.preis),
      euroZahl(z.umsatz)
    ]]);
  });

  var r = startRow + zeilen.length;
  sheet.getRange(r, 1).setValue('Gruppen in Neustadt');
  sheet.getRange(r, 6).setValue(euroZahl(data.gruppenEinnahme));
  r++;

  sheet.getRange(r, 1).setValue('Gesamteinnahme').setFontWeight('bold');
  sheet.getRange(r, 6).setValue(euroZahl(data.gesamteinnahme)).setFontWeight('bold');
  var gesamtRow = r;
  r += 2;

  function zeile(label, wert) {
    sheet.getRange(r, 1).setValue(label);
    sheet.getRange(r, 6).setValue(wert);
    r++;
  }
  zeile('Absatz durch Kartenzahlung', euroZahl(data.kartenzahlung));
  zeile('Familien-Gutscheine (' + ((data.gutscheinFamilie && data.gutscheinFamilie.anzahl) || 0) + ' Stück)', euroZahl(data.gutscheinFamilie && data.gutscheinFamilie.betrag));
  zeile('Einzelperson-Gutscheine (' + ((data.gutscheinEinzel && data.gutscheinEinzel.anzahl) || 0) + ' Stück)', euroZahl(data.gutscheinEinzel && data.gutscheinEinzel.betrag));
  zeile('Summe der Absetzungen', euroZahl(data.summeAbzug));
  r++;
  zeile('Bargeldeinnahmen (erwartet)', euroZahl(data.bargeldEinnahmen));
  zeile('Verkauft laut Kassenapp', euroZahl(data.appUmsatz));
  zeile('Differenz', euroZahl(data.differenz));
  r += 2;

  sheet.getRange(r, 1).setValue('Bemerkung');
  sheet.getRange(r, 2, 1, 4).merge().setValue(data.bemerkung || '');

  sheet.getRange(startRow, 5, Math.max(zeilen.length, 1), 2).setNumberFormat('#,##0.00 "€"');
  sheet.getRange(gesamtRow, 6).setNumberFormat('#,##0.00 "€"');
  sheet.autoResizeColumns(1, 6);
}

// ============================================================
// Jahresübersicht, eine Zeile je Fahrtag (Upsert)
// ============================================================
function schreibeJahresuebersicht(ss, data) {
  var jahr = String(data.fahrtag).split('-')[0];
  var name = 'Jahresübersicht ' + jahr;
  var sheet = ss.getSheetByName(name);
  var kopf = ['Fahrtag', 'Gesamteinnahme', 'Kartenzahlung', 'Gutscheine gesamt', 'Bargeldeinnahmen (erwartet)', 'Verkauft laut Kassenapp', 'Differenz', 'Zuletzt gesendet von', 'Bemerkung'];

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var gutscheineGesamt = ((data.gutscheinFamilie && data.gutscheinFamilie.betrag) || 0)
    + ((data.gutscheinEinzel && data.gutscheinEinzel.betrag) || 0);

  var werte = [
    data.fahrtag,
    euroZahl(data.gesamteinnahme),
    euroZahl(data.kartenzahlung),
    euroZahl(gutscheineGesamt),
    euroZahl(data.bargeldEinnahmen),
    euroZahl(data.appUmsatz),
    euroZahl(data.differenz),
    data.kasse || '',
    data.bemerkung || ''
  ];

  var lastRow = sheet.getLastRow();
  var zielZeile = -1;
  if (lastRow >= 2) {
    var spalteA = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < spalteA.length; i++) {
      if (String(spalteA[i][0]) === String(data.fahrtag)) { zielZeile = i + 2; break; }
    }
  }
  if (zielZeile === -1) zielZeile = lastRow + 1;

  sheet.getRange(zielZeile, 1, 1, werte.length).setValues([werte]);
  sheet.getRange(2, 2, Math.max(sheet.getLastRow() - 1, 1), 6).setNumberFormat('#,##0.00 "€"');
  sheet.autoResizeColumns(1, kopf.length);
}
