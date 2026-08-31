// ==========================================================
// Kuckucks-Bähnel Kassenapp
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
  increment, collection, addDoc, serverTimestamp, query,
  orderBy, limit, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ---------------------------------------------------------
// TODO: Hier dieselbe Firebase-Projektkonfiguration eintragen
// wie in der Fahrgastzählapp (app.js dort), damit beide Apps
// auf dieselbe Datenbank zugreifen.
// Firebase-Konsole -> Projekteinstellungen -> "Meine Apps" -> Web-App
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId: "DEINE_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
});
signInAnonymously(auth).catch((err) => {
  showSetupError("Verbindung zu Firebase fehlgeschlagen: " + err.message);
});

// ---------------------------------------------------------
// Konstanten & Hilfsfunktionen
// ---------------------------------------------------------
const STANDORT_LABEL = { neustadt: "Neustadt", lambrecht: "Lambrecht" };
const LS_KEY = "kb_kasse_session_v1";

const MUENZEN = [
  { wert: 500, label: "500 €-Schein" },
  { wert: 200, label: "200 €-Schein" },
  { wert: 100, label: "100 €-Schein" },
  { wert: 50, label: "50 €-Schein" },
  { wert: 20, label: "20 €-Schein" },
  { wert: 10, label: "10 €-Schein" },
  { wert: 5, label: "5 €-Schein" },
  { wert: 2, label: "2 €-Münze" },
  { wert: 1, label: "1 €-Münze" },
  { wert: 0.5, label: "50 Cent" },
  { wert: 0.2, label: "20 Cent" },
  { wert: 0.1, label: "10 Cent" },
  { wert: 0.05, label: "5 Cent" },
  { wert: 0.02, label: "2 Cent" },
  { wert: 0.01, label: "1 Cent" }
];

function todayISO() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
  });
  return fmt.format(new Date());
}
function formatDateDE(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function formatTimeDE(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date();
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(date);
}
function euro(cents) {
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
// Alle Beträge werden intern als ganze Cent (Integer) gerechnet, um Rundungsfehler zu vermeiden.
function toCents(str) {
  if (str == null) return 0;
  const norm = String(str).replace(/\s|€/g, "").replace(",", ".");
  const val = parseFloat(norm);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// ---------------------------------------------------------
// DOM-Referenzen
// ---------------------------------------------------------
const el = (id) => document.getElementById(id);

const setupScreen = el("setup");
const appScreen = el("app");
const fahrtagInput = el("fahrtag");
const standortGroup = el("standortGroup");
const kasseInput = el("kasseInput");
const startBtn = el("startBtn");
const setupInfo = el("setupInfo");
const setupError = el("setupError");

const fahrtagLabel = el("fahrtagLabel");
const standortLabel = el("standortLabel");
const kasseLabel = el("kasseLabel");
const changeSessionBtn = el("changeSession");
const connStatus = el("connStatus");

const tabbar = el("tabbar");

// Rückgeld
const rgPreisBtn = el("rgPreisBtn");
const rgGegebenBtn = el("rgGegebenBtn");
const rgSchnellwahl = el("rgSchnellwahl");
const rgResult = el("rgResult");
const rgResultLabel = el("rgResultLabel");
const rgResultValue = el("rgResultValue");
const rgReset = el("rgReset");
const rgVerbuchen = el("rgVerbuchen");
const rgVerbuchenHint = el("rgVerbuchenHint");
const stueckelungList = el("stueckelungList");

// Kassenbuch
const anfangsbestandInput = el("anfangsbestandInput");
const anfangsbestandSpeichern = el("anfangsbestandSpeichern");
const kbAnfang = el("kbAnfang");
const kbEin = el("kbEin");
const kbAus = el("kbAus");
const kbTotal = el("kbTotal");
const kbEinzahlungBtn = el("kbEinzahlungBtn");
const kbAuszahlungBtn = el("kbAuszahlungBtn");
const kbList = el("kbList");

// Verkaufsbericht
const berichtQuelle = el("berichtQuelle");
const berichtBody = el("berichtBody");
const berichtGesamt = el("berichtGesamt");
const berichtKassenbestand = el("berichtKassenbestand");
const berichtDiffRow = el("berichtDiffRow");
const berichtDiff = el("berichtDiff");
const berichtBemerkung = el("berichtBemerkung");
const berichtZuruecksetzen = el("berichtZuruecksetzen");
const berichtSpeichern = el("berichtSpeichern");
const berichtCsv = el("berichtCsv");
const berichtHinweis = el("berichtHinweis");

// Preise
const preisErwachsene = el("preisErwachsene");
const preisKinder = el("preisKinder");
const preisFamilie = el("preisFamilie");
const preisGruppe = el("preisGruppe");
const preiseSpeichern = el("preiseSpeichern");
const preiseHinweis = el("preiseHinweis");

// Numpad
const numpadOverlay = el("numpadOverlay");
const numpadTitle = el("numpadTitle");
const numpadDisplay = el("numpadDisplay");
const numpadGrund = el("numpadGrund");
const numpadOk = el("numpadOk");
const numpadCancel = el("numpadCancel");

const toastEl = el("toast");

// ---------------------------------------------------------
// Zustand
// ---------------------------------------------------------
let session = null; // {fahrtag, standort, kasse}
let selectedStandort = null;
let fahrtRef = null, kassenbuchRef = null, berichtRef = null;
let unsubKassenbuch = null, unsubBuchungen = null, unsubFahrt = null, unsubBericht = null, unsubPreise = null;

let preise = { erwachsene: 0, kinder: 0, familie: 0, gruppe: 0 }; // in Cent
let fahrtCounts = { erwachsene: 0, kinder: 0, familien: 0, gruppen: 0 };
let berichtOverrides = {}; // { erwachseneAnzahl, erwachseneUmsatz, ... } jeweils in Cent/Stück, falls überschrieben
let kassenbuchAnfangCents = 0;
let buchungenListe = [];

let rgPreisCents = 0;
let rgGegebenCents = 0;

let numpadMode = null; // 'preis' | 'gegeben' | 'einzahlung' | 'auszahlung' | 'anfangsbestand' | 'preiseinstellung'
let numpadValue = "";
let numpadTargetField = null;

// ===========================================================
// SETUP SCREEN
// ===========================================================
function initSetupScreen() {
  fahrtagInput.value = todayISO();

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { /* ignore */ }
  if (saved) {
    if (saved.standort) selectStandort(saved.standort);
    if (saved.kasse) kasseInput.value = saved.kasse;
  }

  standortGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectStandort(btn.dataset.standort));
  });

  startBtn.addEventListener("click", startSession);
}

function selectStandort(value) {
  selectedStandort = value;
  standortGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.standort === value);
  });
}

function showSetupError(msg) { setupError.textContent = msg; }
function showSetupInfo(msg) { setupInfo.textContent = msg; }

async function startSession() {
  showSetupError(""); showSetupInfo("");

  const fahrtag = fahrtagInput.value;
  const kasse = kasseInput.value.trim() || "Kasse";

  if (!fahrtag) { showSetupError("Bitte einen Fahrtag wählen."); return; }
  if (!selectedStandort) { showSetupError("Bitte Neustadt oder Lambrecht wählen."); return; }

  startBtn.disabled = true;
  startBtn.textContent = "Verbinde…";

  try {
    await authReady;
    session = { fahrtag, standort: selectedStandort, kasse };
    localStorage.setItem(LS_KEY, JSON.stringify(session));
    enterApp();
  } catch (err) {
    showSetupError("Fehler: " + err.message);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Kasse öffnen";
  }
}

// ===========================================================
// APP SCREEN
// ===========================================================
function enterApp() {
  setupScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  fahrtagLabel.textContent = formatDateDE(session.fahrtag);
  standortLabel.textContent = STANDORT_LABEL[session.standort] || session.standort;
  kasseLabel.textContent = session.kasse;

  const docId = `${session.fahrtag}_${session.standort}`;
  fahrtRef = doc(db, "fahrten", docId);
  kassenbuchRef = doc(db, "kassenbuch", docId);
  berichtRef = doc(db, "berichte", docId);

  subscribePreise();
  subscribeFahrt();
  subscribeKassenbuch();
  subscribeBuchungen();
  subscribeBericht();
  updateStueckelung();
}

function leaveApp() {
  [unsubKassenbuch, unsubBuchungen, unsubFahrt, unsubBericht, unsubPreise].forEach((u) => u && u());
  appScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  showSetupError(""); showSetupInfo("");
  fahrtagInput.value = session?.fahrtag || todayISO();
  if (session?.standort) selectStandort(session.standort);
  kasseInput.value = session?.kasse || "";
}

function setConnStatus(state) {
  connStatus.className = "conn-status conn-" + state;
  connStatus.textContent = state === "online" ? "live verbunden" : state === "offline" ? "keine Verbindung" : "verbinde…";
}

// ---------------------------------------------------------
// Tabs
// ---------------------------------------------------------
tabbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
});

// ===========================================================
// PREISE (Einstellungen)
// ===========================================================
function subscribePreise() {
  const ref = doc(db, "einstellungen", "preise");
  unsubPreise = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      preise = {
        erwachsene: d.erwachsene || 0,
        kinder: d.kinder || 0,
        familie: d.familie || 0,
        gruppe: d.gruppe || 0
      };
    }
    preisErwachsene.value = (preise.erwachsene / 100).toFixed(2).replace(".", ",");
    preisKinder.value = (preise.kinder / 100).toFixed(2).replace(".", ",");
    preisFamilie.value = (preise.familie / 100).toFixed(2).replace(".", ",");
    preisGruppe.value = (preise.gruppe / 100).toFixed(2).replace(".", ",");
    renderBericht();
  }, (err) => showToast("Fehler beim Laden der Preise: " + err.message));
}

preiseSpeichern.addEventListener("click", async () => {
  const neu = {
    erwachsene: toCents(preisErwachsene.value),
    kinder: toCents(preisKinder.value),
    familie: toCents(preisFamilie.value),
    gruppe: toCents(preisGruppe.value)
  };
  try {
    await setDoc(doc(db, "einstellungen", "preise"), { ...neu, aktualisiert: serverTimestamp() }, { merge: true });
    preiseHinweis.textContent = "Preise gespeichert – gelten sofort für alle Kassen.";
    setTimeout(() => { preiseHinweis.textContent = ""; }, 4000);
  } catch (err) {
    preiseHinweis.textContent = "Fehler: " + err.message;
  }
});

// ===========================================================
// RÜCKGELD
// ===========================================================
function updateRgDisplay() {
  rgPreisBtn.textContent = euro(rgPreisCents);
  rgGegebenBtn.textContent = euro(rgGegebenCents);
  const diff = rgGegebenCents - rgPreisCents;
  rgResultValue.textContent = euro(Math.abs(diff));
  rgResultLabel.textContent = diff < 0 ? "Fehlbetrag – bitte mehr verlangen" : "Rückgeld";
  rgResult.classList.toggle("rg-negativ", diff < 0);
  rgVerbuchen.disabled = !(rgPreisCents > 0 && diff >= 0);
  updateStueckelung();
}

function updateStueckelung() {
  const diff = rgGegebenCents - rgPreisCents;
  if (rgPreisCents === 0 && rgGegebenCents === 0) {
    stueckelungList.innerHTML = '<li class="activity-empty">Preis und gegebenen Betrag eingeben.</li>';
    return;
  }
  if (diff <= 0) {
    stueckelungList.innerHTML = '<li class="activity-empty">Kein Rückgeld nötig.</li>';
    return;
  }
  let rest = Math.round(diff); // Cent, ganzzahlig
  const zeilen = [];
  for (const m of MUENZEN) {
    const wertCents = Math.round(m.wert * 100);
    const anzahl = Math.floor(rest / wertCents);
    if (anzahl > 0) {
      zeilen.push(`<li><span class="stueck-label">${m.label}</span><span class="stueck-count">${anzahl}×</span></li>`);
      rest -= anzahl * wertCents;
    }
  }
  stueckelungList.innerHTML = zeilen.join("") || '<li class="activity-empty">Kein Rückgeld nötig.</li>';
}

rgPreisBtn.addEventListener("click", () => {
  openNumpad("preis", "Preis eingeben", rgPreisCents);
});
rgGegebenBtn.addEventListener("click", () => {
  openNumpad("gegeben", "Gegebenen Betrag eingeben", rgGegebenCents);
});
rgSchnellwahl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.val === "passend") {
    rgGegebenCents = rgPreisCents;
  } else {
    rgGegebenCents = Math.round(parseFloat(chip.dataset.val) * 100);
  }
  updateRgDisplay();
});
rgReset.addEventListener("click", () => {
  rgPreisCents = 0; rgGegebenCents = 0;
  rgVerbuchenHint.textContent = "";
  updateRgDisplay();
});
rgVerbuchen.addEventListener("click", async () => {
  if (!(rgPreisCents > 0 && rgGegebenCents >= rgPreisCents)) return;
  try {
    await bucheKassenbuch("einzahlung", rgPreisCents, "Verkauf (Rückgeldrechner)");
    rgVerbuchenHint.textContent = `${euro(rgPreisCents)} als Einnahme im Kassenbuch verbucht.`;
    rgPreisCents = 0; rgGegebenCents = 0;
    updateRgDisplay();
  } catch (err) {
    rgVerbuchenHint.textContent = "Fehler: " + err.message;
  }
});

// ===========================================================
// KASSENBUCH
// ===========================================================
function subscribeFahrt() {
  unsubFahrt = onSnapshot(fahrtRef, (snap) => {
    setConnStatus(snap.metadata.fromCache ? "offline" : "online");
    if (snap.exists()) {
      const d = snap.data();
      fahrtCounts = {
        erwachsene: d.erwachsene || 0,
        kinder: d.kinder || 0,
        familien: d.familien || 0,
        gruppen: d.gruppen || 0
      };
    } else {
      fahrtCounts = { erwachsene: 0, kinder: 0, familien: 0, gruppen: 0 };
    }
    renderBericht();
  }, (err) => {
    setConnStatus("offline");
  });
}

function subscribeKassenbuch() {
  unsubKassenbuch = onSnapshot(kassenbuchRef, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      kassenbuchAnfangCents = d.anfangsbestand || 0;
      anfangsbestandInput.value = (kassenbuchAnfangCents / 100).toFixed(2).replace(".", ",");
    } else {
      kassenbuchAnfangCents = 0;
      anfangsbestandInput.value = "";
    }
    renderKassenbuch();
  }, (err) => showToast("Fehler beim Laden des Kassenbuchs: " + err.message));
}

function subscribeBuchungen() {
  const q = query(collection(kassenbuchRef, "buchungen"), orderBy("zeit", "desc"), limit(50));
  unsubBuchungen = onSnapshot(q, (snap) => {
    buchungenListe = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderKassenbuch();
    renderKbListe();
  }, (err) => showToast("Fehler beim Laden der Buchungen: " + err.message));
}

function renderKassenbuch() {
  const einSumme = buchungenListe.filter(b => b.typ === "einzahlung").reduce((s, b) => s + (b.betrag || 0), 0);
  const ausSumme = buchungenListe.filter(b => b.typ === "auszahlung").reduce((s, b) => s + (b.betrag || 0), 0);
  const gesamt = kassenbuchAnfangCents + einSumme - ausSumme;
  kbAnfang.textContent = euro(kassenbuchAnfangCents);
  kbEin.textContent = "+ " + euro(einSumme);
  kbAus.textContent = "− " + euro(ausSumme);
  kbTotal.textContent = euro(gesamt);
}

function renderKbListe() {
  if (!buchungenListe.length) {
    kbList.innerHTML = '<li class="activity-empty">Noch keine Buchungen heute.</li>';
    return;
  }
  kbList.innerHTML = buchungenListe.map((b) => {
    const sign = b.typ === "einzahlung" ? "+" : "−";
    const cls = b.typ === "einzahlung" ? "activity-delta-pos" : "activity-delta-neg";
    return `<li>
      <span>${escapeHtml(b.kasse || "Kasse")} · ${escapeHtml(b.grund || (b.typ === "einzahlung" ? "Einzahlung" : "Auszahlung"))}</span>
      <span class="${cls}">${sign} ${euro(b.betrag || 0)}</span>
      <span class="activity-time">${formatTimeDE(b.zeit)}</span>
    </li>`;
  }).join("");
}

async function bucheKassenbuch(typ, betragCents, grund) {
  const snap = await getDoc(kassenbuchRef);
  if (!snap.exists()) {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      anfangsbestand: 0, erstellt: serverTimestamp(), aktualisiert: serverTimestamp()
    });
  } else {
    await updateDoc(kassenbuchRef, { aktualisiert: serverTimestamp() });
  }
  await addDoc(collection(kassenbuchRef, "buchungen"), {
    typ, betrag: betragCents, grund: grund || "", kasse: session.kasse, zeit: serverTimestamp()
  });
}

anfangsbestandSpeichern.addEventListener("click", async () => {
  const cents = toCents(anfangsbestandInput.value);
  try {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      anfangsbestand: cents, aktualisiert: serverTimestamp()
    }, { merge: true });
    showToast("Anfangsbestand gespeichert: " + euro(cents));
  } catch (err) {
    showToast("Fehler: " + err.message);
  }
});

kbEinzahlungBtn.addEventListener("click", () => openNumpad("einzahlung", "Einzahlung – Betrag", 0, true));
kbAuszahlungBtn.addEventListener("click", () => openNumpad("auszahlung", "Auszahlung – Betrag", 0, true));

// ===========================================================
// VERKAUFSBERICHT
// ===========================================================
function subscribeBericht() {
  unsubBericht = onSnapshot(berichtRef, (snap) => {
    berichtOverrides = snap.exists() ? (snap.data().werte || {}) : {};
    if (snap.exists()) {
      const d = snap.data();
      if (d.kassenbestandIst != null) berichtKassenbestand.value = (d.kassenbestandIst / 100).toFixed(2).replace(".", ",");
      if (d.bemerkung) berichtBemerkung.value = d.bemerkung;
      berichtQuelle.textContent = "gespeicherter Bericht, zuletzt aktualisiert";
    } else {
      berichtQuelle.textContent = "Vorschlag aus Zähldaten – noch nicht gespeichert";
    }
    renderBericht();
  }, (err) => showToast("Fehler beim Laden des Berichts: " + err.message));
}

const BERICHT_KATEGORIEN = [
  { key: "erwachsene", label: "Erwachsene", zaehl: () => fahrtCounts.erwachsene, preis: () => preise.erwachsene },
  { key: "kinder", label: "Kinder", zaehl: () => fahrtCounts.kinder, preis: () => preise.kinder },
  { key: "familien", label: "Familie (Tickets)", zaehl: () => fahrtCounts.familien, preis: () => preise.familie },
  { key: "gruppen", label: "Gruppe (Personen)", zaehl: () => fahrtCounts.gruppen, preis: () => preise.gruppe }
];

function renderBericht() {
  let gesamt = 0;
  berichtBody.innerHTML = BERICHT_KATEGORIEN.map((k) => {
    const override = berichtOverrides[k.key] || {};
    const anzahl = override.anzahl != null ? override.anzahl : k.zaehl();
    const umsatz = override.umsatz != null ? override.umsatz : anzahl * k.preis();
    gesamt += umsatz;
    return `<tr data-kat="${k.key}">
      <td>${k.label}</td>
      <td><input type="text" class="bericht-anzahl" inputmode="numeric" value="${anzahl}" data-kat="${k.key}"></td>
      <td>${euro(k.preis())}</td>
      <td><input type="text" class="bericht-umsatz-input" inputmode="decimal" value="${(umsatz / 100).toFixed(2).replace(".", ",")}" data-kat="${k.key}"></td>
    </tr>`;
  }).join("");
  berichtGesamt.textContent = euro(gesamt);
  updateBerichtDiff(gesamt);

  berichtBody.querySelectorAll(".bericht-anzahl").forEach((input) => {
    input.addEventListener("change", () => {
      const kat = input.dataset.kat;
      const anzahl = parseInt(input.value, 10) || 0;
      const katDef = BERICHT_KATEGORIEN.find((k) => k.key === kat);
      berichtOverrides[kat] = { anzahl, umsatz: anzahl * katDef.preis() };
      renderBericht();
    });
  });
  berichtBody.querySelectorAll(".bericht-umsatz-input").forEach((input) => {
    input.addEventListener("change", () => {
      const kat = input.dataset.kat;
      const umsatzCents = toCents(input.value);
      const prev = berichtOverrides[kat] || {};
      const anzahl = prev.anzahl != null ? prev.anzahl : BERICHT_KATEGORIEN.find((k) => k.key === kat).zaehl();
      berichtOverrides[kat] = { anzahl, umsatz: umsatzCents };
      renderBericht();
    });
  });
}

function updateBerichtDiff(gesamtCents) {
  const istCents = berichtKassenbestand.value.trim() ? toCents(berichtKassenbestand.value) : null;
  if (istCents == null) {
    berichtDiff.textContent = "–";
    berichtDiffRow.classList.remove("diff-ok", "diff-bad");
    return;
  }
  const diff = istCents - gesamtCents;
  berichtDiff.textContent = (diff >= 0 ? "+" : "") + euro(diff);
  berichtDiffRow.classList.toggle("diff-ok", diff === 0);
  berichtDiffRow.classList.toggle("diff-bad", diff !== 0);
}

berichtKassenbestand.addEventListener("input", () => {
  const total = parseFloat(berichtGesamt.textContent.replace(/[^\d,.-]/g, "").replace(",", "."));
  updateBerichtDiff(Math.round((total || 0) * 100));
});

berichtZuruecksetzen.addEventListener("click", () => {
  berichtOverrides = {};
  renderBericht();
  showToast("Werte aus den aktuellen Zähldaten neu geladen.");
});

berichtSpeichern.addEventListener("click", async () => {
  try {
    const werte = {};
    BERICHT_KATEGORIEN.forEach((k) => {
      const override = berichtOverrides[k.key];
      werte[k.key] = {
        anzahl: override && override.anzahl != null ? override.anzahl : k.zaehl(),
        umsatz: override && override.umsatz != null ? override.umsatz : k.zaehl() * k.preis()
      };
    });
    const istCents = berichtKassenbestand.value.trim() ? toCents(berichtKassenbestand.value) : null;
    await setDoc(berichtRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      werte, kassenbestandIst: istCents,
      bemerkung: berichtBemerkung.value.trim(),
      kasse: session.kasse, aktualisiert: serverTimestamp()
    }, { merge: true });
    berichtHinweis.textContent = "Bericht gespeichert.";
    setTimeout(() => { berichtHinweis.textContent = ""; }, 4000);
  } catch (err) {
    berichtHinweis.textContent = "Fehler: " + err.message;
  }
});

berichtCsv.addEventListener("click", async () => {
  const zeilen = [`Verkaufsbericht ${formatDateDE(session.fahrtag)} – ${STANDORT_LABEL[session.standort]}`];
  BERICHT_KATEGORIEN.forEach((k) => {
    const row = berichtBody.querySelector(`tr[data-kat="${k.key}"]`);
    const anzahl = row.querySelector(".bericht-anzahl").value;
    const umsatz = row.querySelector(".bericht-umsatz-input").value;
    zeilen.push(`${k.label}: ${anzahl} Stück – ${umsatz} €`);
  });
  zeilen.push(`Gesamt: ${berichtGesamt.textContent}`);
  if (berichtKassenbestand.value.trim()) zeilen.push(`Gezählter Kassenbestand: ${berichtKassenbestand.value} €`);
  if (berichtBemerkung.value.trim()) zeilen.push(`Bemerkung: ${berichtBemerkung.value.trim()}`);
  const text = zeilen.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("Bericht in die Zwischenablage kopiert.");
  } catch (err) {
    showToast("Kopieren nicht möglich – bitte manuell markieren.");
  }
});

// ---------------------------------------------------------
// Numpad (Preis / Gegeben / Ein-Auszahlung / Anfangsbestand)
// ---------------------------------------------------------
function openNumpad(mode, title, initialCents, mitGrund) {
  numpadMode = mode;
  numpadTitle.textContent = title;
  numpadValue = initialCents > 0 ? String(initialCents) : "";
  numpadDisplay.textContent = euro(parseInt(numpadValue || "0", 10));
  numpadGrund.value = "";
  numpadGrund.classList.toggle("hidden", !mitGrund);
  numpadOverlay.classList.remove("hidden");
}
function closeNumpad() { numpadOverlay.classList.add("hidden"); numpadMode = null; }

numpadOverlay.querySelectorAll(".numpad-key").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    if (key === "back") numpadValue = numpadValue.slice(0, -1);
    else if (key === "00") { if (numpadValue.length < 6) numpadValue += "00"; }
    else if (numpadValue.length < 7) numpadValue += key;
    numpadDisplay.textContent = euro(parseInt(numpadValue || "0", 10));
  });
});
numpadCancel.addEventListener("click", closeNumpad);
numpadOk.addEventListener("click", async () => {
  const cents = parseInt(numpadValue || "0", 10);
  const mode = numpadMode;
  const grund = numpadGrund.value.trim();
  closeNumpad();

  if (mode === "preis") { rgPreisCents = cents; updateRgDisplay(); return; }
  if (mode === "gegeben") { rgGegebenCents = cents; updateRgDisplay(); return; }

  if (mode === "einzahlung" || mode === "auszahlung") {
    if (cents <= 0) { showToast("Bitte einen Betrag größer 0 eingeben."); return; }
    try {
      await bucheKassenbuch(mode, cents, grund);
      showToast(`${mode === "einzahlung" ? "Einzahlung" : "Auszahlung"} über ${euro(cents)} gebucht.`);
    } catch (err) {
      showToast("Fehler: " + err.message);
    }
  }
});

// ---------------------------------------------------------
// Toast
// ---------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

changeSessionBtn.addEventListener("click", leaveApp);

window.addEventListener("online", () => setConnStatus(fahrtRef ? "online" : "connecting"));
window.addEventListener("offline", () => setConnStatus("offline"));

// ---------------------------------------------------------
// Start
// ---------------------------------------------------------
initSetupScreen();
