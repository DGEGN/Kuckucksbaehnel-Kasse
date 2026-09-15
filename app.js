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
const kasseInput = el("kasseInput");
const startBtn = el("startBtn");
const setupInfo = el("setupInfo");
const setupError = el("setupError");

const fahrtagLabel = el("fahrtagLabel");
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
const rgGegebenBtn = el("rgGegebenBtn");
const rgSchnellwahl = el("rgSchnellwahl");
const rgResult = el("rgResult");
const rgResultLabel = el("rgResultLabel");
const rgResultValue = el("rgResultValue");
const rgReset = el("rgReset");
const rgVerbuchen = el("rgVerbuchen");
const rgVerbuchenHint = el("rgVerbuchenHint");
const stueckelungList = el("stueckelungList");

// Kartenzahlung (eigenes Gerät)
const karteEingabeBtn = el("karteEingabeBtn");
const karteSchnellwahl = el("karteSchnellwahl");
const karteErfassenBtn = el("karteErfassenBtn");
const karteHinweis = el("karteHinweis");
const karteSumme = el("karteSumme");
const karteList = el("karteList");

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
const berichtGesamt = el("berichtGesamt");
const berichtKarte = el("berichtKarte");
const berichtGutscheinFamilie = el("berichtGutscheinFamilie");
const berichtGutscheinFamilieBetrag = el("berichtGutscheinFamilieBetrag");
const berichtGutscheinEinzel = el("berichtGutscheinEinzel");
const berichtGutscheinEinzelBetrag = el("berichtGutscheinEinzelBetrag");
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

const kapazitaetOverlay = el("kapazitaetOverlay");
const kapazitaetText = el("kapazitaetText");
const kapazitaetAbbrechen = el("kapazitaetAbbrechen");
const kapazitaetTrotzdem = el("kapazitaetTrotzdem");

// ---------------------------------------------------------
// Zustand
// ---------------------------------------------------------
let session = null; // {fahrtag, kasse, rolle}
let selectedFahrtId = null; // echte Dokument-ID in "fahrten" (z. B. "2026-09-01_sonderzug"), aus der Liste gewählt
let selectedRolle = null; // 'kasse' | 'beide' | 'karte'
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
let rgGegebenCents = 0;
let zahlweise = "bar"; // "bar" | "karte" (nur relevant bei Rolle "beide")
let karteEingabeCents = 0; // Betrag im Kartenzahlung-Tab (eigenes Gerät)

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

  rolleGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectRolle(btn.dataset.rolle));
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

function updateStartButtonState() {
  const hasFahrtag = manuellerModus ? !!fahrtagInput.value : !!selectedFahrtId;
  startBtn.disabled = !(hasFahrtag && selectedRolle);
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

  startBtn.disabled = true;
  startBtn.textContent = "Verbinde…";

  try {
    await authReady;
    session = { fahrtag, fahrtId, kasse, rolle: selectedRolle };
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
  kasseLabel.textContent = session.kasse;

  applyRolleZuUI();

  const docId = session.fahrtag; // Kassenbuch/Bericht/Verkäufe: gemeinsam pro Fahrtag, unabhängig vom Zug
  fahrtRef = session.fahrtId ? doc(db, "fahrten", session.fahrtId) : null;
  kassenbuchRef = doc(db, "kassenbuch", docId);
  berichtRef = doc(db, "berichte", docId);

  subscribePreise();
  subscribeFahrt();
  subscribeKassenbuch();
  subscribeBuchungen();
  subscribeBericht();
  subscribeVerkaeufe();
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

  // Zahlweise-Umschalter im Verkauf-Tab nur bei Rolle "beide" anzeigen
  zahlweiseField.classList.toggle("hidden", rolle !== "beide");
  setZahlweise("bar");
}

function leaveApp() {
  [unsubKassenbuch, unsubBuchungen, unsubFahrt, unsubBericht, unsubPreise, unsubVerkaeufe].forEach((u) => u && u());
  appScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  showSetupError(""); showSetupInfo("");
  fahrtagInput.value = session?.fahrtag || todayISO();
  if (session?.fahrtId) { selectedFahrtId = session.fahrtId; renderFahrtList(); updateStartButtonState(); }
  if (session?.rolle) selectRolle(session.rolle);
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
        ea: d.ea || 0, ra: d.ra || 0,
        ek: d.ek || 0, rk: d.rk || 0,
        ef: d.ef || 0, rf: d.rf || 0
      };
    }
    preisEA.value = (preise.ea / 100).toFixed(2).replace(".", ",");
    preisRA.value = (preise.ra / 100).toFixed(2).replace(".", ",");
    preisEK.value = (preise.ek / 100).toFixed(2).replace(".", ",");
    preisRK.value = (preise.rk / 100).toFixed(2).replace(".", ",");
    preisEF.value = (preise.ef / 100).toFixed(2).replace(".", ",");
    preisRF.value = (preise.rf / 100).toFixed(2).replace(".", ",");
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
  try {
    await setDoc(doc(db, "einstellungen", "preise"), { ...neu, aktualisiert: serverTimestamp() }, { merge: true });
    preiseHinweis.textContent = "Preise gespeichert – gelten sofort für alle Kassen.";
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
  return TICKET_TYPES.reduce((sum, t) => sum + (saleQty[t.key] || 0) * (preise[t.key] || 0), 0);
}

function renderSaleList() {
  saleListEl.innerHTML = TICKET_TYPES.map((t) => {
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
  const total = saleTotalCents();
  saleTotalEl.textContent = euro(total);

  if (zahlweise === "karte") {
    karteBetragValue.textContent = euro(total);
    rgVerbuchen.disabled = !(total > 0);
    return;
  }

  rgGegebenBtn.textContent = euro(rgGegebenCents);
  const diff = rgGegebenCents - total;
  rgResultValue.textContent = euro(Math.abs(diff));
  rgResultLabel.textContent = diff < 0 ? "Fehlbetrag – bitte mehr verlangen" : "Rückgeld";
  rgResult.classList.toggle("rg-negativ", diff < 0);
  rgVerbuchen.disabled = !(total > 0 && diff >= 0);
  updateStueckelung();
}

function updateStueckelung() {
  const total = saleTotalCents();
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
  saleQty = {}; rgGegebenCents = 0;
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

rgVerbuchen.addEventListener("click", async () => {
  const total = saleTotalCents();
  const istBar = zahlweise === "bar";
  if (!(total > 0 && (!istBar || rgGegebenCents >= total))) return;
  const posten = TICKET_TYPES.filter((t) => (saleQty[t.key] || 0) > 0).map((t) => ({ ...t, anzahl: saleQty[t.key] }));
  if (!posten.length) return;

  rgVerbuchen.disabled = true;
  try {
    // Fahrgäste, die dieser Verkauf hinzufügen würde (Familienticket = 4 Personen)
    const kategorieSummen = {};
    posten.forEach((p) => { kategorieSummen[p.kategorie] = (kategorieSummen[p.kategorie] || 0) + p.anzahl * (p.personen || 1); });
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

    const grund = "Verkauf: " + posten.map((p) => `${p.anzahl}× ${p.label}`).join(", ");
    await bucheKassenbuch(istBar ? "einzahlung" : "kartenzahlung", total, grund);

    const eintraegeRef = collection(db, "verkaeufe", session.fahrtag, "eintraege");
    for (const p of posten) {
      await addDoc(eintraegeRef, {
        ticket: p.key, anzahl: p.anzahl, einzelpreis: preise[p.key] || 0,
        summe: p.anzahl * (preise[p.key] || 0), kasse: session.kasse, zeit: serverTimestamp()
      });
    }

    const rueckgeld = istBar ? Math.max(0, rgGegebenCents - total) : 0;
    if (fahrtSnap && fahrtSnap.exists()) {
      const updates = {};
      Object.entries(kategorieSummen).forEach(([kat, anz]) => { updates[kat] = increment(anz); });
      await updateDoc(fahrtRef, updates);
      for (const [kat, anz] of Object.entries(kategorieSummen)) {
        await addDoc(collection(fahrtRef, "ereignisse"), { kategorie: kat, anzahl: anz, kasse: session.kasse, zeit: serverTimestamp() });
      }
      rgVerbuchenHint.textContent = istBar
        ? `${euro(total)} erhalten, ${euro(rueckgeld)} Rückgeld. Fahrgäste wurden automatisch gezählt.`
        : `${euro(total)} per Karte gebucht. Fahrgäste wurden automatisch gezählt.`;
    } else {
      rgVerbuchenHint.textContent = `${euro(total)} ${istBar ? "erhalten, " + euro(rueckgeld) + " Rückgeld" : "per Karte gebucht"}. Achtung: Für diesen Fahrtag läuft noch keine Zählung in der Fahrgastzählapp – Fahrgastzahlen wurden nicht aktualisiert.`;
    }

    saleQty = {}; rgGegebenCents = 0;
    renderSaleList();
    updateRgDisplay();
  } catch (err) {
    rgVerbuchenHint.textContent = "Fehler: " + err.message;
  } finally {
    rgVerbuchen.disabled = false;
  }
});

// ===========================================================
// KARTENZAHLUNG (eigenes Gerät)
// ===========================================================
karteEingabeBtn.addEventListener("click", () => {
  openNumpad("karteEingabe", "Kartenbetrag eingeben", karteEingabeCents);
});
karteSchnellwahl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  karteEingabeCents = Math.round(parseFloat(chip.dataset.val) * 100);
  karteEingabeBtn.textContent = euro(karteEingabeCents);
});
karteErfassenBtn.addEventListener("click", async () => {
  if (karteEingabeCents <= 0) { karteHinweis.textContent = "Bitte einen Betrag größer 0 eingeben."; return; }
  karteErfassenBtn.disabled = true;
  try {
    await bucheKassenbuch("kartenzahlung", karteEingabeCents, "Kartenzahlung");
    karteHinweis.textContent = `${euro(karteEingabeCents)} erfasst.`;
    setTimeout(() => { karteHinweis.textContent = ""; }, 3000);
    karteEingabeCents = 0;
    karteEingabeBtn.textContent = euro(0);
  } catch (err) {
    karteHinweis.textContent = "Fehler: " + err.message;
  } finally {
    karteErfassenBtn.disabled = false;
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
    renderKarteTab();
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
  const kartenSumme = buchungenListe.filter(b => b.typ === "kartenzahlung").reduce((s, b) => s + (b.betrag || 0), 0);
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
    return `<li>
      <span>${escapeHtml(b.kasse || "Kasse")} · ${escapeHtml(b.grund || bezeichnung)}</span>
      <span class="${cls}">${sign} ${euro(b.betrag || 0)}${b.typ === "kartenzahlung" ? " (Karte)" : ""}</span>
      <span class="activity-time">${formatTimeDE(b.zeit)}</span>
    </li>`;
  }).join("");
}

function renderKarteTab() {
  if (!karteList) return; // Tab evtl. nicht im DOM relevant, defensiv
  const karteBuchungen = buchungenListe.filter((b) => b.typ === "kartenzahlung");
  const summe = karteBuchungen.reduce((s, b) => s + (b.betrag || 0), 0);
  karteSumme.textContent = euro(summe);
  if (!karteBuchungen.length) {
    karteList.innerHTML = '<li class="activity-empty">Noch keine Kartenzahlungen heute.</li>';
    return;
  }
  karteList.innerHTML = karteBuchungen.map((b) => `<li>
    <span>${escapeHtml(b.kasse || "Kasse")} · ${escapeHtml(b.grund || "Kartenzahlung")}</span>
    <span class="activity-delta-karte">${euro(b.betrag || 0)}</span>
    <span class="activity-time">${formatTimeDE(b.zeit)}</span>
  </li>`).join("");
}

async function bucheKassenbuch(typ, betragCents, grund) {
  const snap = await getDoc(kassenbuchRef);
  if (!snap.exists()) {
    await setDoc(kassenbuchRef, {
      fahrtag: session.fahrtag,
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
      fahrtag: session.fahrtag,
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
      fahrtag: session.fahrtag,
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
// ticketBestand/Karte/Gutscheine/Bemerkung werden direkt in Firestore
// gespeichert (gemeinsam pro Fahrtag, für alle Kassen sichtbar).
function subscribeBericht() {
  unsubBericht = onSnapshot(berichtRef, (snap) => {
    const d = snap.exists() ? snap.data() : {};
    ticketBestand = d.ticketBestand || {};
    TICKET_TYPES.forEach((t) => { if (!ticketBestand[t.key]) ticketBestand[t.key] = {}; });

    berichtKarte.value = d.kartenzahlung != null ? (d.kartenzahlung / 100).toFixed(2).replace(".", ",") : "";
    berichtGruppen.value = d.gruppenEinnahme != null ? (d.gruppenEinnahme / 100).toFixed(2).replace(".", ",") : "";
    berichtGutscheinFamilie.value = d.gutscheinFamilieAnzahl != null ? d.gutscheinFamilieAnzahl : "";
    berichtGutscheinEinzel.value = d.gutscheinEinzelAnzahl != null ? d.gutscheinEinzelAnzahl : "";
    if (d.bemerkung) berichtBemerkung.value = d.bemerkung;

    renderBericht();
  }, (err) => showToast("Fehler beim Laden des Berichts: " + err.message));
}

function subscribeVerkaeufe() {
  const ref = collection(db, "verkaeufe", session.fahrtag, "eintraege");
  unsubVerkaeufe = onSnapshot(ref, (snap) => {
    const sums = {};
    TICKET_TYPES.forEach((t) => { sums[t.key] = { anzahl: 0, umsatz: 0 }; });
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

// Anzahl verkaufter Tickets einer Art = Endstand − Anfangsbestand der fortlaufenden
// Fahrkartennummern. null, wenn einer der beiden Werte fehlt oder der Endstand
// kleiner als der Anfangsbestand ist (z. B. weil noch nicht eingetragen).
function ticketVerkauft(key) {
  const b = ticketBestand[key] || {};
  if (b.anfang == null || b.ende == null) return null;
  const diff = b.ende - b.anfang;
  return diff >= 0 ? diff : null;
}

function renderBericht() {
  let gesamteinnahme = 0;
  berichtBody.innerHTML = TICKET_TYPES.map((t) => {
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

  const gutscheinFamilieAnzahl = Math.max(0, parseInt(berichtGutscheinFamilie.value, 10) || 0);
  const gutscheinFamilieBetrag = gutscheinFamilieAnzahl * (preise.rf || 0);
  const gutscheinEinzelAnzahl = Math.max(0, parseInt(berichtGutscheinEinzel.value, 10) || 0);
  const gutscheinEinzelBetrag = gutscheinEinzelAnzahl * (preise.ra || 0);
  berichtGutscheinFamilieBetrag.textContent = euro(gutscheinFamilieBetrag);
  berichtGutscheinEinzelBetrag.textContent = euro(gutscheinEinzelBetrag);

  const abzug = toCents(berichtKarte.value) + gutscheinFamilieBetrag + gutscheinEinzelBetrag;
  berichtSummeAbzug.textContent = euro(abzug);
  const bargeld = gesamteinnahme - abzug;
  berichtBargeld.textContent = euro(bargeld);

  const appUmsatz = TICKET_TYPES.reduce((sum, t) => sum + (verkaeufeSums[t.key] ? verkaeufeSums[t.key].umsatz : 0), 0);
  berichtAppUmsatz.textContent = euro(appUmsatz);
  updateBerichtDiff(bargeld, appUmsatz);

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

function updateBerichtDiff(bargeldCents, appUmsatzCents) {
  const diff = bargeldCents - appUmsatzCents;
  berichtDiff.textContent = (diff >= 0 ? "+" : "") + euro(diff);
  berichtDiffRow.classList.toggle("diff-ok", diff === 0);
  berichtDiffRow.classList.toggle("diff-bad", diff !== 0);
}

[berichtKarte, berichtGruppen, berichtGutscheinFamilie, berichtGutscheinEinzel].forEach((input) => {
  input.addEventListener("input", renderBericht);
});

berichtSpeichern.addEventListener("click", async () => {
  try {
    await setDoc(berichtRef, {
      fahrtag: session.fahrtag,
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
  const zeilen = TICKET_TYPES.map((t) => {
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
  const appUmsatz = TICKET_TYPES.reduce((sum, t) => sum + (verkaeufeSums[t.key] ? verkaeufeSums[t.key].umsatz : 0), 0);
  const differenz = bargeldEinnahmen - appUmsatz;

  return {
    fahrtag: session.fahrtag, kasse: session.kasse,
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
  const zeilen = [`Verkaufsbericht ${formatDateDE(session.fahrtag)}`];
  TICKET_TYPES.forEach((t) => {
    const b = ticketBestand[t.key] || {};
    const verkauft = ticketVerkauft(t.key);
    zeilen.push(`${t.label}: ${b.anfang != null ? b.anfang : "–"} → ${b.ende != null ? b.ende : "–"} = ${verkauft != null ? verkauft : "–"} Stück`);
  });
  zeilen.push(`Gruppen in Neustadt: ${berichtGruppen.value || "0,00"} €`);
  zeilen.push(`Gesamteinnahme: ${berichtGesamt.textContent}`);
  zeilen.push(`Kartenzahlung: ${berichtKarte.value || "0,00"} €`);
  zeilen.push(`Familien-Gutscheine: ${berichtGutscheinFamilie.value || "0"} Stück (${berichtGutscheinFamilieBetrag.textContent})`);
  zeilen.push(`Einzelperson-Gutscheine: ${berichtGutscheinEinzel.value || "0"} Stück (${berichtGutscheinEinzelBetrag.textContent})`);
  zeilen.push(`Bargeldeinnahmen (erwartet): ${berichtBargeld.textContent}`);
  zeilen.push(`Verkauft laut Kassenapp: ${berichtAppUmsatz.textContent}`);
  zeilen.push(`Differenz: ${berichtDiff.textContent}`);
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
  if (mode === "karteEingabe") { karteEingabeCents = cents; karteEingabeBtn.textContent = euro(karteEingabeCents); return; }

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
  [unsubKassenbuch, unsubBuchungen, unsubFahrt, unsubBericht, unsubPreise, unsubVerkaeufe].forEach((u) => u && u());
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
