// ===== flagsEditor.js =====
window.__HONEY_FLAG_LABELS__ = window.__HONEY_FLAG_LABELS__ || {};

// --- Nombres por opcode (firma v6 ≈ 10.9x) ---
export const FLAG_NAMES_V6 = {
  0x00: 'Es Piso',
  0x01: 'Borde de Piso',
  0x02: 'Abajo',
  0x03: 'Arriba',
  0x04: 'Contenedor',
  0x05: 'Apilable',
  0x06: 'Forzar Uso',
  0x07: 'Multi Uso',
  0x08: 'Escribible',
  0x09: 'Escribible Una Vez',
  0x10: 'Animacion Sin Movimiento',
  0x0A: 'Contenedor de Fluido',
  0x0B: 'Fluido',
  0x0C: 'Intransitable',
  0x0D: 'Inamovible',
  0x0E: 'Bloquea Misiles',
  0x0F: 'Bloquea Pathfinder',
  0x13: 'Gancho Vertical',
  0x11: 'Recogible',
  0x12: 'Colgable',
  0x14: 'Gancho Horizontal',
  0x1a: 'Rotable',
  0x15: 'Tiene Elevacion',
  0x16: 'Tiene Luz',
  0x17: 'Siempre Visible',
  0x18: 'Translúcido',
  0x19: 'Desplazamiento',
  0x1B: 'Objeto en Reposo',
  0x1C: 'Animación Siempre',
  0x1D: 'Automapa',
  0x1E: 'Lente de Ayuda',
  0x1F: 'Piso Completo',
  0x20: 'Ignorar Vista',
  0x21: 'Equipo',
  0x22: 'Mercado',
  0x23: 'Tipo Acción por Defecto',
  0x24: 'Wrappable',
  0x25: 'Unwrappable',
  0x26: 'Top Effect',
  0xfe: 'Usable',
  0x28: 'Sprite Id',
  0x29: 'Tiene Cargas',
  0x2A: 'Cambio de Piso',
  0x2C: 'Es Animación'
};

// Para 7.x / 8.x / 9.x reutilizamos el mismo set de nombres, ya que los opcodes
// básicos son equivalentes. Si más adelante quieres afinar por versión, se
// puede ajustar cada mapa por separado.
export const FLAG_NAMES_V3 = FLAG_NAMES_V6; // 7.60 / 7.72 (MetadataFlags3)
export const FLAG_NAMES_V4 = FLAG_NAMES_V6; // 8.0–8.54  (MetadataFlags4)
export const FLAG_NAMES_V5 = FLAG_NAMES_V6; // 8.6–9.x   (MetadataFlags5)

// Mapa activo actual (UI usa este por defecto)
export let FLAG_NAMES = FLAG_NAMES_V6; // compat global/module

export function getFlagNamesForSignature(signature = 0) {
  const sig = (Number(signature) >>> 0) || 0;
  let names = FLAG_NAMES_V6;

  switch (sig) {
    // 7.x clásico (7.60 / 7.72 / 7.6x)
    case 0x439D5A33: // 7.60
    case 0x439D7A33: // 7.72
    case 0x43986FBE: // 7.6x
      names = FLAG_NAMES_V3;
      break;

    // 8.0–8.54
    case 0x46F76E05: // 8.0
    case 0x4E4F1862: // 8.54
      names = FLAG_NAMES_V4;
      break;

    // 8.60–9.x
    case 0x4E3F1061: // 8.60
    case 0x56E61057: // 9.1
    case 0x56FF7057: // 9.31
      names = FLAG_NAMES_V5;
      break;

    // 10.x+ por defecto
    default:
      names = FLAG_NAMES_V6;
      break;
  }

  // Actualiza el mapa global para la UI
  FLAG_NAMES = names;
  return names;
}

// Añadir utilidades para compatibilidad con editor.js (exportadas)
export function bitmaskToArray(mask) {
  mask = Number(mask) >>> 0;
  const out = [];
  for (let i = 0; i < 32; i++) {
    if (mask & (1 << i)) out.push(i);
  }
  return out;
}

export function arrayToBitmask(arr) {
  if (!Array.isArray(arr)) {
    const n = Number(arr);
    return Number.isFinite(n) ? (n >>> 0) : 0;
  }
  let m = 0 >>> 0;
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n < 32) m = (m | (1 << (n|0))) >>> 0;
  }
  return m >>> 0;
}

/*
  flagsToArray: normaliza distintos formatos (array numeric, number bitmask,
  hex-string "0x...", comma-separated list) a un array de códigos numéricos.
*/
export function flagsToArray(flags) {
  if (flags == null) return [];
  if (Array.isArray(flags)) return flags.map(x => Number(x)|0).filter(n => Number.isFinite(n));
  if (typeof flags === 'number') return bitmaskToArray(flags);
  if (typeof flags === 'string') {
    const s = flags.trim();
    // hex-mask "0x..."
    if (/^0x[0-9a-f]+$/i.test(s)) {
      return bitmaskToArray(parseInt(s, 16));
    }
    // comma/space separated tokens
    const toks = s.split(/[\s,;]+/).filter(Boolean);
    const out = [];
    for (const t of toks) {
      if (/^0x[0-9a-f]+$/i.test(t)) {
        out.push(...bitmaskToArray(parseInt(t, 16)));
      } else if (/^\d+$/.test(t)) {
        out.push(Number(t)|0);
      } else {
        // ignore names here (module doesn't have full name->code mapping at this point)
      }
    }
    return Array.from(new Set(out)).filter(n => Number.isFinite(n));
  }
  if (typeof flags === 'object') {
    // object with numeric keys or boolean values { "8": true } or { writable: true } (best-effort)
    const out = [];
    for (const k of Object.keys(flags)) {
      if (/^\d+$/.test(k) && flags[k]) out.push(Number(k)|0);
    }
    return Array.from(new Set(out)).filter(n => Number.isFinite(n));
  }
  return [];
}

// ---------- decoder de bytes de atributos ----------
const u8  = (b,i)=>[b[i]&0xFF, i+1];
const u16 = (b,i)=>{const lo=b[i],hi=b[i+1];return[(lo|(hi<<8))&0xFFFF,i+2];};
const str = (b,i)=>{let n,i2;[n,i2]=u16(b,i);const s=new TextDecoder().decode(new Uint8Array(b.slice(i2,i2+n)));return[s,i2+n];};

export function formatFlags(thing, signature=0) {
  const bytes = thing?.__flagBytes || [];
  const present = [];
  // Mantener ambas formas: plano (compat) y anidado (editor.js)
  const f = {
    codes: present,
    // flags planos (compat)
    isFloor:false, hasLight:false, hasAutomap:false, hasOffset:false, hasElevation:false,
    writable:false, writableOnce:false, isMarketItem:false, hasAction:false, hasHelpLens:false, hasEquipment:false,
    groundSpeed:0, lightLevel:0, lightColor:0, automapColor:0,
    displacementX:0, displacementY:0, elevation:0, maxTextLen:0,
    slot:0,
    marketName:'', marketCategory:0, marketTradeAs:0, marketShowAs:0, marketRestrictProfession:0, marketRestrictLevel:0,
    helpLensType:0, actionType:0, spriteId:0, hasCharges:false, floorChange:0,
    // estructura anidada (para editor.js)
    ground: null,
    light: null,
    automap: null,
    offset: null,
    elevationObj: null,
    writableObj: null,
    equipment: null,
    market: null,
    helpLens: null,
    action: null
  };

  let i=0;
  while(i<bytes.length){
    let op = bytes[i++]; if(op===0xFF) break;
    present.push(op);
    switch(op){
      case 0x00:{
        f.isFloor = true;
        let v; [v,i] = u16(bytes,i); f.groundSpeed = v;
        // estructura anidada
        f.ground = { speed: v };
        break;
      }
      case 0x08:{
        f.writable = true;
        let v; [v,i] = u16(bytes,i); f.maxTextLen = v;
        f.writableObj = { multi: true, once: !!f.writableOnce, maxLen: v };
        break;
      }
      case 0x09:{
        f.writableOnce = true;
        let v; [v,i] = u16(bytes,i); f.maxTextLen = v;
        f.writableObj = { multi: !!f.writable, once: true, maxLen: v };
        break;
      }
      case 0x16:{
        f.hasLight = true;
        let v; [v,i] = u16(bytes,i); f.lightLevel = v;
        [v,i] = u16(bytes,i); f.lightColor = v;
        f.light = { intensity: f.lightLevel, color: f.lightColor };
        break;
      }
      case 0x19:{
        f.hasOffset = true;
        let v; [v,i] = u8(bytes,i); f.displacementX = v;
        [v,i] = u8(bytes,i); f.displacementY = v;
        f.offset = { x: f.displacementX, y: f.displacementY };
        break;
      }
      case 0x15:{
        f.hasElevation = true;
        let v; [v,i] = u16(bytes,i); f.elevation = v;
        f.elevationObj = { value: f.elevation };
        break;
      }
      case 0x1D:{
        f.hasAutomap = true;
        let v; [v,i] = u16(bytes,i); f.automapColor = v;
        f.automap = { color: f.automapColor };
        break;
      }
      case 0x1E:{
        f.hasHelpLens = true;
        let v; [v,i] = u16(bytes,i); f.helpLensType = v;
        f.helpLens = { type: f.helpLensType };
        break;
      }
      case 0x21:{
        f.hasEquipment = true;
        let v; [v,i] = u16(bytes,i); f.slot = v;
        f.equipment = { slot: f.slot };
        break;
      }
      case 0x22:{ // MARKET_ITEM: cat, tradeAs, showAs, name, voc, lvl
        f.isMarketItem = true;
        let v,s;
        [v,i]=u16(bytes,i); f.marketCategory=v;
        [v,i]=u16(bytes,i); f.marketTradeAs=v;
        [v,i]=u16(bytes,i); f.marketShowAs=v;
        [s,i]=str(bytes,i); f.marketName=s;
        [v,i]=u16(bytes,i); f.marketRestrictProfession=v;
        [v,i]=u16(bytes,i); f.marketRestrictLevel=v;

        f.market = {
          name: f.marketName || '',
          category: f.marketCategory|0,
          tradeAs: f.marketTradeAs|0,
          showAs: f.marketShowAs|0,
          vocation: f.marketRestrictProfession|0,
          level: f.marketRestrictLevel|0
        };
        break;
      }
      case 0x23:{
        f.hasAction = true;
        let v; [v,i] = u8(bytes,i); f.actionType = v;
        f.action = { type: f.actionType };
        break;
      }
      case 0x28:{
        let v; [v,i] = u16(bytes,i); f.spriteId = v;
        break;
      }
      case 0x29:{
        f.hasCharges = true;
        break;
      }
      case 0x2A:{
        let v; [v,i] = u8(bytes,i); f.floorChange = v;
        break;
      }
      default:{
        // Opcodes sin payload conocidos:
        const noData = new Set([0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,0x10,0x13,0x11,0x12,0x14,0x1a,0x17,0x18,0x1B,0x1C,0x1F,0x20,0x24,0x25,0x26,0x27,0x2C]);
        if(!noData.has(op)) { try{ let n; [n,i]=u16(bytes,i); i+=n; }catch(e){} }
      }
    }
  }

  // Asegurar que los objetos anidados existen aunque la flag esté presente sin payload
  if (f.isFloor && !f.ground) f.ground = { speed: f.groundSpeed|0 };
  if (f.hasLight && !f.light) f.light = { intensity: f.lightLevel|0, color: f.lightColor|0 };
  if (f.hasAutomap && !f.automap) f.automap = { color: f.automapColor|0 };
  if (f.hasOffset && !f.offset) f.offset = { x: f.displacementX|0, y: f.displacementY|0 };
  if (f.hasElevation && !f.elevationObj) f.elevationObj = { value: f.elevation|0 };
  if ((f.writable || f.writableOnce) && !f.writableObj) f.writableObj = { multi: !!f.writable, once: !!f.writableOnce, maxLen: f.maxTextLen|0 };
  if (f.hasEquipment && !f.equipment) f.equipment = { slot: f.slot|0 };
  if (f.isMarketItem && !f.market) f.market = { name: f.marketName||'', category: f.marketCategory|0, tradeAs: f.marketTradeAs|0, showAs: f.marketShowAs|0, vocation: f.marketRestrictProfession|0, level: f.marketRestrictLevel|0 };
  if (f.hasHelpLens && !f.helpLens) f.helpLens = { type: f.helpLensType|0 };
  if (f.hasAction && !f.action) f.action = { type: f.actionType|0 };

  return f;
}

// ---------- encoder best-effort (si no hay bytes, deja sólo 0xFF) ----------
export function encodeFlags(thing, signature=0){
  // If exporting with sanitization, ignore raw bytes
  const useRaw = !(typeof window !== 'undefined' && window.__EXPORT_USE_RAW_BYTES === false);
  const raw = thing?.__flagBytes || thing?.__flagsRaw;
  if (useRaw && raw && Array.isArray(raw) && raw.length) return raw.slice();

  const out=[]; const present=new Set();
  const w8=v=>{ out.push(v&0xFF); present.add(v&0xFF); };
  const w16=v=>{ out.push(v&0xFF,(v>>8)&0xFF); };
  const wStr=s=>{ const u=new TextEncoder().encode(String(s||'')); w16(u.length); for(const c of u) w8(c); };

  // Payload-based flags from known properties
  if (thing?.isFloor || (thing?.groundSpeed|0)>0){ w8(0x00); w16(thing.groundSpeed|0); }
  if (thing?.writable){ w8(0x08); w16(thing.maxTextLen|0); }
  if (thing?.writableOnce){ w8(0x09); w16(thing.maxTextLen|0); }
  if ((thing?.lightLevel|0)>0 || (thing?.lightColor|0)>0){ w8(0x16); w16(thing.lightLevel|0); w16(thing.lightColor|0); }
  if ((thing?.automapColor|0)>0){ w8(0x1D); w16(thing.automapColor|0); }
  if (((thing?.displacementX|0)!==0) || ((thing?.displacementY|0)!==0)){ w8(0x19); w8((thing.displacementX|0)&0xFF); w8((thing.displacementY|0)&0xFF); }
  if ((thing?.elevation|0)>0){ w8(0x15); w16(thing.elevation|0); }
  if ((thing?.slot|0)>0){ w8(0x21); w16(thing.slot|0); }
  if (thing?.isMarketItem){ w8(0x22); w16(thing.marketCategory|0); w16(thing.marketTradeAs|0); w16(thing.marketShowAs|0); wStr(thing.marketName||''); w16(thing.marketRestrictProfession|0); w16(thing.marketRestrictLevel|0); }
  if (thing?.hasHelpLens || (thing?.helpLensType|0)>0){ w8(0x1E); w16(thing.helpLensType|0); }
  if (thing?.hasAction || ((thing?.actionType|0) > 0)){ w8(0x23); w8(thing.actionType|0); }

  // Boolean flags from thing.flags (numeric), filtradas por mapa según signature
  try {
    const NAMES = (typeof getFlagNamesForSignature === 'function'
      ? getFlagNamesForSignature(signature)
      : (typeof FLAG_NAMES !== 'undefined' ? FLAG_NAMES : {})) || {};
    const known = new Set(Object.keys(NAMES).map(k=>Number(k)|0));

    let nums = [];
    if (Array.isArray(thing?.flags)) nums = thing.flags.map(n=>Number(n)|0);
    else if (typeof thing?.flags === 'number' && typeof bitmaskToArray === 'function') nums = bitmaskToArray(thing.flags|0).map(n=>Number(n)|0);
    else if (thing?.flags instanceof Set) nums = Array.from(thing.flags).map(n=>Number(n)|0);
    else if (thing?.flags && typeof thing.flags === 'object'){
      for(const k in thing.flags){
        if(!Object.prototype.hasOwnProperty.call(thing.flags,k)) continue;
        if(thing.flags[k]) nums.push(Number(k)|0);
      }
    }

    nums = Array.from(new Set(nums.filter(n=>Number.isFinite(n) && n>=0 && n<=0xFE)));
    for (const c of nums){
      if (!known.has(c)) continue;
      if (present.has(c)) continue;
      w8(c);
    }
  } catch (_) {}

  w8(0xFF);
  return out;
}

// --- Custom Flags persistence & integration (localStorage: 'honey_custom_flags') ---
export function loadCustomFlags() {
  // Merge custom flags into all FLAG_NAMES_* maps so UI sees them regardless de signature
  try {
    const raw = localStorage.getItem('honey_custom_flags');
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const code = Number(k) | 0;
      if (!Number.isFinite(code)) continue;
      // Add to all version maps so they appear for any signature
      FLAG_NAMES_V6[code] = String(v);
      FLAG_NAMES_V5[code] = String(v);
      FLAG_NAMES_V4[code] = String(v);
      FLAG_NAMES_V3[code] = String(v);
    }
    // Refresh active map according current signature
    const sig = (typeof window !== 'undefined' && window.dat && window.dat.signature) ? (window.dat.signature >>> 0) : 0;
    getFlagNamesForSignature(sig);
    // update global
    window.FLAG_NAMES = FLAG_NAMES;

    // rebuild UI grid in this module (if available)
    try { if (typeof ensureFlagsGrid === 'function') ensureFlagsGrid(true); } catch(_){}

    // --- NEW: notify the main editor module (editor.js) to rebuild its flags grid
    try {
      if (window.DAT_EDITOR && typeof window.DAT_EDITOR.ensureFlagsGrid === 'function') {
        window.DAT_EDITOR.ensureFlagsGrid(true);
      }
    } catch (e) {
      console.warn('notify DAT_EDITOR.ensureFlagsGrid failed', e);
    }

    // --- NEW: if a thing is selected, ask the main editor to re-render it so the thingPropertiesPanel shows the new flag checkbox
    try {
      if (window.DAT_EDITOR && typeof window.DAT_EDITOR.render === 'function' && window.dat && typeof window.currentCategory !== 'undefined' && typeof window.currentThingId !== 'undefined') {
        const t = window.dat.getThing?.(window.currentCategory, window.currentThingId);
        if (t) {
          window.DAT_EDITOR.render(t);
        }
      }
    } catch (e) {
      console.warn('re-render current thing failed', e);
    }

    // rebuild UI grid in page scope (if some other consumer exposes ensureFlagsGrid)
    try { if (typeof ensureFlagsGrid === 'function') ensureFlagsGrid(true); } catch(_){}
  } catch (e) {
    console.warn('loadCustomFlags failed', e);
  }
}

export function unregisterCustomFlag(code) {
  try {
    const cur = JSON.parse(localStorage.getItem('honey_custom_flags') || '{}');
    delete cur[String(Number(code)|0)];
    localStorage.setItem('honey_custom_flags', JSON.stringify(cur));
    // Rebuild: for simplicity remove all custom entries then reload (loadCustomFlags will re-merge)
    // NOTE: remove from maps by reassigning originals (best-effort): re-init FLAG_NAMES_* to original base maps if needed
    // For safety, reload page-level maps by re-calling getFlagNamesForSignature for current sig
    const sig = (typeof window !== 'undefined' && window.dat && window.dat.signature) ? (window.dat.signature >>> 0) : 0;
    // Recompute base maps (they were mutated), simplest approach: reload module defaults by reassigning from V6 constant copies is complex here.
    // Instead we simply call loadCustomFlags() after clearing storage; loadCustomFlags will overwrite with remaining entries.
    loadCustomFlags();
    if (typeof ensureFlagsGrid === 'function') try { ensureFlagsGrid(true); } catch(_) {}
    return true;
  } catch (e) {
    console.warn('unregisterCustomFlag failed', e);
    return false;
  }
}

// Load custom flags on module init (if running in browser)
try { if (typeof window !== 'undefined') loadCustomFlags(); } catch(_) {}

// --- UI glue: construir checkboxes y renderizar flags/valores en la UI ---
function ensureFlagsGrid(rebuild = false) {
  const host = document.getElementById('flagCheckboxes');
  if (!host) return;
  if (!rebuild && host.dataset.built === '1') return;

  host.innerHTML = '';
  const frag = document.createDocumentFragment();
  const codes = Object.keys(FLAG_NAMES).map(k=>Number(k)).sort((a,b)=>a-b);

  // filtros select
  const filter = document.getElementById('flagFilter');
  if (filter) {
    filter.innerHTML = `<option value="">(Todas)</option>` + codes.map(c=>`<option value="${c}">${FLAG_NAMES[c]||c}</option>`).join('');
  }

  codes.forEach(code => {
    // BUILD checkbox matching the exact structure used elsewhere (flag_cb_<code>, data-code, <span> label)
    const lbl = document.createElement('label');
    lbl.className = 'checkline';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = `flag_cb_${code}`;           // <-- use `flag_cb_` prefix (editor.js expects this)
    chk.dataset.code = String(code);
    chk.addEventListener('change', () => { paintFlagsMaskAndUnknown(); }, {passive:true});
    const span = document.createElement('span');
    const name = FLAG_NAMES[code] || `Flag ${code}`;
    span.textContent = `${name} (#${code})`; // match visual "Name (#44)"
    lbl.appendChild(chk);
    lbl.appendChild(span);
    frag.appendChild(lbl);
  });

  host.appendChild(frag);
  host.dataset.built = '1';

  // hook busqueda
  const search = document.getElementById('flagSearch');
  if (search) search.addEventListener('input', onFilterFlags, {passive:true});
  const sel = document.getElementById('flagFilter');
  if (sel) sel.addEventListener('change', onFilterFlags, {passive:true});
  paintFlagsMaskAndUnknown();
}

function onFilterFlags() {
  const q = (document.getElementById('flagSearch')?.value || '').toLowerCase().trim();
  const f = document.getElementById('flagFilter')?.value || '';
  const host = document.getElementById('flagCheckboxes');
  if (!host) return;
  host.querySelectorAll('label.checkline').forEach(lbl=>{
    const txt = lbl.textContent.toLowerCase();
    const code = lbl.querySelector('input')?.dataset?.code || '';
    const matchFilter = (!f || String(code) === String(f));
    lbl.style.display = (( !q || txt.includes(q) ) && matchFilter) ? '' : 'none';
  });
}

// muestra máscara y flags desconocidas
function paintFlagsMaskAndUnknown() {
  const host = document.getElementById('flagCheckboxes');
  if (!host) return;
  const checked = Array.from(host.querySelectorAll('input[type=checkbox]:checked')).map(cb=>Number(cb.dataset.code));
  const mask = checked.reduce((m,c)=> (m | (1<<c)), 0) >>> 0;
  const bits = '0x' + mask.toString(16).toUpperCase();
  const preview = document.getElementById('flagsBitmaskPreview');
  if (preview) preview.value = bits;

  // unknowns: if any checked code not in FLAG_NAMES (unlikely)
  const unknownList = document.getElementById('unknownFlagsList');
  if (unknownList) {
    unknownList.innerHTML = '';
    checked.filter(c => !(c in FLAG_NAMES)).forEach(c=>{
      const span = document.createElement('span'); span.className='badge bad'; span.textContent = `#${c}`;
      unknownList.appendChild(span);
    });
  }
}

// renderiza flags y valores de un thing en la UI
export function render(thing) {
  ensureFlagsGrid();

  // limpiar toggles/inputs primero
  ['prop_isFloor','prop_groundSpeed','prop_hasLight','prop_lightColor','prop_lightIntensity',
   'prop_hasAutomap','prop_automapColor','prop_hasOffset','prop_offsetX','prop_offsetY',
   'prop_hasElevation','prop_elevation','prop_writable','prop_writableOnce','prop_maxTextLen',
   'prop_hasEquipment','prop_slot','prop_hasMarket','prop_mktName','prop_mktCategory','prop_mktTradeAs','prop_mktShowAs','prop_mktVocation','prop_mktLevel',
   'prop_hasHelpLens','prop_helpLensType','prop_hasAction','prop_actionType'].forEach(id=>{
     const el = document.getElementById(id);
     if (el) {
       if (el.type === 'checkbox') { el.checked = false; el.setAttribute('aria-checked','false'); }
       else if ('value' in el) el.value = '';
     }
  });

  if (!thing) { paintFlagsMaskAndUnknown(); return; }

  // usar parser de bytes a estructura
  const info = formatFlags(thing, (thing?.signature|0)>>>0);

  // marcar checkboxes de opcodes presentes
  const host = document.getElementById('flagCheckboxes');
  if (host) {
    host.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    if (Array.isArray(info.codes)) {
      info.codes.forEach(code => {
        // NOTE: ID uses flag_cb_<code> now (matches editor.js)
        const cb = document.getElementById(`flag_cb_${code}`);
        if (cb) cb.checked = true;
      });
    }
  }

  // rellenar propiedades si disponibles
  if (info.isFloor) {
    const e = document.getElementById('prop_isFloor'); if (e) e.checked = true;
    const gs = document.getElementById('prop_groundSpeed'); if (gs) gs.value = info.groundSpeed || '';
  }

  if (info.hasLight) {
    const e = document.getElementById('prop_hasLight'); if (e) e.checked = true;
    const lc = document.getElementById('prop_lightColor'); if (lc) lc.value = info.lightColor ? ('#' + Number(info.lightColor).toString(16).padStart(6,'0')) : '';
    const li = document.getElementById('prop_lightIntensity'); if (li) li.value = info.lightLevel || '';
  }

  if (info.hasAutomap) {
    const e = document.getElementById('prop_hasAutomap'); if (e) e.checked = true;
    const ac = document.getElementById('prop_automapColor'); if (ac) ac.value = info.automapColor ? ('#' + Number(info.automapColor).toString(16).padStart(6,'0')) : '';
  }

  if (info.hasOffset) {
    const e = document.getElementById('prop_hasOffset'); if (e) e.checked = true;
    const ox = document.getElementById('prop_offsetX'); if (ox) ox.value = info.displacementX || 0;
    const oy = document.getElementById('prop_offsetY'); if (oy) oy.value = info.displacementY || 0;
  }

  if (info.hasElevation) {
    const e = document.getElementById('prop_hasElevation'); if (e) e.checked = true;
    const elv = document.getElementById('prop_elevation'); if (elv) elv.value = info.elevation || 0;
  }

  if (info.writable || info.writableOnce) {
    const w = document.getElementById('prop_writable'); if (w) w.checked = !!info.writable;
    const wo = document.getElementById('prop_writableOnce'); if (wo) wo.checked = !!info.writableOnce;
    const ml = document.getElementById('prop_maxTextLen'); if (ml) ml.value = info.maxTextLen || 0;
  }

  if (info.hasEquipment) {
    const e = document.getElementById('prop_hasEquipment'); if (e) e.checked = true;
    const sl = document.getElementById('prop_slot'); if (sl) sl.value = info.slot || 0;
  }

  if (info.isMarketItem) {
    const e = document.getElementById('prop_hasMarket'); if (e) e.checked = true;
    const nm = document.getElementById('prop_mktName'); if (nm) nm.value = info.marketName || '';
    const cat = document.getElementById('prop_mktCategory'); if (cat) cat.value = info.marketCategory || 0;
    const tA = document.getElementById('prop_mktTradeAs'); if (tA) tA.value = info.marketTradeAs || 0;
    const sA = document.getElementById('prop_mktShowAs'); if (sA) sA.value = info.marketShowAs || 0;
    const voc = document.getElementById('prop_mktVocation'); if (voc) voc.value = info.marketRestrictProfession || 0;
    const lvl = document.getElementById('prop_mktLevel'); if (lvl) lvl.value = info.marketRestrictLevel || 0;
  }

  if (info.hasHelpLens) {
    const chk = document.getElementById('prop_hasHelpLens');
    const sel = document.getElementById('prop_helpLensType');
    if (chk) { chk.checked = true; chk.setAttribute('aria-checked','true'); }
    // preferir info.helpLens.type si existe, fallback a helpLensType o 0
    const typeVal = (info.helpLens && typeof info.helpLens.type !== 'undefined') ? info.helpLens.type
                   : (typeof info.helpLensType !== 'undefined' ? info.helpLensType : 0);
    if (sel) sel.value = String(typeVal);
  } else {
    const chk = document.getElementById('prop_hasHelpLens');
    const sel = document.getElementById('prop_helpLensType');
    if (chk) { chk.checked = false; chk.setAttribute('aria-checked','false'); }
    if (sel) sel.value = '';
  }

  if (info.hasAction) {
    const chk = document.getElementById('prop_hasAction');
    const sel = document.getElementById('prop_actionType');
    if (chk) { chk.checked = true; chk.setAttribute('aria-checked','true'); }
    const aType = (info.action && typeof info.action.type !== 'undefined') ? info.action.type : (info.actionType || 0);
    if (sel) sel.value = String(aType);
  } else {
    const chk = document.getElementById('prop_hasAction');
    const sel = document.getElementById('prop_actionType');
    if (chk) { chk.checked = false; chk.setAttribute('aria-checked','false'); }
    if (sel) sel.value = '';
  }

  paintFlagsMaskAndUnknown();
}

// --- integración global para editor.js ---
if (typeof window !== 'undefined') {
  window.FLAG_NAMES = FLAG_NAMES;
  // Expose both helpers so editor.js can call getFlagNamesForSignature() directly
  window.getFlagNamesForSignature = getFlagNamesForSignature;
  window.DAT_EDITOR = window.DAT_EDITOR || {};
  window.DAT_EDITOR.getFlagNamesForSignature = getFlagNamesForSignature;
  window.DAT_EDITOR.formatFlags = formatFlags;
  window.DAT_EDITOR.encodeFlags = encodeFlags;
  window.DAT_EDITOR.render = window.DAT_EDITOR.render || render;
  window.DAT_EDITOR.ensureFlagsGrid = window.DAT_EDITOR.ensureFlagsGrid || ensureFlagsGrid;

  // Expose custom-flag API to other modules
  window.DAT_EDITOR.registerCustomFlag = registerCustomFlag;
  window.DAT_EDITOR.unregisterCustomFlag = unregisterCustomFlag;
  window.DAT_EDITOR.loadCustomFlags = loadCustomFlags;

  // construir grid en DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ ensureFlagsGrid(); }, {once:true});
  } else {
    ensureFlagsGrid();
  }
}

// ===============================
// 🔥 SOPORTE COMPLETO CUSTOM FLAGS
// ===============================

// Mapa global inverso: code -> name
if (!window.__HONEY_FLAG_LABELS__) {
  window.__HONEY_FLAG_LABELS__ = {};
}

// Hook para registrar flags custom en TODOS los sistemas
export function registerCustomFlag(code, name) {
  code = Number(code) | 0;
  if (!Number.isFinite(code)) return;

  // 1) UI names
  FLAG_NAMES[code] = name || `Custom Flag ${code}`;

  // 2) Resolver global (para formatFlags, badges, resumen)
  window.__HONEY_FLAG_LABELS__[code] = FLAG_NAMES[code];
}

// Resolver seguro de nombre (fallback limpio)
export function resolveFlagName(code) {
  code = Number(code) | 0;
  return (
    FLAG_NAMES?.[code] ||
    window.__HONEY_FLAG_LABELS__?.[code] ||
    `0x${code.toString(16)} (${code})`
  );
}
