// flags-audit.js — auditoría y limpieza segura de banderas
// Importa utilidades desde flagsEditor.js

import { getFlagNamesForSignature, bitmaskToArray, flagsToArray } from './flagsEditor.js';

const $ = s => document.querySelector(s);
const MODAL_ID = 'flagAuditModal';

function ensureReady() {
  if (typeof window === 'undefined' || !window.dat || !window.spr) {
    alert('Carga primero .dat y .spr antes de auditar flags.');
    return false;
  }
  if (typeof getFlagNamesForSignature !== 'function' || typeof bitmaskToArray !== 'function') {
    alert('flagsEditor no está disponible o no exporta las funciones necesarias.');
    return false;
  }
  return true;
}

function knownCodesSet(signature) {
  const sig = (signature != null ? signature : (window.dat && window.dat.signature)) || 0;
  const map = getFlagNamesForSignature(sig) || {};
  const S = new Set();
  for (const k of Object.keys(map)) {
    const n = Number(k);
    if (Number.isFinite(n)) S.add(n);
  }
  return S;
}

function toArrayFlags(flags) {
  return flagsToArray(flags);
}

function iterThingsByCat(datObj, cat) {
  const list = datObj[`${cat}s`] || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t) continue;
    t.category = cat;
    yieldIf(t);
  }
  function* gen() { for (const it of list) if (it) yield it; }
  return gen();
}

// scanUnknown: returns { perThing: [{category,id,unknown:[codes]}], histogram: Map(code->count) }
function scanUnknown(datObj) {
  const sig = datObj?.signature >>> 0;
  const known = knownCodesSet(sig);
  const perThing = [];
  const hist = new Map();
  const cats = ['items','outfits','effects','missiles'];
  for (const cat of cats) {
    const arr = datObj[cat] || [];
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (!t) continue;
      const codes = toArrayFlags(t.flags);
      const unknown = codes.filter(c => !known.has(Number(c)));
      if (unknown && unknown.length) {
        perThing.push({ category: cat.replace(/s$/,''), id: t.id|0, unknown });
        for (const u of unknown) hist.set(u, (hist.get(u)||0) + 1);
      }
    }
  }
  return { perThing, histogram: hist };
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function exportUnknownTXT() {
  if (!ensureReady()) return;
  const res = scanUnknown(window.dat);
  if (!res.perThing.length) return alert('No se encontraron flags desconocidas.');
  let out = `Flag audit — ${new Date().toISOString()}\n\n`;
  for (const p of res.perThing) {
    out += `${p.category} #${p.id}: ${p.unknown.map(c=>`0x${Number(c).toString(16).toUpperCase()}(${c})`).join(', ')}\n`;
  }
  download('unknown-flags.txt', out);
  alert('Exportado unknown-flags.txt');
}

// cleanUnknownFlags: removes unknown codes in selected categories (array of 'item','outfit',...)
function cleanUnknownFlags(selectedCats = ['item','outfit','effect','missile']) {
  if (!ensureReady()) return;
  const datObj = window.dat;
  const sig = datObj.signature >>> 0;
  const known = knownCodesSet(sig);
  let modified = 0, touchedThings = 0;
  for (const cat of selectedCats) {
    const list = datObj[`${cat}s`] || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      const arr = toArrayFlags(t.flags);
      const kept = arr.filter(c => known.has(Number(c)));
      if (kept.length !== arr.length) {
        t.flags = kept;
        delete t.__flagBytes; delete t.__flagsRaw; delete t.__hydratedFlags;
        touchedThings++; modified += (arr.length - kept.length);
      }
    }
  }
  alert(`Limpieza completada: ${modified} flags removidas en ${touchedThings} things.`);
  // notify UI refresh
  try { if (typeof window.selectThing === 'function') window.selectThing(window.currentThingId); } catch(_) {}
  try { if (typeof window.showThingList === 'function') window.showThingList(window.currentCategory, 0); } catch(_) {}
}

// clearAllFlags: remove all flags for selected categories
function clearAllFlags(selectedCats = ['item','outfit','effect','missile']) {
  if (!ensureReady()) return;
  let touched = 0;
  for (const cat of selectedCats) {
    const list = window.dat[`${cat}s`] || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      if (t.flags && (Array.isArray(t.flags) ? t.flags.length > 0 : (t.flags && Object.keys(t.flags).length))) {
        t.flags = [];
        delete t.__flagBytes; delete t.__flagsRaw; delete t.__hydratedFlags;
        touched++;
      }
    }
  }
  alert(`Se limpiaron flags en ${touched} things.`);
  try { if (typeof window.selectThing === 'function') window.selectThing(window.currentThingId); } catch(_) {}
  try { if (typeof window.showThingList === 'function') window.showThingList(window.currentCategory, 0); } catch(_) {}
}

// Minimal modal renderer for audit results
function renderAuditModal() {
  if (!ensureReady()) return;
  // Remove existing modal
  const old = document.getElementById(MODAL_ID); if (old) old.remove();
  const root = document.createElement('div'); root.id = MODAL_ID; root.className = 'modal';
  root.innerHTML = `
    <div class="modal-content">
      <h2>Flag Audit</h2>
      <div id="auditBody" style="max-height:50vh;overflow:auto;padding:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button id="auditExportTxt">📄 Exportar TXT</button>
        <button id="auditRemoveUnknown">🧹 Limpiar Unknown</button>
        <button id="auditClearAll">🧼 Limpiar Todas</button>
        <button id="auditClose">❌ Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const { perThing, histogram } = scanUnknown(window.dat);
  const body = root.querySelector('#auditBody');
  if (!perThing.length) {
    body.innerHTML = `<div>No se encontraron flags desconocidas para esta firma.</div>`;
  } else {
    const h = document.createElement('div');
    h.style.marginBottom = '8px';
    h.innerHTML = `<b>${perThing.length}</b> things con flags desconocidas.<br><b>Histogram:</b> ${Array.from(histogram.entries()).map(([k,v])=>`0x${k.toString(16).toUpperCase()}(${k}):${v}`).join(', ')}`;
    body.appendChild(h);
    const list = document.createElement('ul');
    for (const p of perThing.slice(0,500)) {
      const li = document.createElement('li');
      li.textContent = `${p.category} #${p.id}: ${p.unknown.map(c=>`0x${Number(c).toString(16).toUpperCase()}(${c})`).join(', ')}`;
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  root.querySelector('#auditExportTxt').addEventListener('click', ()=>exportUnknownTXT());
  root.querySelector('#auditRemoveUnknown').addEventListener('click', ()=>{
    if (!confirm('Eliminar solo las flags desconocidas en todas las categorías?')) return;
    cleanUnknownFlags(['item','outfit','effect','missile']);
    root.remove();
  });
  root.querySelector('#auditClearAll').addEventListener('click', ()=>{
    if (!confirm('Eliminar TODAS las flags en todas las categorías?')) return;
    clearAllFlags(['item','outfit','effect','missile']);
    root.remove();
  });
  root.querySelector('#auditClose').addEventListener('click', ()=>root.remove());
}

// API global
function openFlagAudit() {
  renderAuditModal();
}
window.openFlagAudit = openFlagAudit;

// Export nothing (module side-effects), but allow direct import if needed
export { openFlagAudit, scanUnknown, cleanUnknownFlags, exportUnknownTXT };
