import { addPanel } from './panels.js';
import { toast }    from './utils.js';

const customDlg = document.getElementById('custom-dlg');
const dlgW      = document.getElementById('f-w');
const dlgH      = document.getElementById('f-h');
const dlgName   = document.getElementById('f-n');

function openCustomDlg() {
  dlgW.value = '1280'; dlgH.value = '720'; dlgName.value = 'Eigene Ansicht';
  customDlg.classList.remove('hidden');
  dlgW.focus();
}

function closeCustomDlg() {
  customDlg.classList.add('hidden');
}

document.getElementById('custom-btn').addEventListener('click',  openCustomDlg);
document.getElementById('dlg-close').addEventListener('click',   closeCustomDlg);
document.getElementById('dlg-cancel').addEventListener('click',  closeCustomDlg);
customDlg.addEventListener('click',   e => { if (e.target === customDlg) closeCustomDlg(); });
customDlg.addEventListener('keydown', e => {
  if (e.key === 'Enter')  document.getElementById('dlg-add').click();
  if (e.key === 'Escape') closeCustomDlg();
});

document.getElementById('dlg-add').addEventListener('click', () => {
  const w    = Math.max(100, parseInt(dlgW.value)   || 1280);
  const h    = Math.max(100, parseInt(dlgH.value)   || 720);
  const name = (dlgName.value.trim() || 'Custom').slice(0, 24);
  const def  = { id: 'custom-' + Date.now(), label: name, w, h };
  closeCustomDlg();
  addPanel(def);
  // Persistenz + Chip-Bar via app.js (kein direkter Import nötig)
  window.dispatchEvent(new CustomEvent('ss:custom-device-added', { detail: def }));
});

for (const btn of document.querySelectorAll('.preset')) {
  btn.addEventListener('click', () => { dlgW.value = btn.dataset.w; dlgH.value = btn.dataset.h; });
}

const keysDlg  = document.getElementById('keys-dlg');
const kApi     = document.getElementById('k-api');
const kAppId   = document.getElementById('k-app-id');
const kProject = document.getElementById('k-project');
const kSender  = document.getElementById('k-sender');

async function openKeysDlg() {
  try {
    const saved = await window.ss.keysLoad();
    kApi.value     = saved.apiKey            ?? '';
    kAppId.value   = saved.appId             ?? '';
    kProject.value = saved.projectId         ?? '';
    kSender.value  = saved.messagingSenderId ?? '';
  } catch { /* Felder leer lassen */ }
  // Diagnose-Panel leeren und verstecken
  const diagWrap = document.getElementById('keys-diag-wrap');
  const diagOut  = document.getElementById('keys-diag-out');
  if (diagOut)  diagOut.textContent = '';
  if (diagWrap) diagWrap.classList.add('hidden');
  keysDlg.classList.remove('hidden');
  kApi.focus();
}

export { openKeysDlg };

function closeKeysDlg() {
  keysDlg.classList.add('hidden');
}

document.getElementById('keys-btn').addEventListener('click',        openKeysDlg);
document.getElementById('keys-dlg-close').addEventListener('click',  closeKeysDlg);
document.getElementById('keys-dlg-cancel').addEventListener('click', closeKeysDlg);
document.getElementById('keys-dlg-help').addEventListener('click', () => {
  document.getElementById('keys-help-section').classList.toggle('hidden');
});
keysDlg.addEventListener('click',   e => { if (e.target === keysDlg) closeKeysDlg(); });
keysDlg.addEventListener('keydown', e => { if (e.key === 'Escape') closeKeysDlg(); });

document.getElementById('keys-dlg-save').addEventListener('click', async () => {
  const keys = {
    apiKey:            kApi.value.trim(),
    appId:             kAppId.value.trim(),
    projectId:         kProject.value.trim(),
    messagingSenderId: kSender.value.trim(),
  };
  await window.ss.keysSave(keys);
  closeKeysDlg();
  toast('Gespeichert – App wird in 2 Sekunden neu gestartet…', 'success', 2500);
  setTimeout(() => window.ss.appRestart(), 2000);
});

// ── Diagnose-Button ───────────────────────────────────────────────────────────
function _showDiag(text) {
  const diagWrap = document.getElementById('keys-diag-wrap');
  const diagOut  = document.getElementById('keys-diag-out');
  diagOut.textContent = text;
  diagWrap.classList.remove('hidden');
}

document.getElementById('keys-diag-btn').addEventListener('click', async () => {
  _showDiag('Lade…');
  try {
    const d = await window.ss.keysDiagnose();
    _showDiag([
      `userData:         ${d.userData}`,
      `Datei:            ${d.keysFile}`,
      `google-api-key:   ${d.hasApiKey ? '✓ gesetzt (' + d.apiKeyPrefix + '…)' : '✗ NICHT gesetzt'}`,
      ``,
      `Session-Pfad:     ${d.sessionStorePath}`,
      `GCM Store:        ${d.gcmStoreExists ? '✓ vorhanden' : '✗ FEHLT – GCM hat noch nie eingecheckt!'}`,
      `GCM Store Pfad:   ${d.gcmStorePath}`,
      ``,
      `FCM erreichbar:   ${d.fcmReachable ? '✓' : '✗'}  ${d.fcmResult}`,
      `GCM Checkin:      ${d.checkinReachable ? '✓' : '✗'}  ${d.checkinResult}`,
      ``,
      `Electron:         ${d.electron}  |  Chrome: ${d.chrome}`,
      `Plattform:        ${d.platform}`,
    ].join('\n'));
  } catch (e) {
    _showDiag('Fehler: ' + e.message);
  }
});

// ── Push-Status zurücksetzen ──────────────────────────────────────────────────
document.getElementById('keys-clear-push-btn').addEventListener('click', async () => {
  _showDiag('Service-Worker werden zurückgesetzt…');
  try {
    await window.ss.sessionClearPush();
    _showDiag('✓ Service-Worker gelöscht – bitte Seite im Webview neu laden,\ndann Push-Subscription erneut versuchen.');
  } catch (e) {
    _showDiag('Fehler: ' + e.message);
  }
});

// ── Kopieren-Button ─────────────────────────────────────────────────────────
document.getElementById('keys-diag-copy').addEventListener('click', async () => {
  const text = document.getElementById('keys-diag-out').textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('keys-diag-copy');
    btn.textContent = '✓ Kopiert';
    setTimeout(() => { btn.textContent = 'Kopieren'; }, 1800);
  } catch { /* clipboard not available */ }
});
