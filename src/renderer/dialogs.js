import { addPanel } from './panels.js';
import { toast }    from './utils.js';

/* ══════════════════════════════════════════════════════════════════════════
   Custom-Dialog – eigene Bildschirmgröße
   ══════════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════════
   Keys-Dialog – Google-API-Zugangsdaten
   ══════════════════════════════════════════════════════════════════════════ */
const keysDlg = document.getElementById('keys-dlg');
const kApi    = document.getElementById('k-api');
const kCid    = document.getElementById('k-cid');
const kSec    = document.getElementById('k-sec');

async function openKeysDlg() {
  try {
    const saved = await window.ss.keysLoad();
    kApi.value = saved.apiKey       ?? '';
    kCid.value = saved.clientId     ?? '';
    kSec.value = saved.clientSecret ?? '';
  } catch { /* Felder leer lassen */ }
  keysDlg.classList.remove('hidden');
  kApi.focus();
}

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
    apiKey:       kApi.value.trim(),
    clientId:     kCid.value.trim(),
    clientSecret: kSec.value.trim(),
  };
  await window.ss.keysSave(keys);
  closeKeysDlg();
  toast('Gespeichert – App neu starten, damit die Änderungen wirksam werden', 'success', 4000);
});
