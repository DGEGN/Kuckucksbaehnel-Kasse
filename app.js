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
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ---------------------------------------------------------
// TODO: Hier dieselbe Firebase-Projektkonfiguration eintragen
// wie in der Fahrgastzählapp (app.js dort), damit beide Apps
// auf dieselbe Datenbank zugreifen.
// Firebase-Konsole -> Projekteinstellungen -> "Meine Apps" -> Web-App
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCpfHTMh8zx2hmcxjF-ayIjW0lFtJcBtSM",
  authDomain: "kuckuck-fahrkarten.firebaseapp.com",
  databaseURL: "https://kuckuck-fahrkarten-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kuckuck-fahrkarten",
  storageBucket: "kuckuck-fahrkarten.firebasestorage.app",
  messagingSenderId: "732559401683",
  appId: "1:732559401683:web:dbfb8ef56c85c73de46a26"
};

// TODO: Web-App-URL des Google Apps Script (endet auf "/exec"), siehe
// google-apps-script.gs für Code + Einrichtung. Leer lassen/Platzhalter
// stehen lassen, um die Google-Sheets-Übertragung vorerst zu deaktivieren.
const GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxCcl_HOSmDsKFRPWv6T2H2KNoYQ3N0z8EE2hI58OzYCb5ipMTTXWgxGil8RyazrWCZ/exec";


const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
});
onAuthStateChanged(auth, handleAuthState);

// ---------------------------------------------------------
// Konstanten & Hilfsfunktionen
// ---------------------------------------------------------
const LS_KEY = "kb_kasse_session_v1";
const STANDORT_LABEL = { neustadt: "Neustadt", lambrecht: "Lambrecht", elmstein: "Elmstein" };

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

// Stückelung für den Kassenbestand-Zähler (Anfangs-/Endbestand) – bewusst nur
// die vom Nutzer genannten Werte, nicht die volle Rückgeld-Stückelung.
const KASSEN_STUECKELUNG = [
  { cents: 10000, label: "100 €" },
  { cents: 5000, label: "50 €" },
  { cents: 2000, label: "20 €" },
  { cents: 1000, label: "10 €" },
  { cents: 500, label: "5 €" },
  { cents: 200, label: "2 €" },
  { cents: 100, label: "1 €" },
  { cents: 50, label: "50 Ct" },
  { cents: 20, label: "20 Ct" },
  { cents: 10, label: "10 Ct" },
  { cents: 5, label: "5 Ct" }
];
// Fahrkartenarten. "kategorie" ordnet einer Ticketart die Fahrgast-Zählkategorie
// der Fahrgastzählapp zu (einzelperson / familien). "personen" gibt an, wie
// viele Fahrgäste EIN verkauftes Ticket dieser Art zählt (ein Familienticket
// steht für 4 Personen), damit ein Verkauf automatisch die passenden
// Fahrgäste mitzählt.
const TICKET_TYPES = [
  { key: "ea", label: "Einfache Fahrt Erwachsene", kategorie: "einzelperson", personen: 1 },
  { key: "ra", label: "Hin- Rückfahrt Erwachsene", kategorie: "einzelperson", personen: 1 },
  { key: "ek", label: "Einfache Fahrt Kind", kategorie: "einzelperson", personen: 1 },
  { key: "rk", label: "Hin- Rückfahrt Kind", kategorie: "einzelperson", personen: 1 },
  { key: "ef", label: "Einfache Fahrt Familie", kategorie: "familien", personen: 4 },
  { key: "rf", label: "Hin- Rückfahrt Familie", kategorie: "familien", personen: 4 }
];

// Nur an der Kasse Elmstein zusätzlich verfügbar: einfache Fahrt in
// Rückrichtung (Elmstein -> Neustadt), eigene Ticketart mit eigenem Preis.
const ELMSTEIN_TICKET_TYPES = [
  { key: "ena", label: "Einfache Fahrt Elmstein-Neustadt Erwachsene", kategorie: "einzelperson", personen: 1 },
  { key: "enk", label: "Einfache Fahrt Elmstein-Neustadt Kind", kategorie: "einzelperson", personen: 1 },
  { key: "enf", label: "Einfache Fahrt Elmstein-Neustadt Familie", kategorie: "familien", personen: 4 }
];

// Gruppenfahrkarten: kein fortlaufender Ticketbestand (keine von-/bis-Nr.), freier
// Einzelpreis je Verkauf statt Preis aus dem Preise-Tab. Zählen als Kategorie
// "gruppen" in der Fahrgastzählapp (wie die dortige manuelle Gruppen-Zählung).
// Werden in dieselbe "verkaeufe"-Collection geschrieben wie normale Tickets
// (eigene Schlüssel "ge"/"gk"), tauchen aber bewusst NICHT im Fahrkarten-Bestand
// (von-/bis-Nr.) des Verkaufsberichts auf.
const GRUPPEN_TICKET_TYPES = [
  { key: "ge", label: "Gruppe Erwachsene", kategorie: "gruppen", personen: 1 },
  { key: "gk", label: "Gruppe Kind", kategorie: "gruppen", personen: 1 }
];

// Welche Ticketarten an der aktuellen Kasse angeboten werden — Elmstein hat
// zusätzlich die Rückrichtungs-Tickets nach Neustadt.
function aktiveTicketTypes() {
  return (session && session.standort === "elmstein") ? TICKET_TYPES.concat(ELMSTEIN_TICKET_TYPES) : TICKET_TYPES;
}

// Gutschein-Arten: "preisTicket" verweist auf den TICKET_TYPES-Schlüssel, dessen
// Preis den Gutscheinwert bestimmt (Familien-Gutschein = Preis Hin- Rückfahrt
// Familie, Einzelperson-Gutschein = Preis Hin- Rückfahrt Erwachsene).
const GUTSCHEIN_TYPES = [
  { key: "familie", label: "Familien-Gutschein", preisTicket: "rf" },
  { key: "einzelperson", label: "Einzelperson-Gutschein", preisTicket: "ra" }
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
const loginScreen = el("login");
const loginEmail = el("loginEmail");
const loginPassword = el("loginPassword");
const loginBtn = el("loginBtn");
const loginError = el("loginError");
const warteFreigabeScreen = el("warteFreigabe");
const warteFreigabeEmail = el("warteFreigabeEmail");
const warteFreigabeAbmelden = el("warteFreigabeAbmelden");
const logoutBtn = el("logoutBtn");
const appScreen = el("app");
const fahrtagInput = el("fahrtag");
const fahrtagManuellField = el("fahrtagManuellField");
const fahrtManuellBtn = el("fahrtManuellBtn");
const fahrtListField = el("fahrtListField");
const fahrtListEl = el("fahrtList");
const rolleGroup = el("rolleGroup");
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
const viewToggle = el("viewToggle");

const tabbar = el("tabbar");
const zahlweiseField = el("zahlweiseField");
const zahlweiseGroup = el("zahlweiseGroup");
const barBereich = el("barBereich");
const karteBereich = el("karteBereich");
const karteBetragValue = el("karteBetragValue");

// Verkauf
const saleListEl = el("saleList");
const saleTotalEl = el("saleTotal");
const gruppenListEl = el("gruppenList");
const gruppenSummeVerkaufEl = el("gruppenSummeVerkauf");
const gutscheinListEl = el("gutscheinList");
const gutscheinAbzugEl = el("gutscheinAbzug");
const zuZahlenEl = el("zuZahlen");
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
const anfangsbestandStueckelnToggle = el("anfangsbestandStueckelnToggle");
const anfangsbestandStueckelungGrid = el("anfangsbestandStueckelungGrid");
const kbAnfang = el("kbAnfang");
const kbEin = el("kbEin");
const kbAus = el("kbAus");
const kbTotal = el("kbTotal");
const kbKarteSumme = el("kbKarteSumme");
const kbEinzahlungBtn = el("kbEinzahlungBtn");
const kbAuszahlungBtn = el("kbAuszahlungBtn");
const kbList = el("kbList");
const endbestandStueckelungGrid = el("endbestandStueckelungGrid");
const endbestandGezaehltSumme = el("endbestandGezaehltSumme");
const endbestandSoll = el("endbestandSoll");
const endbestandDiffRow = el("endbestandDiffRow");
const endbestandDiff = el("endbestandDiff");
const endbestandSpeichern = el("endbestandSpeichern");
const endbestandHinweis = el("endbestandHinweis");

// Verkaufsbericht
const berichtQuelle = el("berichtQuelle");
const berichtBody = el("berichtBody");
const berichtGruppen = el("berichtGruppen");
const berichtGruppenAuto = el("berichtGruppenAuto");
const berichtGruppenAutoWert = el("berichtGruppenAutoWert");
const berichtGruppenStandort = el("berichtGruppenStandort");
const berichtGesamt = el("berichtGesamt");
const berichtKarte = el("berichtKarte");
const berichtKarteAuto = el("berichtKarteAuto");
const berichtKarteAutoWert = el("berichtKarteAutoWert");
const berichtGutscheinFamilie = el("berichtGutscheinFamilie");
const berichtGutscheinFamilieBetrag = el("berichtGutscheinFamilieBetrag");
const berichtGutscheinFamilieAuto = el("berichtGutscheinFamilieAuto");
const berichtGutscheinFamilieAutoWert = el("berichtGutscheinFamilieAutoWert");
const berichtGutscheinEinzel = el("berichtGutscheinEinzel");
const berichtGutscheinEinzelBetrag = el("berichtGutscheinEinzelBetrag");
const berichtGutscheinEinzelAuto = el("berichtGutscheinEinzelAuto");
const berichtGutscheinEinzelAutoWert = el("berichtGutscheinEinzelAutoWert");
const berichtSummeEinnahme = el("berichtSummeEinnahme");
const berichtSummeAbzug = el("berichtSummeAbzug");
const berichtBargeld = el("berichtBargeld");
const berichtAppUmsatz = el("berichtAppUmsatz");
const berichtDiffRow = el("berichtDiffRow");
const berichtDiff = el("berichtDiff");
const berichtBemerkung = el("berichtBemerkung");
const berichtSpeichern = el("berichtSpeichern");
const berichtSheetsBtn = el("berichtSheetsBtn");
const berichtCsv = el("berichtCsv");
const berichtHinweis = el("berichtHinweis");

// Preise
const preisEA = el("preisEA");
const preisRA = el("preisRA");
const preisEK = el("preisEK");
const preisRK = el("preisRK");
const preisEF = el("preisEF");
const preisRF = el("preisRF");
const preiseElmsteinGrid = el("preiseElmsteinGrid");
const preisENA = el("preisENA");
const preisENK = el("preisENK");
const preisENF = el("preisENF");
const preiseSpeichern = el("preiseSpeichern");
const preiseHinweis = el("preiseHinweis");
const preiseStandort = el("preiseStandort");

// Numpad
const numpadOverlay = el("numpadOverlay");
const numpadTitle = el("numpadTitle");
const numpadDisplay = el("numpadDisplay");
const numpadGrund = el("numpadGrund");
const numpadOk = el("numpadOk");
const numpadCancel = el("numpadCancel");

const toastEl = el("toast");

const kapazitaetOverlay = el("kapazitaetOverlay");
const kapazitaetText = el("kapazitaetText");
const kapazitaetAbbrechen = el("kapazitaetAbbrechen");
const kapazitaetTrotzdem = el("kapazitaetTrotzdem");
const stornoOverlay = el("stornoOverlay");
const stornoText = el("stornoText");
const stornoAbbrechen = el("stornoAbbrechen");
const stornoBestaetigen = el("stornoBestaetigen");

// ---------------------------------------------------------
// Zustand
// ---------------------------------------------------------
let session = null; // {fahrtag, kasse, rolle}
let selectedFahrtId = null; // echte Dokument-ID in "fahrten" (z. B. "2026-09-01_sonderzug"), aus der Liste gewählt
let selectedRolle = null; // 'kasse' | 'beide' | 'karte'
let selectedStandort = null; // 'neustadt' | 'lambrecht' | 'elmstein'
let manuellerModus = false;
let setupInitialized = false;
let fahrtenListe = []; // aus der Fahrgastzählapp geladene Fahrten
let fahrtRef = null, kassenbuchRef = null, berichtRef = null;
let unsubKassenbuch = null, unsubBuchungen = null, unsubFahrt = null, unsubBericht = null, unsubPreise = null, unsubVerkaeufe = null;

let preise = { ea: 0, ra: 0, ek: 0, rk: 0, ef: 0, rf: 0 }; // in Cent, je Ticketart
let verkaeufeSums = {}; // Ticketart-Schlüssel -> { anzahl, umsatz(Cent) }, aus den heutigen Verkäufen dieser Fahrt
let ticketBestand = {}; // Ticketart-Schlüssel -> { anfang, ende } (fortlaufende Fahrkartennummern, gemeinsam pro Fahrtag)
let kassenbuchAnfangCents = 0;
let buchungenListe = [];
let anfangsbestandCounts = {}; // { "<cents>": Anzahl } – Stückelung des Anfangsbestands
let endbestandCounts = {}; // { "<cents>": Anzahl } – Stückelung des gezählten Endbestands

let saleQty = {}; // Ticketart-Schlüssel -> Anzahl im aktuellen (noch nicht abgeschlossenen) Verkauf
let gutscheinQty = { familie: 0, einzelperson: 0 }; // eingelöste Gutscheine im aktuellen Verkauf
let gruppenQty = { ge: 0, gk: 0 }; // Anzahl Gruppenfahrkarten im aktuellen Verkauf
let gruppenPreis = { ge: 0, gk: 0 }; // freier Einzelpreis (Cent) im aktuellen Verkauf, nicht aus dem Preise-Tab
let unsubGutscheine = null;
let gutscheineSums = { familie: 0, einzelperson: 0 }; // heute eingelöst, in Stück (alle Kassen)
let rgGegebenCents = 0;
let zahlweise = "bar"; // "bar" | "karte"

let numpadMode = null; // 'gegeben' | 'einzahlung' | 'auszahlung'
let numpadValue = "";
let numpadTargetField = null;

// ===========================================================
// LOGIN / FREIGABE
// ===========================================================
function showOnly(screen) {
  [loginScreen, warteFreigabeScreen, setupScreen, appScreen].forEach((s) => s.classList.add("hidden"));
  screen.classList.remove("hidden");
}

async function handleAuthState(user) {
  if (!user) {
    showOnly(loginScreen);
    return;
  }
  loginBtn.disabled = false;
  loginBtn.textContent = "Anmelden";
  try {
    const benutzerSnap = await getDoc(doc(db, "benutzer", user.uid));
    const freigegeben = benutzerSnap.exists() && benutzerSnap.data().freigegeben === true;
    if (!freigegeben) {
      warteFreigabeEmail.textContent = user.email || "";
      showOnly(warteFreigabeScreen);
      return;
    }
    showOnly(setupScreen);
    initSetupScreen();
  } catch (err) {
    loginError.textContent = "Fehler beim Prüfen der Freischaltung: " + err.message;
    showOnly(loginScreen);
  }
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) { loginError.textContent = "Bitte E-Mail und Passwort eingeben."; return; }
  loginBtn.disabled = true;
  loginBtn.textContent = "Melde an…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // handleAuthState übernimmt danach automatisch (onAuthStateChanged)
  } catch (err) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Anmelden";
    loginError.textContent = err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found"
      ? "E-Mail oder Passwort ist falsch."
      : "Fehler: " + err.message;
  }
});

async function logout() {
  try { await signOut(auth); } catch (err) { /* ignore */ }
}
warteFreigabeAbmelden.addEventListener("click", logout);

// ===========================================================
// SETUP SCREEN
// ===========================================================
function initSetupScreen() {
  if (setupInitialized) { loadFahrtenListe(); updateStartButtonState(); return; }
  setupInitialized = true;
  fahrtagInput.value = todayISO();

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { /* ignore */ }
  if (saved?.kasse) kasseInput.value = saved.kasse;
  if (saved?.rolle) selectRolle(saved.rolle);
  if (saved?.standort) selectStandort(saved.standort);

  rolleGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectRolle(btn.dataset.rolle));
  });
  standortGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectStandort(btn.dataset.standort));
  });

  fahrtManuellBtn.addEventListener("click", () => {
    manuellerModus = !manuellerModus;
    fahrtagManuellField.classList.toggle("hidden", !manuellerModus);
    fahrtManuellBtn.textContent = manuellerModus ? "Fahrt stattdessen aus der Liste wählen" : "Fahrtag stattdessen manuell eingeben";
    if (manuellerModus) selectedFahrtId = null;
    renderFahrtList();
    updateStartButtonState();
  });
  fahrtagInput.addEventListener("change", updateStartButtonState);

  startBtn.addEventListener("click", startSession);
  loadFahrtenListe();
  updateStartButtonState();
}

async function loadFahrtenListe() {
  fahrtListEl.innerHTML = '<li class="activity-empty">Lade Fahrten…</li>';
  try {
    await authReady;
    const q = query(collection(db, "fahrten"), orderBy("fahrtag", "desc"), limit(40));
    const snap = await getDocs(q);
    fahrtenListe = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFahrtList();
  } catch (err) {
    console.error("[Kassenapp] Fehler beim Laden der Fahrten:", err);
    fahrtListEl.innerHTML = `<li class="activity-empty">Fahrten konnten nicht geladen werden: ${escapeHtml(err.message)}</li>`;
  }
}

function renderFahrtList() {
  if (manuellerModus) { fahrtListField.classList.add("hidden"); return; }
  fahrtListField.classList.remove("hidden");
  if (!fahrtenListe.length) {
    fahrtListEl.innerHTML = `<li class="activity-empty">In der Fahrgastzählapp wurde noch keine Fahrt angelegt.</li>`;
    return;
  }
  fahrtListEl.innerHTML = fahrtenListe.map((f) => {
    const anzahl = (f.einzelperson || 0) + (f.familien || 0) + (f.gruppen || 0);
    return `<li>
      <button type="button" class="fahrt-btn ${f.id === selectedFahrtId ? "active" : ""}" data-id="${f.id}">
        <span>${formatDateDE(f.fahrtag)}${f.zug ? " · " + escapeHtml(f.zug) : ""}</span>
        <span class="fahrt-sub">${anzahl} Fahrgäste bisher</span>
      </button>
    </li>`;
  }).join("");
  fahrtListEl.querySelectorAll(".fahrt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedFahrtId = btn.dataset.id;
      renderFahrtList();
      updateStartButtonState();
    });
  });
}

function selectRolle(rolle) {
  selectedRolle = rolle;
  rolleGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rolle === rolle);
  });
  updateStartButtonState();
}

function selectStandort(standort) {
  selectedStandort = standort;
  standortGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.standort === standort);
  });
  updateStartButtonState();
}

function updateStartButtonState() {
  const hasFahrtag = manuellerModus ? !!fahrtagInput.value : !!selectedFahrtId;
  startBtn.disabled = !(hasFahrtag && selectedRolle && selectedStandort);
}

function showSetupError(msg) { setupError.textContent = msg; }
function showSetupInfo(msg) { setupInfo.textContent = msg; }

async function startSession() {
  showSetupError(""); showSetupInfo("");

  let fahrtag, fahrtId;
  if (manuellerModus) {
    fahrtag = fahrtagInput.value;
    fahrtId = null; // echte "fahrten"-Dokument-ID unbekannt -> keine automatische Zählung möglich
  } else {
    const gewaehlt = fahrtenListe.find((f) => f.id === selectedFahrtId);
    fahrtag = gewaehlt?.fahrtag;
    fahrtId = gewaehlt?.id || null;
  }
  const kasse = kasseInput.value.trim() || "Kasse";

  if (!fahrtag) { showSetupError("Bitte einen Fahrtag wählen."); return; }
  if (!selectedRolle) { showSetupError("Bitte eine Rolle wählen."); return; }
  if (!selectedStandort) { showSetupError("Bitte einen Standort wählen."); return; }

  startBtn.disabled = true;
  startBtn.textContent = "Verbinde…";

  try {
    await authReady;
    session = { fahrtag, fahrtId, kasse, rolle: selectedRolle, standort: selectedStandort };
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
  berichtGruppenStandort.textContent = STANDORT_LABEL[session.standort] || session.standort;
  preiseStandort.textContent = STANDORT_LABEL[session.standort] || session.standort;

  applyRolleZuUI();

  const docId = `${session.fahrtag}_${session.standort}`; // Kassenbuch/Bericht/Verkäufe/Gutscheine: eigenes Buch je Fahrtag UND Standort
  fahrtRef = session.fahrtId ? doc(db, "fahrten", session.fahrtId) : null;
  kassenbuchRef = doc(db, "kassenbuch", docId);
  berichtRef = doc(db, "berichte", docId);

  subscribePreise();
  subscribeFahrt();
  subscribeKassenbuch();
  subscribeBuchungen();
  subscribeBericht();
  subscribeVerkaeufe();
  subscribeGutscheine();
  renderSaleList();
  updateRgDisplay();
}

// Blendet Tabs ein/aus je nach gewählter Rolle und aktiviert den passenden
// Start-Tab. Tabs ohne data-rollen-Attribut sind für alle Rollen sichtbar.
function applyRolleZuUI() {
  const rolle = session.rolle;
  let ersterSichtbarerTab = null;
  tabbar.querySelectorAll(".tab-btn").forEach((btn) => {
    const erlaubt = btn.dataset.rollen ? btn.dataset.rollen.split(",").includes(rolle) : true;
    btn.classList.toggle("hidden", !erlaubt);
    if (erlaubt && !ersterSichtbarerTab) ersterSichtbarerTab = btn;
  });
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  tabbar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  if (ersterSichtbarerTab) {
    ersterSichtbarerTab.classList.add("active");
    el("tab-" + ersterSichtbarerTab.dataset.tab).classList.add("active");
  }

  // Zahlweise-Umschalter im Verkauf-Tab nur bei Rolle "beide" anzeigen –
  // bei "kasse" fest auf Bar, bei "karte" fest auf Karte.
  zahlweiseField.classList.toggle("hidden", rolle !== "beide");
  setZahlweise(rolle === "karte" ? "karte" : "bar");
}

function leaveApp() {
  [unsubKassenbuch, unsubBuchungen, unsubFahrt, unsubBericht, unsubPreise, unsubVerkaeufe, unsubGutscheine].forEach((u) => u && u());
  appScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  showSetupError(""); showSetupInfo("");
  fahrtagInput.value = session?.fahrtag || todayISO();
  if (session?.fahrtId) { selectedFahrtId = session.fahrtId; renderFahrtList(); updateStartButtonState(); }
  if (session?.rolle) selectRolle(session.rolle);
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
  const ref = doc(db, "einstellungen", `preise-${session.standort}`);
  preiseElmsteinGrid.classList.toggle("hidden", session.standort !== "elmstein");
  unsubPreise = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      preise = {
        ea: d.ea || 0, ra: d.ra || 0,
        ek: d.ek || 0, rk: d.rk || 0,
        ef: d.ef || 0, rf: d.rf || 0,
        ena: d.ena || 0, enk: d.enk || 0, enf: d.enf || 0
      };
    } else {
      preise = { ea: 0, ra: 0, ek: 0, rk: 0, ef: 0, rf: 0, ena: 0, enk: 0, enf: 0 };
    }
    preisEA.value = (preise.ea / 100).toFixed(2).replace(".", ",");
    preisRA.value = (preise.ra / 100).toFixed(2).replace(".", ",");
    preisEK.value = (preise.ek / 100).toFixed(2).replace(".", ",");
    preisRK.value = (preise.rk / 100).toFixed(2).replace(".", ",");
    preisEF.value = (preise.ef / 100).toFixed(2).replace(".", ",");
    preisRF.value = (preise.rf / 100).toFixed(2).replace(".", ",");
    if (session.standort === "elmstein") {
      preisENA.value = (preise.ena / 100).toFixed(2).replace(".", ",");
      preisENK.value = (preise.enk / 100).toFixed(2).replace(".", ",");
      preisENF.value = (preise.enf / 100).toFixed(2).replace(".", ",");
    }
    renderSaleList();
    updateRgDisplay();
    renderBericht();
  }, (err) => showToast("Fehler beim Laden der Preise: " + err.message));
}

preiseSpeichern.addEventListener("click", async () => {
  const neu = {
    ea: toCents(preisEA.value), ra: toCents(preisRA.value),
    ek: toCents(preisEK.value), rk: toCents(preisRK.value),
    ef: toCents(preisEF.value), rf: toCents(preisRF.value)
  };
  if (session.standort === "elmstein") {
    neu.ena = toCents(preisENA.value);
    neu.enk = toCents(preisENK.value);
    neu.enf = toCents(preisENF.value);
  }
  try {
    await setDoc(doc(db, "einstellungen", `preise-${session.standort}`), { ...neu, aktualisiert: serverTimestamp() }, { merge: true });
    preiseHinweis.textContent = `Preise gespeichert – gelten sofort für alle Kassen in ${STANDORT_LABEL[session.standort] || session.standort}.`;
    setTimeout(() => { preiseHinweis.textContent = ""; }, 4000);
  } catch (err) {
    preiseHinweis.textContent = err.code === "permission-denied"
      ? "Preise ändern dürfen laut Regeln nur Admin-Konten (nicht jedes Bearbeiter-Konto)."
      : "Fehler: " + err.message;
  }
});

// ===========================================================
// VERKAUF (Ticketauswahl, Rückgeld, Kauf abschließen)
// ===========================================================
function saleTotalCents() {
  return aktiveTicketTypes().reduce((sum, t) => sum + (saleQty[t.key] || 0) * (preise[t.key] || 0), 0);
}

function gruppenTotalCents() {
  return GRUPPEN_TICKET_TYPES.reduce((sum, g) => sum + (gruppenQty[g.key] || 0) * (gruppenPreis[g.key] || 0), 0);
}

function gutscheinPreis(key) {
  const g = GUTSCHEIN_TYPES.find((x) => x.key === key);
  return g ? (preise[g.preisTicket] || 0) : 0;
}

function gutscheinAbzugCents() {
  return GUTSCHEIN_TYPES.reduce((sum, g) => sum + (gutscheinQty[g.key] || 0) * gutscheinPreis(g.key), 0);
}

function zuZahlenCents() {
  return Math.max(0, saleTotalCents() + gruppenTotalCents() - gutscheinAbzugCents());
}

function renderSaleList() {
  saleListEl.innerHTML = aktiveTicketTypes().map((t) => {
    const qty = saleQty[t.key] || 0;
    const price = preise[t.key] || 0;
    return `<li class="sale-row">
      <div>
        <span class="sale-name">${t.label}</span>
        <span class="sale-price">${euro(price)} / Ticket</span>
      </div>
      <div class="sale-stepper">
        <button type="button" class="sale-step-btn" data-action="minus" data-key="${t.key}" aria-label="weniger ${t.label}">−</button>
        <input type="text" inputmode="numeric" class="sale-qty" data-key="${t.key}" value="${qty}">
        <button type="button" class="sale-step-btn" data-action="plus" data-key="${t.key}" aria-label="mehr ${t.label}">+</button>
      </div>
      <span class="sale-subtotal">${euro(qty * price)}</span>
    </li>`;
  }).join("");

  saleListEl.querySelectorAll(".sale-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const delta = btn.dataset.action === "plus" ? 1 : -1;
      saleQty[key] = Math.max(0, (saleQty[key] || 0) + delta);
      renderSaleList();
      updateRgDisplay();
    });
  });
  saleListEl.querySelectorAll(".sale-qty").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      saleQty[key] = Math.max(0, parseInt(input.value, 10) || 0);
      renderSaleList();
      updateRgDisplay();
    });
  });

  saleTotalEl.textContent = euro(saleTotalCents());
  renderGruppenList();
  renderGutscheinList();
}

function renderGruppenList() {
  gruppenListEl.innerHTML = GRUPPEN_TICKET_TYPES.map((g) => {
    const qty = gruppenQty[g.key] || 0;
    const preisCents = gruppenPreis[g.key] || 0;
    return `<li class="sale-row">
      <div>
        <span class="sale-name">${g.label}</span>
        <span class="sale-price">
          <input type="text" inputmode="decimal" class="sale-price-input" data-key="${g.key}"
            value="${preisCents ? (preisCents / 100).toFixed(2).replace(".", ",") : ""}" placeholder="0,00"> € / Person
        </span>
      </div>
      <div class="sale-stepper">
        <button type="button" class="sale-step-btn" data-action="minus" data-key="${g.key}" aria-label="weniger ${g.label}">−</button>
        <input type="text" inputmode="numeric" class="sale-qty" data-key="${g.key}" value="${qty}">
        <button type="button" class="sale-step-btn" data-action="plus" data-key="${g.key}" aria-label="mehr ${g.label}">+</button>
      </div>
      <span class="sale-subtotal">${euro(qty * preisCents)}</span>
    </li>`;
  }).join("");

  gruppenListEl.querySelectorAll(".sale-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const delta = btn.dataset.action === "plus" ? 1 : -1;
      gruppenQty[key] = Math.max(0, (gruppenQty[key] || 0) + delta);
      renderGruppenList();
      updateRgDisplay();
    });
  });
  gruppenListEl.querySelectorAll(".sale-qty").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      gruppenQty[key] = Math.max(0, parseInt(input.value, 10) || 0);
      renderGruppenList();
      updateRgDisplay();
    });
  });
  gruppenListEl.querySelectorAll(".sale-price-input").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      gruppenPreis[key] = toCents(input.value);
      renderGruppenList();
      updateRgDisplay();
    });
  });

  gruppenSummeVerkaufEl.textContent = euro(gruppenTotalCents());
}

function renderGutscheinList() {
  gutscheinListEl.innerHTML = GUTSCHEIN_TYPES.map((g) => {
    const qty = gutscheinQty[g.key] || 0;
    const price = gutscheinPreis(g.key);
    return `<li class="sale-row">
      <div>
        <span class="sale-name">${g.label}</span>
        <span class="sale-price">${euro(price)} / Stück</span>
      </div>
      <div class="sale-stepper">
        <button type="button" class="sale-step-btn" data-action="minus" data-key="${g.key}" aria-label="weniger ${g.label}">−</button>
        <input type="text" inputmode="numeric" class="sale-qty" data-key="${g.key}" value="${qty}">
        <button type="button" class="sale-step-btn" data-action="plus" data-key="${g.key}" aria-label="mehr ${g.label}">+</button>
      </div>
      <span class="sale-subtotal">${euro(qty * price)}</span>
    </li>`;
  }).join("");

  gutscheinListEl.querySelectorAll(".sale-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const delta = btn.dataset.action === "plus" ? 1 : -1;
      gutscheinQty[key] = Math.max(0, (gutscheinQty[key] || 0) + delta);
      renderGutscheinList();
      updateRgDisplay();
    });
  });
  gutscheinListEl.querySelectorAll(".sale-qty").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      gutscheinQty[key] = Math.max(0, parseInt(input.value, 10) || 0);
      renderGutscheinList();
      updateRgDisplay();
    });
  });

  gutscheinAbzugEl.textContent = "− " + euro(gutscheinAbzugCents());
  zuZahlenEl.textContent = euro(zuZahlenCents());
}

function setZahlweise(neu) {
  zahlweise = neu;
  zahlweiseGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zahlweise === neu);
  });
  barBereich.classList.toggle("hidden", neu === "karte");
  karteBereich.classList.toggle("hidden", neu === "bar");
  updateRgDisplay();
}

function updateRgDisplay() {
  saleTotalEl.textContent = euro(saleTotalCents());
  gruppenSummeVerkaufEl.textContent = euro(gruppenTotalCents());
  gutscheinAbzugEl.textContent = "− " + euro(gutscheinAbzugCents());
  zuZahlenEl.textContent = euro(zuZahlenCents());
  const total = zuZahlenCents();
  const bruttoGesamt = saleTotalCents() + gruppenTotalCents();

  if (zahlweise === "karte") {
    karteBetragValue.textContent = euro(total);
    rgVerbuchen.disabled = !(bruttoGesamt > 0);
    return;
  }

  rgGegebenBtn.textContent = euro(rgGegebenCents);
  const diff = rgGegebenCents - total;
  rgResultValue.textContent = euro(Math.abs(diff));
  rgResultLabel.textContent = diff < 0 ? "Fehlbetrag – bitte mehr verlangen" : "Rückgeld";
  rgResult.classList.toggle("rg-negativ", diff < 0);
  rgVerbuchen.disabled = !(bruttoGesamt > 0 && diff >= 0);
  updateStueckelung();
}

function updateStueckelung() {
  const total = zuZahlenCents();
  const diff = rgGegebenCents - total;
  if (total === 0) {
    stueckelungList.innerHTML = '<li class="activity-empty">Tickets auswählen und gegebenen Betrag eingeben.</li>';
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

zahlweiseGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle-btn");
  if (!btn) return;
  setZahlweise(btn.dataset.zahlweise);
});

rgGegebenBtn.addEventListener("click", () => {
  openNumpad("gegeben", "Gegebenen Betrag eingeben", rgGegebenCents);
});
rgSchnellwahl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.val === "passend") {
    rgGegebenCents = saleTotalCents();
  } else {
    rgGegebenCents = Math.round(parseFloat(chip.dataset.val) * 100);
  }
  updateRgDisplay();
});
rgReset.addEventListener("click", () => {
  saleQty = {}; gruppenQty = { ge: 0, gk: 0 }; gruppenPreis = { ge: 0, gk: 0 };
  gutscheinQty = { familie: 0, einzelperson: 0 }; rgGegebenCents = 0;
  rgVerbuchenHint.textContent = "";
  renderSaleList();
  updateRgDisplay();
});

// Zeigt die Sitzplatz-Warnung und liefert per Promise, ob trotzdem fortgefahren werden soll.
function frageSitzplatzWarnung(text) {
  kapazitaetText.textContent = text;
  kapazitaetOverlay.classList.remove("hidden");
  return new Promise((resolve) => {
    function schliessen(ergebnis) {
      kapazitaetOverlay.classList.add("hidden");
      kapazitaetAbbrechen.removeEventListener("click", onAbbrechen);
      kapazitaetTrotzdem.removeEventListener("click", onTrotzdem);
      resolve(ergebnis);
    }
    function onAbbrechen() { schliessen(false); }
    function onTrotzdem() { schliessen(true); }
    kapazitaetAbbrechen.addEventListener("click", onAbbrechen);
    kapazitaetTrotzdem.addEventListener("click", onTrotzdem);
  });
}

function frageStorno(text) {
  stornoText.textContent = text;
  stornoOverlay.classList.remove("hidden");
  return new Promise((resolve) => {
    function schliessen(ergebnis) {
      stornoOverlay.classList.add("hidden");
      stornoAbbrechen.removeEventListener("click", onAbbrechen);
      stornoBestaetigen.removeEventListener("click", onBestaetigen);
      resolve(ergebnis);
    }
    function onAbbrechen() { schliessen(false); }
    function onBestaetigen() { schliessen(true); }
    stornoAbbrechen.addEventListener("click", onAbbrechen);
    stornoBestaetigen.addEventListener("click", onBestaetigen);
  });
}

// Macht eine Buchung (Verkauf, Ein-/Auszahlung) rückgängig: löscht die dazu
// erfassten Ticketverkäufe/Gutscheine, macht die automatische Fahrgastzählung
// rückgängig (increment mit negativem Wert + Löschen der Zählereignisse) und
// markiert die Kassenbuch-Buchung selbst als storniert (bleibt als Beleg sichtbar,
// zählt aber in keiner Summe mehr mit).
async function stornoBuchung(buchung, btnEl) {
  if (buchung.storniert) return;
  const label = buchung.grund || (buchung.typ === "einzahlung" ? "Einzahlung" : buchung.typ === "auszahlung" ? "Auszahlung" : "Kartenzahlung");
  const bestaetigt = await frageStorno(`"${label}" über ${euro(buchung.betrag || 0)} stornieren? Verkaufte Tickets/Gutscheine und die automatische Fahrgastzählung werden dabei ebenfalls rückgängig gemacht. Das lässt sich nicht rückgängig machen.`);
  if (!bestaetigt) return;

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Storniere…"; }
  try {
    const details = buchung.verkaufDetails;
    if (details) {
      const standortDocId = `${session.fahrtag}_${session.standort}`;
      for (const id of details.verkaufEintragIds || []) {
        await deleteDoc(doc(db, "verkaeufe", standortDocId, "eintraege", id)).catch(() => {});
      }
      for (const id of details.gutscheinEintragIds || []) {
        await deleteDoc(doc(db, "gutscheine", standortDocId, "eintraege", id)).catch(() => {});
      }
      if (details.fahrtId && details.kategorieSummen) {
        const fRef = doc(db, "fahrten", details.fahrtId);
        try {
          const updates = {};
          Object.entries(details.kategorieSummen).forEach(([kat, anz]) => { updates[kat] = increment(-anz); });
          await updateDoc(fRef, updates);
          for (const id of details.ereignisIds || []) {
            await deleteDoc(doc(fRef, "ereignisse", id)).catch(() => {});
          }
        } catch (fahrtErr) {
          showToast("Buchung storniert, aber Fahrgastzahlen konnten nicht angepasst werden: " + fahrtErr.message);
        }
      }
    }
    await updateDoc(doc(kassenbuchRef, "buchungen", buchung.id), {
      storniert: true, storniertZeit: serverTimestamp(), storniertVon: session.kasse
    });
    showToast("Storniert.");
  } catch (err) {
    showToast("Fehler beim Stornieren: " + err.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Stornieren"; }
  }
}

rgVerbuchen.addEventListener("click", async () => {
  const bruttoTotal = saleTotalCents() + gruppenTotalCents();
  const zuZahlen = zuZahlenCents();
  const istBar = zahlweise === "bar";
  if (!(bruttoTotal > 0 && (!istBar || rgGegebenCents >= zuZahlen))) return;
  const posten = aktiveTicketTypes().filter((t) => (saleQty[t.key] || 0) > 0).map((t) => ({ ...t, anzahl: saleQty[t.key] }));
  const gruppenPosten = GRUPPEN_TICKET_TYPES.filter((g) => (gruppenQty[g.key] || 0) > 0 && (gruppenPreis[g.key] || 0) > 0)
    .map((g) => ({ ...g, anzahl: gruppenQty[g.key], einzelpreis: gruppenPreis[g.key] }));
  if (!posten.length && !gruppenPosten.length) return;
  const gutscheinPosten = GUTSCHEIN_TYPES.filter((g) => (gutscheinQty[g.key] || 0) > 0).map((g) => ({ ...g, anzahl: gutscheinQty[g.key], wert: gutscheinQty[g.key] * gutscheinPreis(g.key) }));

  rgVerbuchen.disabled = true;
  try {
    // Fahrgäste, die dieser Verkauf hinzufügen würde (Familienticket = 4 Personen, Gruppenfahrkarten je 1 Person)
    const kategorieSummen = {};
    posten.forEach((p) => { kategorieSummen[p.kategorie] = (kategorieSummen[p.kategorie] || 0) + p.anzahl * (p.personen || 1); });
    gruppenPosten.forEach((g) => { kategorieSummen[g.kategorie] = (kategorieSummen[g.kategorie] || 0) + g.anzahl * (g.personen || 1); });
    const neuePersonen = Object.values(kategorieSummen).reduce((a, b) => a + b, 0);

    const fahrtSnap = fahrtRef ? await getDoc(fahrtRef) : null;
    if (fahrtSnap && fahrtSnap.exists()) {
      const d = fahrtSnap.data();
      const belegt = (d.einzelperson || 0) + (d.familien || 0) + (d.gruppen || 0);
      const sitzplaetze = d.sitzplaetze || 0;
      if (sitzplaetze > 0 && belegt + neuePersonen > sitzplaetze) {
        const weiter = await frageSitzplatzWarnung(
          `Belegt: ${belegt} von ${sitzplaetze} Sitzplätzen. Dieser Verkauf würde auf ${belegt + neuePersonen} erhöhen.`
        );
        if (!weiter) { rgVerbuchen.disabled = false; return; }
      }
    }

    const grundTeile = posten.map((p) => `${p.anzahl}× ${p.label}`);
    grundTeile.push(...gruppenPosten.map((g) => `${g.anzahl}× ${g.label} (${euro(g.einzelpreis)}/Person)`));
    if (gutscheinPosten.length) grundTeile.push(...gutscheinPosten.map((g) => `− ${g.anzahl}× ${g.label}`));
    const grund = "Verkauf: " + grundTeile.join(", ");

    const eintraegeRef = collection(db, "verkaeufe", `${session.fahrtag}_${session.standort}`, "eintraege");
    const verkaufEintragIds = [];
    for (const p of posten) {
      const ref = await addDoc(eintraegeRef, {
        ticket: p.key, anzahl: p.anzahl, einzelpreis: preise[p.key] || 0,
        summe: p.anzahl * (preise[p.key] || 0), kasse: session.kasse, zahlweise, zeit: serverTimestamp()
      });
      verkaufEintragIds.push(ref.id);
    }
    for (const g of gruppenPosten) {
      const ref = await addDoc(eintraegeRef, {
        ticket: g.key, anzahl: g.anzahl, einzelpreis: g.einzelpreis,
        summe: g.anzahl * g.einzelpreis, kasse: session.kasse, zahlweise, zeit: serverTimestamp()
      });
      verkaufEintragIds.push(ref.id);
    }
    const gutscheinEintragIds = [];
    if (gutscheinPosten.length) {
      const gutscheinRef = collection(db, "gutscheine", `${session.fahrtag}_${session.standort}`, "eintraege");
      for (const g of gutscheinPosten) {
        const ref = await addDoc(gutscheinRef, {
          typ: g.key, anzahl: g.anzahl, wert: g.wert, kasse: session.kasse, zeit: serverTimestamp()
        });
        gutscheinEintragIds.push(ref.id);
      }
    }

    const rueckgeld = istBar ? Math.max(0, rgGegebenCents - zuZahlen) : 0;
    let hint;
    if (zuZahlen === 0) {
      hint = "Verkauf komplett mit Gutschein bezahlt, kein Betrag fällig.";
    } else if (istBar) {
      hint = `${euro(zuZahlen)} erhalten, ${euro(rueckgeld)} Rückgeld.`;
    } else {
      hint = `${euro(zuZahlen)} per Karte gebucht.`;
    }

    const ereignisIds = [];
    if (fahrtSnap && fahrtSnap.exists()) {
      const updates = {};
      Object.entries(kategorieSummen).forEach(([kat, anz]) => { updates[kat] = increment(anz); });
      await updateDoc(fahrtRef, updates);
      for (const [kat, anz] of Object.entries(kategorieSummen)) {
        const ref = await addDoc(collection(fahrtRef, "ereignisse"), { kategorie: kat, anzahl: anz, kasse: session.kasse, zeit: serverTimestamp() });
        ereignisIds.push(ref.id);
      }
      rgVerbuchenHint.textContent = hint + " Fahrgäste wurden automatisch gezählt.";
    } else {
      rgVerbuchenHint.textContent = hint + " Achtung: Für diesen Fahrtag läuft noch keine Zählung in der Fahrgastzählapp – Fahrgastzahlen wurden nicht aktualisiert.";
    }

    // Alles, was ein späteres "Stornieren" braucht, um Verkauf, Gutscheine
    // und Fahrgastzählung sauber wieder rückgängig zu machen.
    const verkaufDetails = {
      fahrtId: (fahrtSnap && fahrtSnap.exists()) ? session.fahrtId : null,
      posten: posten.map((p) => ({ ticket: p.key, label: p.label, anzahl: p.anzahl, einzelpreis: preise[p.key] || 0 }))
        .concat(gruppenPosten.map((g) => ({ ticket: g.key, label: g.label, anzahl: g.anzahl, einzelpreis: g.einzelpreis }))),
      verkaufEintragIds,
      gutscheine: gutscheinPosten.map((g) => ({ typ: g.key, label: g.label, anzahl: g.anzahl, wert: g.wert })),
      gutscheinEintragIds,
      kategorieSummen,
      ereignisIds
    };
    await bucheKassenbuch(istBar ? "einzahlung" : "kartenzahlung", zuZahlen, grund, verkaufDetails);

    saleQty = {}; gruppenQty = { ge: 0, gk: 0 }; gruppenPreis = { ge: 0, gk: 0 };
    gutscheinQty = { familie: 0, einzelperson: 0 }; rgGegebenCents = 0;
    renderSaleList();
    updateRgDisplay();
  } catch (err) {
    rgVerbuchenHint.textContent = "Fehler: " + err.message;
  } finally {
    rgVerbuchen.disabled = false;
  }
});

// ===========================================================
// KASSENBUCH
// ===========================================================
function subscribeFahrt() {
  if (!fahrtRef) {
    // Manuell eingegebener Fahrtag ohne bekannte "fahrten"-Dokument-ID:
    // Verbindungsstatus stattdessen am Kassenbuch ablesen.
    unsubFahrt = onSnapshot(kassenbuchRef, (snap) => {
      setConnStatus(snap.metadata.fromCache ? "offline" : "online");
    }, () => setConnStatus("offline"));
    return;
  }
  unsubFahrt = onSnapshot(fahrtRef, (snap) => {
    setConnStatus(snap.metadata.fromCache ? "offline" : "online");
  }, (err) => {
    setConnStatus("offline");
  });
}

// ---------------------------------------------------------
// Stückelungsrechner (für Anfangsbestand und gezählten Endbestand)
// ---------------------------------------------------------
function stueckelungSumme(counts) {
  return KASSEN_STUECKELUNG.reduce((sum, d) => sum + (counts[String(d.cents)] || 0) * d.cents, 0);
}

function renderStueckelungsGrid(gridEl, counts, onChange) {
  gridEl.innerHTML = KASSEN_STUECKELUNG.map((d) => {
    const anzahl = counts[String(d.cents)] || 0;
    return `<div class="stueck-eingabe">
      <label>${d.label}</label>
      <input type="text" inputmode="numeric" data-cents="${d.cents}" value="${anzahl || ""}" placeholder="0">
      <span class="stueck-sub">${euro(anzahl * d.cents)}</span>
    </div>`;
  }).join("");
  gridEl.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const cents = input.dataset.cents;
      const anzahl = Math.max(0, parseInt(input.value, 10) || 0);
      counts[cents] = anzahl;
      renderStueckelungsGrid(gridEl, counts, onChange);
      onChange(counts);
    });
  });
}

function onAnfangsbestandStueckChange(counts) {
  const summe = stueckelungSumme(counts);
  anfangsbestandInput.value = (summe / 100).toFixed(2).replace(".", ",");
}

function onEndbestandStueckChange(counts) {
  renderKassenbuch();
}

anfangsbestandStueckelnToggle.addEventListener("click", () => {
  anfangsbestandStueckelungGrid.classList.toggle("hidden");
});
anfangsbestandInput.addEventListener("input", () => { anfangsbestandCounts = {}; });

function subscribeKassenbuch() {
  unsubKassenbuch = onSnapshot(kassenbuchRef, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      kassenbuchAnfangCents = d.anfangsbestand || 0;
      anfangsbestandInput.value = (kassenbuchAnfangCents / 100).toFixed(2).replace(".", ",");
      anfangsbestandCounts = d.anfangsbestandStueckelung || {};
      endbestandCounts = d.endbestandStueckelung || {};
    } else {
      kassenbuchAnfangCents = 0;
      anfangsbestandInput.value = "";
      anfangsbestandCounts = {};
      endbestandCounts = {};
    }
    renderStueckelungsGrid(anfangsbestandStueckelungGrid, anfangsbestandCounts, onAnfangsbestandStueckChange);
    renderStueckelungsGrid(endbestandStueckelungGrid, endbestandCounts, onEndbestandStueckChange);
    renderKassenbuch();
  }, (err) => showToast("Fehler beim Laden des Kassenbuchs: " + err.message));
}

function subscribeBuchungen() {
  const q = query(collection(kassenbuchRef, "buchungen"), orderBy("zeit", "desc"), limit(50));
  unsubBuchungen = onSnapshot(q, (snap) => {
    buchungenListe = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderKassenbuch();
    renderKbListe();
    renderBericht();
  }, (err) => showToast("Fehler beim Laden der Buchungen: " + err.message));
}

function renderKassenbuch() {
  const aktiv = buchungenListe.filter((b) => !b.storniert);
  const einSumme = aktiv.filter(b => b.typ === "einzahlung").reduce((s, b) => s + (b.betrag || 0), 0);
  const ausSumme = aktiv.filter(b => b.typ === "auszahlung").reduce((s, b) => s + (b.betrag || 0), 0);
  const gesamt = kassenbuchAnfangCents + einSumme - ausSumme;
  kbAnfang.textContent = euro(kassenbuchAnfangCents);
  kbEin.textContent = "+ " + euro(einSumme);
  kbAus.textContent = "− " + euro(ausSumme);
  kbTotal.textContent = euro(gesamt);
  const kartenSumme = aktiv.filter(b => b.typ === "kartenzahlung").reduce((s, b) => s + (b.betrag || 0), 0);
  kbKarteSumme.textContent = euro(kartenSumme);

  const endSumme = stueckelungSumme(endbestandCounts);
  endbestandGezaehltSumme.textContent = euro(endSumme);
  endbestandSoll.textContent = euro(gesamt);
  const diff = endSumme - gesamt;
  endbestandDiff.textContent = (diff >= 0 ? "+" : "") + euro(diff);
  endbestandDiffRow.classList.toggle("diff-ok", diff === 0);
  endbestandDiffRow.classList.toggle("diff-bad", diff !== 0);
}

function renderKbListe() {
  if (!buchungenListe.length) {
    kbList.innerHTML = '<li class="activity-empty">Noch keine Buchungen heute.</li>';
    return;
  }
  kbList.innerHTML = buchungenListe.map((b) => {
    const sign = b.typ === "auszahlung" ? "−" : "+";
    const cls = b.typ === "auszahlung" ? "activity-delta-neg" : b.typ === "kartenzahlung" ? "activity-delta-karte" : "activity-delta-pos";
    const bezeichnung = b.typ === "einzahlung" ? "Einzahlung" : b.typ === "auszahlung" ? "Auszahlung" : "Kartenzahlung";
    const aktionEl = b.storniert
      ? `<span class="activity-storniert-label">storniert${b.storniertVon ? " · " + escapeHtml(b.storniertVon) : ""}</span>`
      : `<button type="button" class="activity-storno-btn" data-id="${b.id}">Stornieren</button>`;
    return `<li class="${b.storniert ? "activity-storniert" : ""}">
      <span class="activity-desc">${escapeHtml(b.kasse || "Kasse")} · ${escapeHtml(b.grund || bezeichnung)}</span>
      <span class="${cls}">${sign} ${euro(b.betrag || 0)}${b.typ === "kartenzahlung" ? " (Karte)" : ""}</span>
      <span class="activity-time">${formatTimeDE(b.zeit)}</span>
      ${aktionEl}
    </li>`;
  }).join("");

  kbList.querySelectorAll(".activity-storno-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const buchung = buchungenListe.find((b) => b.id === btn.dataset.id);
      if (buchung) stornoBuchung(buchung, btn);
    });
  });
}

async function bucheKassenbuch(typ, betragCents, grund, verkaufDetails) {
  const snap = await getDoc(kassenbuchRef);
  if (!snap.exists()) {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      anfangsbestand: 0, erstellt: serverTimestamp(), aktualisiert: serverTimestamp()
    });
  } else {
    await updateDoc(kassenbuchRef, { aktualisiert: serverTimestamp() });
  }
  const ref = await addDoc(collection(kassenbuchRef, "buchungen"), {
    typ, betrag: betragCents, grund: grund || "", kasse: session.kasse,
    storniert: false,
    ...(verkaufDetails ? { verkaufDetails } : {}),
    zeit: serverTimestamp()
  });
  return ref.id;
}

anfangsbestandSpeichern.addEventListener("click", async () => {
  const cents = toCents(anfangsbestandInput.value);
  try {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      anfangsbestand: cents, anfangsbestandStueckelung: anfangsbestandCounts,
      aktualisiert: serverTimestamp()
    }, { merge: true });
    showToast("Anfangsbestand gespeichert: " + euro(cents));
  } catch (err) {
    showToast("Fehler: " + err.message);
  }
});

endbestandSpeichern.addEventListener("click", async () => {
  const summe = stueckelungSumme(endbestandCounts);
  try {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      endbestandStueckelung: endbestandCounts, endbestandGezaehlt: summe,
      aktualisiert: serverTimestamp()
    }, { merge: true });
    endbestandHinweis.textContent = "Gezählter Endbestand gespeichert: " + euro(summe);
    setTimeout(() => { endbestandHinweis.textContent = ""; }, 4000);
  } catch (err) {
    endbestandHinweis.textContent = "Fehler: " + err.message;
  }
});

kbEinzahlungBtn.addEventListener("click", () => openNumpad("einzahlung", "Einzahlung – Betrag", 0, true));
kbAuszahlungBtn.addEventListener("click", () => openNumpad("auszahlung", "Auszahlung – Betrag", 0, true));

// ===========================================================
// VERKAUFSBERICHT
// ===========================================================
// ticketBestand/Gutscheine/Bemerkung werden direkt in Firestore gespeichert
// (gemeinsam pro Fahrtag, für alle Kassen sichtbar). Kartenzahlung wird
// nicht mehr manuell eingetragen, sondern live aus den im Kassenbuch
// erfassten Kartenzahlungen berechnet.
function subscribeBericht() {
  unsubBericht = onSnapshot(berichtRef, (snap) => {
    const d = snap.exists() ? snap.data() : {};
    ticketBestand = d.ticketBestand || {};
    aktiveTicketTypes().forEach((t) => { if (!ticketBestand[t.key]) ticketBestand[t.key] = {}; });

    berichtGruppen.value = d.gruppenEinnahme != null ? (d.gruppenEinnahme / 100).toFixed(2).replace(".", ",") : "";
    berichtKarte.value = d.kartenzahlung != null ? (d.kartenzahlung / 100).toFixed(2).replace(".", ",") : "";
    berichtGutscheinFamilie.value = d.gutscheinFamilieAnzahl != null ? d.gutscheinFamilieAnzahl : "";
    berichtGutscheinEinzel.value = d.gutscheinEinzelAnzahl != null ? d.gutscheinEinzelAnzahl : "";
    if (d.bemerkung) berichtBemerkung.value = d.bemerkung;

    renderBericht();
  }, (err) => showToast("Fehler beim Laden des Berichts: " + err.message));
}

function subscribeVerkaeufe() {
  const ref = collection(db, "verkaeufe", `${session.fahrtag}_${session.standort}`, "eintraege");
  unsubVerkaeufe = onSnapshot(ref, (snap) => {
    const sums = {};
    aktiveTicketTypes().forEach((t) => { sums[t.key] = { anzahl: 0, umsatz: 0 }; });
    snap.forEach((d) => {
      const x = d.data();
      if (!sums[x.ticket]) sums[x.ticket] = { anzahl: 0, umsatz: 0 };
      sums[x.ticket].anzahl += x.anzahl || 0;
      sums[x.ticket].umsatz += x.summe || 0;
    });
    verkaeufeSums = sums;
    renderBericht();
  }, (err) => showToast("Fehler beim Laden der Verkäufe: " + err.message));
}

function subscribeGutscheine() {
  const ref = collection(db, "gutscheine", `${session.fahrtag}_${session.standort}`, "eintraege");
  unsubGutscheine = onSnapshot(ref, (snap) => {
    const sums = { familie: 0, einzelperson: 0 };
    snap.forEach((d) => {
      const x = d.data();
      if (sums[x.typ] != null) sums[x.typ] += x.anzahl || 0;
    });
    gutscheineSums = sums;
    renderBericht();
  }, (err) => showToast("Fehler beim Laden der Gutscheine: " + err.message));
}

// Anzahl verkaufter Tickets einer Art = Endstand − Anfangsbestand der fortlaufenden
// Fahrkartennummern. null, wenn einer der beiden Werte fehlt oder der Endstand
// kleiner als der Anfangsbestand ist (z. B. weil noch nicht eingetragen).
function ticketVerkauft(key) {
  const b = ticketBestand[key] || {};
  if (b.anfang == null || b.ende == null) return null;
  const diff = b.ende - b.anfang;
  return diff >= 0 ? diff : null;
}

// Summe aller im Kassenbuch erfassten Kartenzahlungen (aller Kassen, heute).
function kartenzahlungSummeCents() {
  return buchungenListe.filter((b) => b.typ === "kartenzahlung" && !b.storniert).reduce((s, b) => s + (b.betrag || 0), 0);
}

// Tatsächlich bar eingenommenes Geld aus Ticketverkäufen (heute, alle Kassen) —
// direkt aus den Kassenbuch-Einzahlungen, die vom Verkauf-Tab stammen. Das ist
// bereits der Betrag NACH Abzug eingelöster Gutscheine (nicht der Bruttopreis
// der Tickets), damit es korrekt mit den erwarteten Bargeldeinnahmen vergleichbar ist.
function verkaufBarSummeCents() {
  return buchungenListe
    .filter((b) => b.typ === "einzahlung" && !b.storniert && (b.grund || "").startsWith("Verkauf:"))
    .reduce((s, b) => s + (b.betrag || 0), 0);
}

// Summe der heute im Verkauf-Tab verkauften Gruppenfahrkarten (ticket "ge"/"gk"),
// aus derselben "verkaeufe"-Collection wie die normalen Tickets.
function gruppenVerkaufSummeCents() {
  return (verkaeufeSums.ge ? verkaeufeSums.ge.umsatz : 0) + (verkaeufeSums.gk ? verkaeufeSums.gk.umsatz : 0);
}

function renderBericht() {
  let gesamteinnahme = 0;
  berichtBody.innerHTML = aktiveTicketTypes().map((t) => {
    const b = ticketBestand[t.key] || {};
    const verkauft = ticketVerkauft(t.key);
    const preis = preise[t.key] || 0;
    const umsatz = verkauft != null ? verkauft * preis : 0;
    gesamteinnahme += umsatz;
    return `<tr data-key="${t.key}">
      <td>${t.label}</td>
      <td><input type="text" class="bericht-anfang" inputmode="numeric" maxlength="4" placeholder="–" value="${b.anfang != null ? b.anfang : ""}" data-key="${t.key}"></td>
      <td><input type="text" class="bericht-ende" inputmode="numeric" maxlength="4" placeholder="–" value="${b.ende != null ? b.ende : ""}" data-key="${t.key}"></td>
      <td class="kb-mono">${verkauft != null ? verkauft : "–"}</td>
      <td>${euro(preis)}</td>
      <td class="bericht-umsatz kb-mono">${euro(umsatz)}</td>
    </tr>`;
  }).join("");
  gesamteinnahme += toCents(berichtGruppen.value);
  berichtGesamt.textContent = euro(gesamteinnahme);
  berichtSummeEinnahme.textContent = euro(gesamteinnahme);
  berichtGruppenAutoWert.textContent = euro(gruppenVerkaufSummeCents());

  const kartenzahlungCents = toCents(berichtKarte.value);
  berichtKarteAutoWert.textContent = euro(kartenzahlungSummeCents());

  const gutscheinFamilieAnzahl = Math.max(0, parseInt(berichtGutscheinFamilie.value, 10) || 0);
  const gutscheinFamilieBetrag = gutscheinFamilieAnzahl * (preise.rf || 0);
  const gutscheinEinzelAnzahl = Math.max(0, parseInt(berichtGutscheinEinzel.value, 10) || 0);
  const gutscheinEinzelBetrag = gutscheinEinzelAnzahl * (preise.ra || 0);
  berichtGutscheinFamilieBetrag.textContent = euro(gutscheinFamilieBetrag);
  berichtGutscheinEinzelBetrag.textContent = euro(gutscheinEinzelBetrag);
  berichtGutscheinFamilieAutoWert.textContent = gutscheineSums.familie || 0;
  berichtGutscheinEinzelAutoWert.textContent = gutscheineSums.einzelperson || 0;

  const abzug = kartenzahlungCents + gutscheinFamilieBetrag + gutscheinEinzelBetrag;
  berichtSummeAbzug.textContent = euro(abzug);
  const bargeld = gesamteinnahme - abzug;
  berichtBargeld.textContent = euro(bargeld);

  berichtAppUmsatz.textContent = euro(verkaufBarSummeCents());
  updateBerichtDiff(bargeld, verkaufBarSummeCents());

  const attachNumberInput = (selector, feld) => {
    berichtBody.querySelectorAll(selector).forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key;
        const val = input.value.trim() === "" ? null : Math.max(0, parseInt(input.value, 10) || 0);
        if (!ticketBestand[key]) ticketBestand[key] = {};
        ticketBestand[key][feld] = val;
        renderBericht();
      });
    });
  };
  attachNumberInput(".bericht-anfang", "anfang");
  attachNumberInput(".bericht-ende", "ende");
}

// diff = Ist (bar verkauft laut Kassenapp) − Soll (erwartete Bargeldeinnahmen).
// Negativ = es fehlt Geld, positiv = mehr Bargeld vorhanden als laut Berechnung nötig.
function updateBerichtDiff(bargeldCents, appUmsatzCents) {
  const diff = appUmsatzCents - bargeldCents;
  berichtDiff.textContent = (diff >= 0 ? "+" : "") + euro(diff);
  berichtDiffRow.classList.toggle("diff-ok", diff === 0);
  berichtDiffRow.classList.toggle("diff-bad", diff !== 0);
}

[berichtGruppen, berichtKarte, berichtGutscheinFamilie, berichtGutscheinEinzel].forEach((input) => {
  input.addEventListener("input", renderBericht);
});
berichtKarteAuto.addEventListener("click", () => {
  berichtKarte.value = (kartenzahlungSummeCents() / 100).toFixed(2).replace(".", ",");
  renderBericht();
});
berichtGruppenAuto.addEventListener("click", () => {
  berichtGruppen.value = (gruppenVerkaufSummeCents() / 100).toFixed(2).replace(".", ",");
  renderBericht();
});
berichtGutscheinFamilieAuto.addEventListener("click", () => {
  berichtGutscheinFamilie.value = gutscheineSums.familie || 0;
  renderBericht();
});
berichtGutscheinEinzelAuto.addEventListener("click", () => {
  berichtGutscheinEinzel.value = gutscheineSums.einzelperson || 0;
  renderBericht();
});

berichtSpeichern.addEventListener("click", async () => {
  try {
    await setDoc(berichtRef, {
      fahrtag: session.fahrtag, standort: session.standort,
      ticketBestand,
      kartenzahlung: toCents(berichtKarte.value),
      gruppenEinnahme: toCents(berichtGruppen.value),
      gutscheinFamilieAnzahl: Math.max(0, parseInt(berichtGutscheinFamilie.value, 10) || 0),
      gutscheinEinzelAnzahl: Math.max(0, parseInt(berichtGutscheinEinzel.value, 10) || 0),
      bemerkung: berichtBemerkung.value.trim(),
      kasse: session.kasse, aktualisiert: serverTimestamp()
    }, { merge: true });
    berichtHinweis.textContent = "Bericht gespeichert.";
    setTimeout(() => { berichtHinweis.textContent = ""; }, 4000);
  } catch (err) {
    berichtHinweis.textContent = "Fehler: " + err.message;
  }
});

// Baut denselben Bericht, den auch die Anzeige/der Text-Export nutzt, als
// reines Datenobjekt für die Übertragung an Google Sheets.
function buildBerichtPayload() {
  const zeilen = aktiveTicketTypes().map((t) => {
    const b = ticketBestand[t.key] || {};
    const verkauft = ticketVerkauft(t.key);
    const preis = preise[t.key] || 0;
    const umsatz = verkauft != null ? verkauft * preis : 0;
    return { label: t.label, anfang: b.anfang ?? null, ende: b.ende ?? null, verkauft, preis, umsatz };
  });
  const gruppenEinnahme = toCents(berichtGruppen.value);
  const gesamteinnahme = zeilen.reduce((s, z) => s + (z.umsatz || 0), 0) + gruppenEinnahme;

  const gutscheinFamilieAnzahl = Math.max(0, parseInt(berichtGutscheinFamilie.value, 10) || 0);
  const gutscheinFamilieBetrag = gutscheinFamilieAnzahl * (preise.rf || 0);
  const gutscheinEinzelAnzahl = Math.max(0, parseInt(berichtGutscheinEinzel.value, 10) || 0);
  const gutscheinEinzelBetrag = gutscheinEinzelAnzahl * (preise.ra || 0);

  const kartenzahlung = toCents(berichtKarte.value);
  const summeAbzug = kartenzahlung + gutscheinFamilieBetrag + gutscheinEinzelBetrag;
  const bargeldEinnahmen = gesamteinnahme - summeAbzug;
  const appUmsatz = verkaufBarSummeCents();
  const differenz = appUmsatz - bargeldEinnahmen;

  return {
    fahrtag: session.fahrtag, standort: session.standort, kasse: session.kasse,
    zeilen, gruppenEinnahme, gesamteinnahme,
    kartenzahlung,
    gutscheinFamilie: { anzahl: gutscheinFamilieAnzahl, betrag: gutscheinFamilieBetrag },
    gutscheinEinzel: { anzahl: gutscheinEinzelAnzahl, betrag: gutscheinEinzelBetrag },
    summeAbzug, bargeldEinnahmen, appUmsatz, differenz,
    bemerkung: berichtBemerkung.value.trim()
  };
}

berichtSheetsBtn.addEventListener("click", async () => {
  if (!GOOGLE_SHEETS_WEBHOOK_URL || GOOGLE_SHEETS_WEBHOOK_URL.indexOf("DEINE_") === 0) {
    berichtHinweis.textContent = "Bitte zuerst GOOGLE_SHEETS_WEBHOOK_URL in app.js eintragen (siehe google-apps-script.gs).";
    return;
  }
  berichtSheetsBtn.disabled = true;
  const alterText = berichtSheetsBtn.textContent;
  berichtSheetsBtn.textContent = "Sende…";
  try {
    const payload = buildBerichtPayload();
    const res = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // vermeidet CORS-Preflight bei Apps Script
      body: JSON.stringify(payload)
    });
    let ok = res.ok;
    try { const data = await res.json(); ok = ok && data.ok !== false; } catch (e) { /* Antwort evtl. nicht lesbar, aber ggf. trotzdem angekommen */ }
    berichtHinweis.textContent = ok
      ? "An Google Sheets gesendet."
      : "Google Sheets meldete einen Fehler – bitte im Sheet nachsehen.";
    setTimeout(() => { berichtHinweis.textContent = ""; }, 4000);
  } catch (err) {
    berichtHinweis.textContent = "Senden an Google Sheets fehlgeschlagen: " + err.message;
  } finally {
    berichtSheetsBtn.disabled = false;
    berichtSheetsBtn.textContent = alterText;
  }
});

berichtCsv.addEventListener("click", async () => {
  const zeilen = [`Verkaufsbericht ${formatDateDE(session.fahrtag)} – ${STANDORT_LABEL[session.standort] || session.standort}`];
  aktiveTicketTypes().forEach((t) => {
    const b = ticketBestand[t.key] || {};
    const verkauft = ticketVerkauft(t.key);
    zeilen.push(`${t.label}: ${b.anfang != null ? b.anfang : "–"} → ${b.ende != null ? b.ende : "–"} = ${verkauft != null ? verkauft : "–"} Stück`);
  });
  zeilen.push(`Gruppen in ${STANDORT_LABEL[session.standort] || session.standort}: ${berichtGruppen.value || "0,00"} €`);
  zeilen.push(`Gesamteinnahme: ${berichtGesamt.textContent}`);
  zeilen.push(`Kartenzahlung: ${euro(toCents(berichtKarte.value))}`);
  zeilen.push(`Familien-Gutscheine: ${berichtGutscheinFamilie.value || "0"} Stück (${berichtGutscheinFamilieBetrag.textContent})`);
  zeilen.push(`Einzelperson-Gutscheine: ${berichtGutscheinEinzel.value || "0"} Stück (${berichtGutscheinEinzelBetrag.textContent})`);
  zeilen.push(`Bargeldeinnahmen (erwartet): ${berichtBargeld.textContent}`);
  zeilen.push(`Bar verkauft laut Kassenapp: ${berichtAppUmsatz.textContent}`);
  zeilen.push(`Differenz (negativ = Geld fehlt): ${berichtDiff.textContent}`);
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
// Numpad (Gegeben / Ein-Auszahlung)
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
logoutBtn.addEventListener("click", () => {
  [unsubKassenbuch, unsubBuchungen, unsubFahrt, unsubBericht, unsubPreise, unsubVerkaeufe, unsubGutscheine].forEach((u) => u && u());
  logout();
});

window.addEventListener("online", () => setConnStatus(fahrtRef ? "online" : "connecting"));
window.addEventListener("offline", () => setConnStatus("offline"));

// ---------------------------------------------------------
// Ansicht: Kompakt (Handy) / Ausführlich (PC, Tablet)
// ---------------------------------------------------------
const VIEW_LS_KEY = "kb_kasse_kompakt";
function applyViewMode(compact) {
  document.body.classList.toggle("compact", compact);
  viewToggle.setAttribute("aria-pressed", compact ? "true" : "false");
}
function initViewToggle() {
  let compact = localStorage.getItem(VIEW_LS_KEY) === "1";
  applyViewMode(compact);
  viewToggle.addEventListener("click", () => {
    compact = !compact;
    localStorage.setItem(VIEW_LS_KEY, compact ? "1" : "0");
    applyViewMode(compact);
  });
}

// ---------------------------------------------------------
// Start
// ---------------------------------------------------------
initSetupScreen();
initViewToggle();
